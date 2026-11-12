import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { NonRetryableJobError } from "../../lib/dbq/runner";
import type { ServiceFailure } from "../../lib/serviceResult";
import { DbJobDeferredError, type DbJob } from "../../lib/dbq/types";
import { configuredApiPublicUrl } from "../../lib/runtimeConfig";
import { safeError } from "../../lib/safeError";
import type { Db } from "../../lib/supabase";
import { dispatchIntakeAgent } from "./intake.agentJob";
import {
  findThreadLink,
  loadLinkById,
  routeThreadMessage,
  type ChannelLink,
} from "./intake.channels";
import {
  GmailApiError,
  gmailHistory,
  gmailListSince,
  gmailMailbox,
  gmailMarkRecorded,
  gmailProfile,
  gmailReadMessage,
  noGmailAccount,
} from "./intake.gmail";
import {
  MAX_MESSAGE_CHARS,
  cleanText,
  clip,
  type MailInboundPayload,
} from "./intake.inboundPayload";
import { insertInbound } from "./intake.inboundStore";
import {
  discardStaged,
  isAutomaticMail,
  linkByMessageIds,
  mailAddress,
  mailSource,
  mailThreadKey,
  normalizeMessageId,
  referencedMessageIds,
  replyFromThread,
  senderAuthenticated,
  senderDomainAllowed,
  stageMailAttachments,
  stripQuotedReply,
} from "./intake.mail";
import { MicrosoftApiError } from "./intake.microsoft";
import {
  graphCredentials,
  graphDelta,
  graphMarkRecorded,
  graphReadMessage,
  graphRenew,
  graphSubscribe,
  type ReadMail,
} from "./intake.outlook";
import { automationByWebhook, loadAutomationRow, type AutomationRow } from "./intake.settingsRow";
import { dispatchIntakeJob } from "./intake.shared";

/**
 * MikeGC reading the organization's intake mailbox. Gmail is polled every
 * minute from the last history ID; Outlook sends a change notification for
 * new Inbox mail, backed by a delta query every 15 minutes, and its
 * subscription is renewed every three days. Each new message is recorded
 * once, keyed by its Message-ID: a reply in a request's thread, a new
 * request, or ignored, the way Postmark mail was.
 */

export const INTAKE_MAILBOX_POLL_JOB = "intake.mailbox.poll";
const GMAIL_POLL_MS = 60_000;
const GRAPH_POLL_MS = 15 * 60_000;
/** Renew the Graph subscription once less than a day is left on it. */
const RENEW_BEFORE_MS = 24 * 60 * 60_000;

const jobPayload = z.object({
  orgId: z.uuid(),
  /** A one-off read, as a Graph notification asks for; it doesn't reschedule. */
  once: z.boolean().default(false),
  renew: z.boolean().default(false),
});

export type MailReceipt = "received" | "duplicate" | "ignored" | "skipped";

const AUTOMATIC = "An automatic reply or bulk email, so no request was recorded.";
const UNAUTHENTICATED =
  "The sender's mail system didn't authenticate it (DMARC, SPF or DKIM), so no request was recorded.";

/** The sentence an admin sees for a mailbox that isn't working. */
function mailboxSentence(error: unknown): string | null {
  if (error instanceof MicrosoftApiError || error instanceof GmailApiError)
    return error.sentence;
  return null;
}

/** A failed service result as the error a job throws. */
function failureError(result: ServiceFailure): unknown {
  return result.kind === "error" ? result.error : new Error(result.detail);
}

