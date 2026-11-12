import { z } from "zod";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { dispatchIntakeAgent } from "./intake.agentJob";
import {
  findConversation,
  findThreadLink,
  routeThreadMessage,
} from "./intake.channels";
import {
  MAX_MESSAGE_CHARS,
  cleanText,
  clip,
  type SlackInboundPayload,
  type TeamsInboundPayload,
} from "./intake.inboundPayload";
import { insertInbound, type InboundInsert } from "./intake.inboundStore";
import { slackSigningSecret } from "./intake.secrets";
import { automationByWebhook, type AutomationRow } from "./intake.settingsRow";
import { verifySlackSignature } from "./intake.slack";
import {
  teamsActivity,
  teamsActivityFiles,
  teamsActivityText,
  teamsMentionsBot,
  verifyBotFrameworkToken,
  type TeamsActivity,
} from "./intake.teams";

export {
  htmlToText,
  isAutomaticMail,
  senderDomainAllowed,
} from "./intake.mail";

/**
 * How a message reaches automated intake by webhook: a Slack event or a
 * Teams activity (Outlook and Gmail are read from the mailbox, see
 * intake.mailbox.ts). Each is checked, then either stored once in
 * intake_inbound and handed to its job (a new request, or a message in a
 * request's thread), or acknowledged and dropped without storing anything,
 * quickly enough for Slack's three-second deadline. A delivery repeated by
 * the sender finds its row and adds nothing.
 */

const NOT_FOUND = failure("not_found", "Not found.");

export type InboundReceipt = { status: "received" | "duplicate" | "ignored" };

/**
 * Hand a stored message to its job. If that fails the sender is answered
 * with an error, so it delivers the message again and that delivery queues it.
 */
async function queue(
  db: Db,
  orgId: string,
  inboundId: string,
): Promise<ServiceResult<null>> {
  try {
    await dispatchIntakeAgent(db, orgId, inboundId);
    return ok(null);
  } catch (cause) {
    return internalFailure(cause);
  }
}

/**
 * The same message delivered again. Nothing is stored twice; a message still
 * waiting is queued again (deduplicated while its job is live), in case the
 * first delivery stored it but could not queue it.
 */
export async function redelivered(
  db: Db,
  orgId: string,
  source: InboundInsert["source"],
  externalId: string,
): Promise<ServiceResult<InboundReceipt>> {
  const existing = await findInbound(db, orgId, source, externalId);
  if (!existing.ok) return existing;
  if (existing.data?.status === "pending") {
    const queued = await queue(db, orgId, existing.data.id);
    if (!queued.ok) return queued;
  }
  return ok({ status: "duplicate" });
}

export async function findInbound(
  db: Db,
  orgId: string,
  source: InboundInsert["source"],
  externalId: string,
): Promise<ServiceResult<{ id: string; status: string } | null>> {
  const { data, error } = await db
    .from("intake_inbound")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("source", source)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) return internalFailure(error);
  return ok((data as { id: string; status: string } | null) ?? null);
}

/** Store a new request's message once and queue its job. */
async function storeRequest(
  db: Db,
  orgId: string,
  source: InboundInsert["source"],
  externalId: string,
  payload: Record<string, unknown>,
): Promise<ServiceResult<InboundReceipt>> {
  const stored = await insertInbound(db, {
    org_id: orgId,
    source,
    external_id: externalId,
    status: "pending",
    payload,
  });
  if (!stored.ok) return stored;
  if (stored.data === null) return redelivered(db, orgId, source, externalId);
  const queued = await queue(db, orgId, stored.data);
  return queued.ok ? ok({ status: "received" }) : queued;
}

const slackEnvelope = z.object({
  type: z.string(),
  challenge: z.string().max(500).optional(),
  team_id: z.string().regex(/^[A-Z0-9]{1,40}$/).optional(),
  event: z.unknown().optional(),
});
const SLACK_ID = /^[A-Z0-9]{1,40}$/;
const SLACK_TS = /^\d{1,12}\.\d{1,8}$/;
const slackMessageEvent = z.object({
  type: z.enum(["app_mention", "message"]),
  user: z.string().regex(SLACK_ID).optional(),
  bot_id: z.string().optional(),
  subtype: z.string().optional(),
  text: z.string().optional(),
  ts: z.string().regex(SLACK_TS),
  thread_ts: z.string().regex(SLACK_TS).optional(),
  channel: z.string().regex(SLACK_ID),
  files: z.array(z.unknown()).optional(),
});