function hashState(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Where Microsoft Graph sends an organization's new-mail notifications. */
export function graphNotificationUrl(webhookId: string): string {
  return `${configuredApiPublicUrl()}/webhooks/intake/graph/${webhookId}`;
}

/**
 * Record one email from the mailbox: once, by its Message-ID. A message in
 * a request's thread from someone on that thread is a reply; from anyone
 * else at an accepted domain it becomes a new request, with a note on the
 * other. A new email addressed to the intake address from an accepted,
 * authenticated domain is a request. Automatic mail, and mail the mailbox
 * sent itself, is recorded as ignored or skipped.
 */
export async function recordMail(
  db: Db,
  settings: AutomationRow,
  mail: ReadMail,
): Promise<MailReceipt> {
  const mailbox = settings.email_mailbox?.toLowerCase() ?? "";
  if (mail.isDraft || mail.from.email === mailbox) return "skipped";
  const source = mailSource(mail.provider);
  const externalId =
    normalizeMessageId(mail.internetMessageId) ?? `${mail.provider}:${mail.providerId}`;
  type Seen = { id: string; status: string };
  const lookup = async (): Promise<Seen | null> => {
    const { data, error } = await db
      .from("intake_inbound")
      .select("id, status")
      .eq("org_id", settings.org_id)
      .eq("source", source)
      .eq("external_id", externalId)
      .maybeSingle();
    if (error) throw error;
    return data as Seen | null;
  };
  // Read again, or stored first by another poll: one still waiting is queued
  // again, in case its job never was (deduplicated while one is live).
  const requeue = async (row: Seen | null): Promise<MailReceipt> => {
    if (row?.status === "pending")
      await dispatchIntakeAgent(db, settings.org_id, row.id);
    return "duplicate";
  };
  const seen = await lookup();
  if (seen) return requeue(seen);
  const ignored = async (reason: string): Promise<MailReceipt> => {
    const stored = await insertInbound(db, {
      org_id: settings.org_id,
      source,
      external_id: externalId,
      status: "ignored",
      payload: null,
      error: clip(reason, 200),
    });
    if (!stored.ok) throw failureError(stored);
    // Stored first by another poll, perhaps as a request still to be queued.
    return stored.data === null ? requeue(await lookup()) : "ignored";
  };
  if (isAutomaticMail(mail.headers)) return ignored(AUTOMATIC);
  const authenticated = senderAuthenticated(mail.headers, mail.from.email);
  const references = referencedMessageIds(mail.headers);

  // A thread MikeGC replies in: by its handle, or by a Message-ID it answers,
  // which finds a reply whose edited subject started a new conversation.
  let link: ChannelLink | null = await findThreadLink(
    db,
    settings.org_id,
    source,
    mailThreadKey(mail.provider, mail.thread),
  );
  if (!link) {
    const linkId = await linkByMessageIds(db, settings.org_id, references);
    link = linkId ? await loadLinkById(db, linkId) : null;
  }
  const fields = {
    provider: mail.provider,
    mailbox: settings.email_mailbox ?? "",
    provider_id: mail.providerId,
    message_id: externalId,
    thread: mail.thread,
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject ? clip(cleanText(mail.subject), 1000) : null,
    date: mail.date,
    references,
  };
  const inboundId = randomUUID();
  if (link && replyFromThread(mailAddress(link), mail.from.email, authenticated)) {
    const staged = await stageMailAttachments(settings.org_id, inboundId, mail.attachments);
    const text = mail.provider === "graph" ? mail.newText : stripQuotedReply(mail.text);
    const routed = await routeThreadMessage(db, {
      orgId: settings.org_id,
      source,
      externalId,
      requestId: link.request_id,
      payload: {
        kind: "mail_reply",
        ...fields,
        text: clip(cleanText(stripQuotedReply(text)), MAX_MESSAGE_CHARS),
        ...staged,
      },
      dispatch: dispatchIntakeAgent,
    });
    if (routed.payloadOwnership === "unowned")
      await discardStaged(staged.attachments.map((a) => a.key));
    if (!routed.ok) throw failureError(routed);
    if (routed.data === "duplicate") return requeue(await lookup());
    if (routed.data === "received") await markRecorded(settings, mail);
    return routed.data;
  }

  // A new request.
  const addressed = [...mail.to, ...mail.cc].includes(mailbox) || !!link;
  if (!addressed) return ignored("It wasn't addressed to the intake address, so no request was recorded.");
  const allowed = settings.email_allowed_domains ?? [];
  if (allowed.length === 0)
    return ignored("No sender domains are accepted yet. Add one in Intake settings.");
  if (!senderDomainAllowed(mail.from.email, allowed)) {
    const domain = mail.from.email?.split("@").pop()?.slice(0, 60);
    return ignored(
      domain
        ? `The sender's domain, ${domain}, isn't one of the accepted domains.`
        : "The sender's address couldn't be read, and only accepted domains are recorded.",
    );
  }
  if (!authenticated) return ignored(UNAUTHENTICATED);
  const staged = await stageMailAttachments(settings.org_id, inboundId, mail.attachments);
  const payload: MailInboundPayload = {
    kind: "mail",
    ...fields,
    text: clip(cleanText(mail.text), MAX_MESSAGE_CHARS),
    ...staged,
    related_request_id: link?.request_id ?? null,
  };
  const stored = await insertInbound(db, {
    id: inboundId,
    org_id: settings.org_id,
    source,
    external_id: externalId,
    status: "pending",
    payload,
  });
  if (stored.payloadOwnership === "unowned")
    await discardStaged(staged.attachments.map((a) => a.key));
  if (!stored.ok) throw failureError(stored);
  if (stored.data === null) return requeue(await lookup());
  await dispatchIntakeAgent(db, settings.org_id, stored.data);
  await markRecorded(settings, mail);
  return "received";
}

async function markRecorded(settings: AutomationRow, mail: ReadMail) {
  if (mail.provider === "graph") {
    const credentials = (() => {
      try {
        return graphCredentials(settings);
      } catch {
        return null;
      }
    })();
    if (credentials) await graphMarkRecorded(credentials, mail.providerId);
  } else {
    const mailbox = gmailMailbox(settings);
    if (mailbox) await gmailMarkRecorded(mailbox, mail.providerId);
  }
}

async function saveMailbox(db: Db, orgId: string, patch: Record<string, unknown>) {
  const { error } = await db.from("intake_automation").update(patch).eq("org_id", orgId);
  if (error) throw error;
}

/** Where a read starts again: a minute before the last one, or a day ago. */
const readSince = (settings: AutomationRow) =>
  new Date(
    (settings.email_last_read_at ? Date.parse(settings.email_last_read_at) : Date.now() - 86_400_000) - 60_000,
  );

/** Graph's answer when a stored delta link is too old to continue from. */
function deltaExpired(error: unknown): boolean {
  return (
    error instanceof MicrosoftApiError &&
    (error.status === 410 || /^(syncStateNotFound|syncStateInvalid|resyncRequired)$/i.test(error.code))
  );
}

/** Read what arrived in an Outlook mailbox since the stored delta link. */
async function pollGraph(db: Db, settings: AutomationRow, renew: boolean) {
  const credentials = graphCredentials(settings);
  const now = Date.now();
  const expires = settings.graph_subscription_expires_at
    ? Date.parse(settings.graph_subscription_expires_at)
    : 0;
  if (renew || !settings.graph_subscription_id || expires - now < RENEW_BEFORE_MS) {
    try {
      let expiresAt: string | null = null;
      let id = settings.graph_subscription_id;
      const patch: Record<string, unknown> = {};
      if (id) expiresAt = await graphRenew(credentials, id).catch(() => null);
      if (!expiresAt) {
        const clientState = randomBytes(32).toString("base64url");
        const created = await graphSubscribe(credentials, {
          notificationUrl: graphNotificationUrl(settings.email_webhook_id),
          clientState,
        });
        id = created.id;
        expiresAt = created.expiresAt;
        patch.graph_client_state_hash = hashState(clientState);
      }
      // One write, so the stored ID and secret always name the same subscription.
      await saveMailbox(db, settings.org_id, {
        ...patch,
        graph_subscription_id: id,
        graph_subscription_expires_at: expiresAt,
      });
    } catch (error) {
      // Polling carries on every 15 minutes without notifications.
      console.warn("[intake-mailbox] subscription not renewed", safeError(error));
    }
  }
  const from = settings.graph_delta_link;
  let read: { ids: string[]; deltaLink: string };
  try {
    read = await graphDelta(credentials, from);
  } catch (error) {
    if (!from || !deltaExpired(error)) throw error;
    // Graph no longer knows the stored link: start again from just before the
    // last read, so mail that arrived in between is read too (and recorded once).
    read = await graphDelta(credentials, null, readSince(settings));
  }
  const { ids, deltaLink } = read;
  for (const id of ids) {
    const mail = await graphReadMessage(credentials, id);
    if (mail) await recordMail(db, settings, mail);
  }
  // Moved on only from where this read started, so a slower run never winds it back.
  const update = db
    .from("intake_automation")
    .update({ graph_delta_link: deltaLink })
    .eq("org_id", settings.org_id);
  const { error } = from ? await update.eq("graph_delta_link", from) : await update.is("graph_delta_link", null);
  if (error) throw error;
}

/** Read what arrived in a Gmail mailbox since the stored history ID. */
async function pollGmail(db: Db, settings: AutomationRow) {
  if (!settings.email_mailbox) return;
  const mailbox = gmailMailbox(settings);
  if (!mailbox) throw noGmailAccount();
  let start = settings.gmail_history_id;
  if (!start) {
    start = (await gmailProfile(mailbox)).historyId;
    await saveMailbox(db, settings.org_id, { gmail_history_id: start });
    return;
  }
  const history = await gmailHistory(mailbox, start);
  let ids: string[];
  let next: string;
  if (history === "expired") {
    // Too old to list: read the Inbox since the last read. The history ID is
    // taken first, so mail arriving during the listing is in the next read.
    next = (await gmailProfile(mailbox)).historyId;
    ids = await gmailListSince(mailbox, readSince(settings));
  } else {
    ids = history.ids;
    next = history.historyId;
  }
  for (const id of ids) {
    const mail = await gmailReadMessage(mailbox, id);
    if (mail) await recordMail(db, settings, mail);
  }
  const { error } = await db
    .from("intake_automation")
    .update({ gmail_history_id: next })
    .eq("org_id", settings.org_id)
    .eq("gmail_history_id", start);
  if (error) throw error;
}

/**
 * The poll job: read the mailbox, then come back in a minute (Gmail) or 15
 * minutes (Outlook). It stops once email is switched off or disconnected; a
 * failure an admin must fix is shown in Intake settings, and the job keeps
 * coming back so the mailbox is read again as soon as it is fixed.
 */
export async function handleIntakeMailboxPoll(
  db: Db,
  job: DbJob,
): Promise<Record<string, unknown>> {
  const ids = jobPayload.safeParse(job.payload);
  if (!ids.success) throw new NonRetryableJobError("intake.mailbox.poll: invalid payload");
  const settings = await loadAutomationRow(db, ids.data.orgId);
  if (!settings?.email_enabled || !settings.email_provider || !settings.email_mailbox)
    return { stopped: true };
  const provider = settings.email_provider;
  let problem: string | null = null;
  try {
    if (provider === "graph") await pollGraph(db, settings, ids.data.renew);
    else await pollGmail(db, settings);
    await saveMailbox(db, settings.org_id, {
      email_last_read_at: new Date().toISOString(),
      email_error: null,
    });
  } catch (error) {
    problem = mailboxSentence(error);
    const permanent =
      (error instanceof MicrosoftApiError || error instanceof GmailApiError) && error.permanent;
    // A read that keeps stopping short is shown too: it may not get past
    // what it is reading until someone looks at the mailbox.
    const stalled = error instanceof GmailApiError && error.code.endsWith("_incomplete");
    if (problem && (permanent || stalled))
      await saveMailbox(db, settings.org_id, { email_error: problem }).catch(() => undefined);
    // One an admin must fix is shown, and the job keeps coming back; any
    // other failure is retried.
    if (!(problem && permanent)) {
      if (ids.data.once) throw error;
      console.warn("[intake-mailbox] read failed", safeError(error));
    }
  }
  if (ids.data.once) return { read: !problem };
  throw new DbJobDeferredError(
    new Date(Date.now() + (provider === "gmail" ? GMAIL_POLL_MS : GRAPH_POLL_MS)).toISOString(),
    "intake_mailbox_next_read",
  );
}

/** Start reading an organization's mailbox; one poll job lives per mailbox. */
export async function startMailboxPolling(db: Db, orgId: string): Promise<void> {
  await dispatchIntakeJob(db, {
    kind: INTAKE_MAILBOX_POLL_JOB,
    payload: { orgId, once: false, renew: false },
    dedupeKey: `${INTAKE_MAILBOX_POLL_JOB}:${orgId}`,
    maxAttempts: 2_147_483_647,
    handler: handleIntakeMailboxPoll,
  });
}

/** Read an organization's mailbox now, as a Graph notification asks. */
async function readMailboxNow(db: Db, orgId: string, renew: boolean): Promise<void> {
  await dispatchIntakeJob(db, {
    kind: INTAKE_MAILBOX_POLL_JOB,
    payload: { orgId, once: true, renew },
    dedupeKey: `${INTAKE_MAILBOX_POLL_JOB}:${orgId}:now`,
    maxAttempts: 3,
    handler: handleIntakeMailboxPoll,
  });
}

/**
 * Make sure every connected mailbox has its poll job, as the maintenance
 * sweep does after a deploy or a job that failed for good.
 */
export async function ensureIntakeMailboxPolls(db: Db): Promise<number> {
  const { data, error } = await db
    .from("intake_automation")
    .select("org_id")
    .eq("email_enabled", true)
    .not("email_provider", "is", null);
  if (error) throw error;
  const rows = (data ?? []) as { org_id: string }[];
  for (const row of rows) await startMailboxPolling(db, row.org_id);
  return rows.length;
}

const graphNotification = z.object({
  value: z
    .array(
      z.object({
        subscriptionId: z.string().max(200).optional(),
        clientState: z.string().max(500).optional(),
        changeType: z.string().max(50).optional(),
        lifecycleEvent: z.string().max(100).optional(),
      }),
    )
    .max(1000),
});

/**
 * Microsoft Graph's notifications for the intake mailbox. The validation
 * handshake echoes Graph's token; a notification must carry the client
 * state MikeGC set, and only queues a read of the mailbox, since it holds no
 * content: a forged one can only make MikeGC read real mail.
 */
export async function receiveGraphNotification(
  db: Db,
  webhookId: string,
  validationToken: string | undefined,
  body: unknown,
): Promise<
  | { kind: "validation"; token: string }
  | { kind: "accepted" }
  | { kind: "refused"; status: 403 | 404 | 400 }
> {
  const settings = await automationByWebhook(db, "email_webhook_id", webhookId);
  if (!settings || settings.email_provider !== "graph") return { kind: "refused", status: 404 };
  if (validationToken !== undefined)
    return validationToken.length > 0 && validationToken.length <= 2000
      ? { kind: "validation", token: validationToken }
      : { kind: "refused", status: 400 };
  const parsed = graphNotification.safeParse(body);
  if (!parsed.success) return { kind: "refused", status: 400 };
  const expected = settings.graph_client_state_hash;
  const valid = parsed.data.value.filter((n) => {
    if (!expected || !n.clientState) return false;
    const a = Buffer.from(hashState(n.clientState));
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!valid.length) return { kind: "refused", status: 403 };
  if (!settings.email_enabled) return { kind: "accepted" };
  const renew = valid.some(
    (n) => n.lifecycleEvent === "reauthorizationRequired" || n.lifecycleEvent === "subscriptionRemoved",
  );
  await readMailboxNow(db, settings.org_id, renew);
  return { kind: "accepted" };
}