function slackFiles(files: unknown[] | undefined): SlackInboundPayload["files"] {
  return (files ?? []).slice(0, 50).flatMap((value) => {
    const file = (value ?? {}) as Record<string, unknown>;
    // Files Slack hosts; an external link or a deleted file has no bytes.
    if (file.mode === "tombstone" || file.mode === "external" || file.is_external === true)
      return [];
    const name =
      typeof file.name === "string" && file.name.trim()
        ? file.name
        : typeof file.title === "string"
          ? file.title
          : "";
    return [
      {
        id: typeof file.id === "string" ? file.id.slice(0, 40) : null,
        name: clip(cleanText(name), 255) || "Slack file",
        size: typeof file.size === "number" && file.size >= 0 ? file.size : null,
        url:
          typeof file.url_private_download === "string"
            ? file.url_private_download.slice(0, 2000)
            : null,
      },
    ];
  });
}

/** How often settings learn that thread messages still arrive. */
const MESSAGES_SEEN_EVERY_MS = 60 * 60 * 1000;

async function noteMessagesSeen(db: Db, settings: AutomationRow) {
  const seen = settings.slack_messages_seen_at
    ? Date.parse(settings.slack_messages_seen_at)
    : 0;
  if (Date.now() - seen < MESSAGES_SEEN_EVERY_MS) return;
  await db
    .from("intake_automation")
    .update({ slack_messages_seen_at: new Date().toISOString() })
    .eq("org_id", settings.org_id)
    .then(undefined, () => undefined);
}

/**
 * A request from the organization's Slack app. Signed requests only: a URL
 * verification challenge is answered as soon as a signing secret is saved,
 * so the URL can be verified before Slack is turned on. While Slack is on,
 * any person's message in a thread linked to a request is that request's
 * reply, and a mention of MikeGC anywhere else is a new request. Everything
 * else (channel chatter, MikeGC's own and other bots' messages, edits and
 * deletions) is acknowledged and dropped without storing its content.
 */
export async function receiveSlackEvent(
  db: Db,
  webhookId: string,
  rawBody: Buffer,
  headers: { timestamp: string | undefined; signature: string | undefined },
): Promise<ServiceResult<{ challenge?: string }>> {
  let settings: AutomationRow | null;
  try {
    settings = await automationByWebhook(db, "slack_webhook_id", webhookId);
  } catch (error) {
    return internalFailure(error);
  }
  if (!settings) return NOT_FOUND;
  const secret = slackSigningSecret(settings);
  if (!secret) return NOT_FOUND;
  if (!verifySlackSignature({ secret, rawBody, ...headers }))
    return failure("forbidden", "Invalid request signature.");

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return failure("validation", "Invalid event.");
  }
  const envelope = slackEnvelope.safeParse(body);
  if (!envelope.success) return failure("validation", "Invalid event.");
  if (envelope.data.type === "url_verification")
    return envelope.data.challenge
      ? ok({ challenge: envelope.data.challenge })
      : failure("validation", "Invalid event.");
  if (envelope.data.type !== "event_callback" || !settings.slack_enabled)
    return ok({});
  const event = slackMessageEvent.safeParse(envelope.data.event);
  if (!event.success) return ok({});
  const message = event.data;
  // Bots, including MikeGC's own posts, never file requests or reply; edits,
  // deletions and joins are not messages a person sent.
  if (
    message.bot_id ||
    (message.subtype !== undefined && message.subtype !== "file_share") ||
    !message.user ||
    message.user === settings.slack_bot_user_id
  )
    return ok({});
  const team = envelope.data.team_id ?? settings.slack_team_id ?? "";
  const externalId = `${message.channel}:${message.ts}`;
  const inThread = !!message.thread_ts && message.thread_ts !== message.ts;
  // A thread where MikeGC answered without recording a request: replies
  // there reach it without a mention.
  let conversing = false;
  if (inThread) {
    let link;
    try {
      link = await findThreadLink(
        db,
        settings.org_id,
        "slack",
        `${team}:${message.channel}:${message.thread_ts}`,
      );
    } catch (error) {
      return internalFailure(error);
    }
    if (link) {
      if (message.type === "message") await noteMessagesSeen(db, settings);
      // A mention fires app_mention and message alike; both name the same
      // channel:ts, so it is recorded once, as a reply.
      const routed = await routeThreadMessage(db, {
        orgId: settings.org_id,
        source: "slack",
        externalId,
        requestId: link.request_id,
        payload: {
          kind: "slack_reply",
          channel: message.channel,
          ts: message.ts,
          thread_ts: message.thread_ts,
          user: message.user,
        },
        dispatch: dispatchIntakeAgent,
      });
      return routed.ok ? ok({}) : routed;
    }
    if (message.type === "message") {
      try {
        conversing = !!(await findConversation(
          db,
          settings.org_id,
          "slack",
          `${team}:${message.channel}:${message.thread_ts}`,
        ));
      } catch (error) {
        return internalFailure(error);
      }
    }
  }
  // Only a mention of MikeGC starts a request, or a reply in its conversation.
  if (message.type !== "app_mention" && !conversing) return ok({});
  const payload: SlackInboundPayload = {
    kind: "slack",
    team_id: team || null,
    channel: message.channel,
    ts: message.ts,
    thread_ts: inThread ? message.thread_ts! : null,
    user: message.user,
    text: clip(cleanText(message.text ?? ""), MAX_MESSAGE_CHARS),
    files: slackFiles(message.files),
  };
  const stored = await storeRequest(db, settings.org_id, "slack", externalId, payload);
  return stored.ok ? ok({}) : stored;
}

/**
 * A Teams activity from the organization's own bot. It must carry a Bot
 * Connector token for the bot's app ID, from the configured tenant. While
 * Teams is on, a person's message in a thread linked to a request is its
 * reply, and a message that mentions MikeGC in any other channel thread is
 * a new request; everything else is acknowledged and dropped.
 */
export async function receiveTeamsActivity(
  db: Db,
  webhookId: string,
  authorization: string | undefined,
  body: unknown,
): Promise<ServiceResult<InboundReceipt>> {
  let settings: AutomationRow | null;
  try {
    settings = await automationByWebhook(db, "teams_webhook_id", webhookId);
  } catch (error) {
    return internalFailure(error);
  }
  if (!settings?.teams_app_id || !settings.teams_tenant_id) return NOT_FOUND;
  const parsed = teamsActivity.safeParse(body);
  if (!parsed.success) return failure("validation", "Invalid activity.");
  const activity: TeamsActivity = parsed.data;
  const verified = await verifyBotFrameworkToken(authorization, {
    appId: settings.teams_app_id,
    serviceUrl: activity.serviceUrl,
  });
  if (!verified) return failure("forbidden", "Invalid token.");
  if (activity.channelData?.tenant?.id !== settings.teams_tenant_id)
    return failure("forbidden", "Invalid tenant.");
  if (!settings.teams_enabled) return ok({ status: "ignored" });
  // Edits, deletions, reactions, membership changes and the bot's own posts.
  if (
    activity.type !== "message" ||
    activity.channelData?.eventType ||
    activity.from.id === `28:${settings.teams_app_id}` ||
    activity.conversation.conversationType !== "channel"
  )
    return ok({ status: "ignored" });
  const conversationId = activity.conversation.id;
  const root = conversationId.match(/;messageid=(\d{1,30})$/)?.[1];
  if (!root) return ok({ status: "ignored" });
  const tenant = settings.teams_tenant_id;
  const text = teamsActivityText(activity, settings.teams_app_id);
  const files = teamsActivityFiles(activity);
  const date = activity.timestamp && !Number.isNaN(Date.parse(activity.timestamp))
    ? new Date(activity.timestamp).toISOString()
    : new Date().toISOString();
  const from = {
    id: activity.from.id,
    aad_object_id: activity.from.aadObjectId ?? null,
    name: activity.from.name ? clip(cleanText(activity.from.name), 200) : null,
  };
  let link;
  try {
    link = await findThreadLink(db, settings.org_id, "teams", `${tenant}:${conversationId}`);
  } catch (error) {
    return internalFailure(error);
  }
  if (link) {
    const routed = await routeThreadMessage(db, {
      orgId: settings.org_id,
      source: "teams",
      externalId: activity.id,
      requestId: link.request_id,
      payload: {
        kind: "teams_reply",
        activity_id: activity.id,
        service_url: activity.serviceUrl,
        from,
        date,
        text: clip(text, MAX_MESSAGE_CHARS),
        files,
      },
      dispatch: dispatchIntakeAgent,
    });
    return routed.ok ? ok({ status: routed.data }) : routed;
  }
  if (!teamsMentionsBot(activity, settings.teams_app_id)) {
    // Unless MikeGC answered in this thread without recording a request.
    let conversing;
    try {
      conversing = await findConversation(db, settings.org_id, "teams", `${tenant}:${conversationId}`);
    } catch (error) {
      return internalFailure(error);
    }
    if (!conversing) return ok({ status: "ignored" });
  }
  const channelData = activity.channelData ?? {};
  const payload: TeamsInboundPayload = {
    kind: "teams",
    tenant_id: tenant,
    service_url: activity.serviceUrl,
    conversation_id: conversationId,
    team_id: channelData.team?.id ?? null,
    aad_group_id: channelData.team?.aadGroupId ?? null,
    channel_id: channelData.channel?.id ?? null,
    root_message_id: root,
    team_name: channelData.team?.name ? clip(cleanText(channelData.team.name), 200) : null,
    channel_name: channelData.channel?.name
      ? clip(cleanText(channelData.channel.name), 200)
      : null,
    activity_id: activity.id,
    from,
    date,
    text: clip(text, MAX_MESSAGE_CHARS),
    files,
  };
  return storeRequest(db, settings.org_id, "teams", activity.id, payload);
}
