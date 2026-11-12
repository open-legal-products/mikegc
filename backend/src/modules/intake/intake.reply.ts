import type { IntakeExternalAuthor } from "@mike/contracts";
import { NonRetryableJobError } from "../../lib/dbq/runner";
import { safeError } from "../../lib/safeError";
import type { Db } from "../../lib/supabase";
import {
  addDocuments,
  channelAttachments,
  type CandidateDownloader,
} from "./intake.attachments";
import {
  saveInboundPayload,
  settleInbound,
  slackFileRefs,
} from "./intake.automationJob";
import {
  loadRequestLink,
  updateLinkAddress,
  type ChannelLink,
} from "./intake.channels";
import { runIntakeAgent, type AgentField, type AgentRequest } from "./intake.agent";
import type { InboundRow } from "./intake.agentJob";
import { MAX_CLARIFY_ROUNDS, stableId } from "./intake.clarify";
import {
  MAX_ATTACHMENT_BYTES,
  cleanText,
  clip,
  replyPayload,
  type AgentPlan,
  type AttachmentCandidate,
  type ReplyPayload,
  type SkippedAttachment,
} from "./intake.inboundPayload";
import { recordEmailMessageIds } from "./intake.mail";
import {
  answerRequester,
  askRequester,
  loadThreadEntries,
  settleClarify,
} from "./intake.outbox";
import {
  queueIntakePreprocess,
  queueNextIntakePreprocess,
} from "./intake.preprocess";
import { slackBotToken } from "./intake.secrets";
import { loadAutomationRow, type AutomationRow } from "./intake.settingsRow";
import { intakeRpc } from "./intake.shared";
import {
  SlackApiError,
  downloadSlackFile,
  isPermanentSlackError,
  mentionedUsers,
  slackTextToPlain,
  slackThreadMessage,
  slackUserInfo,
} from "./intake.slack";
import {
  isPermanentTeamsError,
  teamsDownloadFile,
  teamsMemberEmail,
} from "./intake.teams";
import {
  CHANNEL_NAMES,
  SKIPPED_REASON,
  loadTriageRules,
  resolveIntakeModel,
} from "./intake.triage";

/**
 * The intake.agent job's reply branch: a requester's message in a request's
 * thread. It is recorded on the request as a reply, with its files as the
 * request's documents. An answer to the readiness check's questions runs its
 * next round. On any other open request the intake agent reads the reply: it
 * updates the request's details from it, chooses the rule or asks once more
 * while the rule waits on the requester, and answers in the thread.
 */

const BODY_MAX = 20_000;
const CLOSED_STATES = new Set(["resolved", "cancelled"]);

type ReplyContent = {
  text: string;
  author: IntakeExternalAuthor;
  candidates: AttachmentCandidate[];
  skipped: SkippedAttachment[];
};

/** A Slack reply, read from Slack: null once it has been deleted. */
async function slackReply(
  settings: AutomationRow,
  payload: Extract<ReplyPayload, { kind: "slack_reply" }>,
): Promise<ReplyContent | null> {
  const token = slackBotToken(settings);
  if (!token)
    throw new NonRetryableJobError(
      "Slack isn't connected. Save the bot token in Intake settings.",
    );
  const message = await slackThreadMessage(token, {
    channel: payload.channel,
    threadTs: payload.thread_ts,
    ts: payload.ts,
  });
  if (!message) return null;
  const raw = cleanText(message.text ?? "");
  const ids = [...new Set([payload.user, ...mentionedUsers(raw)])].slice(0, 20);
  const names = new Map<string, string>();
  let author: { name: string | null; email: string | null } = { name: null, email: null };
  for (const id of ids) {
    try {
      const person = await slackUserInfo(token, id);
      if (person?.name) names.set(id, person.name);
      if (id === payload.user && person) author = person;
    } catch (error) {
      if (isPermanentSlackError(error)) throw error;
    }
  }
  return {
    text: slackTextToPlain(raw, names, settings.slack_bot_user_id),
    author: { ...author, source: "slack", user_id: payload.user },
    ...channelAttachments(slackFileRefs(message.files), "slack"),
  };
}

async function readReply(
  settings: AutomationRow,
  payload: ReplyPayload,
  link: ChannelLink,
): Promise<ReplyContent | null> {
  switch (payload.kind) {
    case "slack_reply":
      return slackReply(settings, payload);
    case "mail_reply":
      return {
        text: payload.text,
        author: {
          name: payload.from.name,
          email: payload.from.email,
          source: payload.provider === "graph" ? "outlook" : "gmail",
        },
        candidates: payload.attachments.map((a) => ({
          name: a.name,
          file_type: a.file_type,
          size: a.size,
          key: a.key,
          url: null,
        })),
        skipped: payload.skipped,
      };
    case "teams_reply": {
      const email = await teamsMemberEmail(settings, link, payload.from.id).catch(
        (error) => {
          if (isPermanentTeamsError(error)) throw error;
          return null;
        },
      );
      return {
        text: payload.text,
        author: {
          name: payload.from.name,
          email,
          source: "teams",
          user_id: payload.from.aad_object_id ?? payload.from.id,
        },
        ...channelAttachments(payload.files, "teams"),
      };
    }
  }
}

/** The reply as recorded: its text, then any files that couldn't be added. */
export function replyBody(content: ReplyContent): string {
  const files = content.candidates.map((c) => c.name);
  const text =
    content.text.trim() ||
    (files.length ? `Sent ${files.length === 1 ? "a file" : "files"}: ${files.join(", ")}` : "(No text.)");
  const skipped = content.skipped.length
    ? "\n\nNot attached:\n" +
      content.skipped.map((s) => `- ${s.name}: ${SKIPPED_REASON[s.reason]}`).join("\n")
    : "";
  const room = BODY_MAX - skipped.length;
  return (text.length > room ? clip(text, room - 30) + "\n[Reply shortened.]" : text) + skipped;
}

function downloader(settings: AutomationRow): CandidateDownloader {
  return async (candidate) => {
    if (!candidate.url) return null;
    if (candidate.via === "teams")
      return teamsDownloadFile(settings, candidate.url, MAX_ATTACHMENT_BYTES);
    const token = slackBotToken(settings);
    return token ? downloadSlackFile(token, candidate.url, MAX_ATTACHMENT_BYTES) : null;
  };
}

type ReplyResult = {
  request_id: string;
  message_id: string;
  state: string;
  assignee_id: string | null;
  clarify_stage: "rule" | "readiness" | null;
  clarify_rounds: number;
  clarify_stopped: boolean;
};

/** The request as the agent reads it, or null once it is gone. */
async function loadAgentRequest(
  db: Db,
  orgId: string,
  reply: ReplyResult,
): Promise<AgentRequest | null> {
  const { data, error } = await db
    .from("intake_requests")
    .select("subject, description, requested_by_date, state, member_edited_fields")
    .eq("org_id", orgId)
    .eq("id", reply.request_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const request = data as {
    subject: string;
    description: string;
    requested_by_date: string | null;
    state: string;
    member_edited_fields?: AgentField[] | null;
  };
  return {
    subject: request.subject,
    description: request.description,
    requested_by_date: request.requested_by_date,
    state: request.state,
    member_edited_fields: request.member_edited_fields ?? [],
    ruleUndecided: reply.clarify_stage === "rule",
    canAsk: !reply.clarify_stopped && reply.clarify_rounds < MAX_CLARIFY_ROUNDS,
  };
}

/**
 * Change the request's details as the agent planned. A detail a member has
 * edited since is skipped by the database; details it refuses are dropped,
 * as the requester's words can't be trusted to fit.
 */
async function updateRequest(
  db: Db,
  args: {
    orgId: string;
    requestId: string;
    noteId: string;
    update: NonNullable<AgentPlan["update"]>;
  },
): Promise<void> {
  const updated = await intakeRpc<string[]>(db, "intake_update_automated", {
    p_org: args.orgId,
    p_request: args.requestId,
    p_note: args.noteId,
    p_subject: args.update.subject,
    p_description: args.update.description,
    p_date: args.update.requested_by_date,
    p_lines: args.update.lines,
  });
  if (updated.ok || updated.kind === "not_found") return;
  if (updated.kind === "validation") {
    console.warn("[intake-reply] update refused by the database");
    return;
  }
  throw updated.kind === "error" ? updated.error : new Error(updated.detail);
}

/**
 * The agent's turn on a reply: plan once, saving the plan with the stage it
 * was made at, then update the request, at the rule stage ask once more or
 * settle the rule, and answer the requester in the thread.
 */
async function runAgentOnReply(
  db: Db,
  args: {
    row: InboundRow;
    settings: AutomationRow;
    link: ChannelLink;
    reply: ReplyResult;
    payload: ReplyPayload;
    save: () => Promise<void>;
  },
): Promise<void> {
  const { row, settings, link, reply, payload, save } = args;
  const orgId = link.org_id;
  const requestId = reply.request_id;
  if (!payload.agent) {
    const [request, thread, rules, model] = await Promise.all([
      loadAgentRequest(db, orgId, reply),
      loadThreadEntries(db, orgId, requestId),
      loadTriageRules(db, orgId),
      resolveIntakeModel(db, orgId, settings.configured_by, settings.triage_model),
    ]);
    if (!request) return;
    payload.agent = await runIntakeAgent({
      context: { kind: "reply", channel: link.source, request, thread, sentAt: new Date() },
      rules,
      model,
    });
    payload.agentStage = reply.clarify_stage === "rule" ? "rule" : null;
    payload.agentRound = reply.clarify_rounds;
    await save();
  }
  const plan = payload.agent;
  if (plan.update && !payload.updated) {
    await updateRequest(db, {
      orgId,
      requestId,
      noteId: stableId(`intake.agent.update:${row.id}`),
      update: plan.update,
    });
    payload.updated = true;
    await save();
  }
  if (payload.agentStage === "rule") {
    const asked = await settleRule(db, { orgId, requestId, plan, payload, save });
    if (asked) return;
  }
  // The agent's answer, once the rule is settled so it can say so.
  if (plan.answer && !payload.answered) {
    await answerRequester(db, {
      orgId,
      requestId,
      seed: row.id,
      text: plan.answer,
    });
    payload.answered = true;
    await save();
  }
}

/**
 * At the rule stage: ask once more, or settle on the chosen rule (or none)
 * and start its preprocessing. True when MikeGC asked.
 */
async function settleRule(
  db: Db,
  args: {
    orgId: string;
    requestId: string;
    plan: AgentPlan;
    payload: ReplyPayload;
    save: () => Promise<void>;
  },
): Promise<boolean> {
  const { orgId, requestId, plan, payload, save } = args;
  const round = payload.agentRound ?? 0;
  if (
    plan.questions.length &&
    payload.ruleSettled === undefined &&
    (await askRequester(db, {
      orgId,
      requestId,
      seed: `${requestId}:rule:${round}`,
      questions: plan.questions,
      stage: "rule",
      acknowledge: false,
    }))
  )
    return true;
  // Decided, or it can't ask again: a request that matches no rule stays unassigned.
  if (payload.ruleSettled === undefined) {
    payload.ruleSettled = await settleClarify(db, {
      orgId,
      requestId,
      stage: "rule",
      assign: true,
      assigneeId: plan.rule?.assignee_id ?? null,
    });
    await save();
  }
  const preprocess = plan.rule?.preprocess;
  if (payload.ruleSettled && preprocess && !payload.preprocessQueued) {
    await queueIntakePreprocess(db, {
      orgId,
      requestId,
      with: preprocess.with,
      condition: preprocess.condition ?? null,
      round,
    });
    payload.preprocessQueued = true;
    await save();
  }
  return false;
}

async function processReply(db: Db, row: InboundRow): Promise<Record<string, unknown>> {
  const parsed = replyPayload.safeParse(row.payload);
  if (!parsed.success)
    throw new NonRetryableJobError("The received reply couldn't be read.");
  const payload = parsed.data;
  const save = () => saveInboundPayload(db, row.id, payload);
  const done = async (result: Record<string, unknown>) => {
    await settleInbound(db, row.id, "done", null, payload);
    return result;
  };
  // The request was deleted, or purged, since the reply arrived.
  if (!row.request_id) return done({ skipped: "request_gone" });
  const [settings, link] = await Promise.all([
    loadAutomationRow(db, row.org_id),
    loadRequestLink(db, row.org_id, row.request_id),
  ]);
  if (!settings || !link) return done({ skipped: "request_gone" });
  const content = await readReply(settings, payload, link);
  if (!content) return done({ skipped: "message_gone" });
  const messageId = stableId(`intake.reply:${row.id}`);
  const recorded = await intakeRpc<ReplyResult | null>(db, "intake_reply_automated", {
    p_org: row.org_id,
    p_inbound: row.id,
    p_message: messageId,
    p_body: replyBody(content),
    p_author: {
      name: content.author.name ? clip(content.author.name, 200) : null,
      email: content.author.email ? clip(content.author.email, 320) : null,
      source: content.author.source,
      ...(content.author.user_id ? { user_id: clip(content.author.user_id, 200) } : {}),
    },
  });
  if (!recorded.ok) {
    if (recorded.kind === "not_found") return done({ skipped: "request_gone" });
    throw recorded.kind === "error" ? recorded.error : new Error(recorded.detail);
  }
  const reply = recorded.data;
  if (!reply) return done({ skipped: "request_gone" });
  if (!payload.recorded) {
    payload.recorded = true;
    await save();
  }
  payload.documents ??= {};
  const attached = await addDocuments(db, {
    orgId: row.org_id,
    requestId: reply.request_id,
    candidates: content.candidates,
    chosen: content.candidates.map((_, i) => i),
    documents: payload.documents,
    save,
    download: downloader(settings),
    messageId,
  });
  if (!attached) return done({ skipped: "request_gone" });
  if (payload.kind === "mail_reply") {
    // Later replies thread on this one, the newest in the thread.
    await recordEmailMessageIds(db, row.org_id, link.id, [payload.message_id]);
    await updateLinkAddress(db, link, { reply_to_message_id: payload.provider_id });
  }
  if (payload.kind === "teams_reply")
    await updateLinkAddress(db, link, { service_url: payload.service_url });
  // An answer to the readiness check's questions runs its next round; on
  // any other open request, the agent reads the reply. A plan already made
  // is carried out even if the request has moved on since.
  if (!payload.agent && reply.clarify_stage === "readiness")
    await queueNextIntakePreprocess(db, row.org_id, reply.request_id);
  else if (payload.agent || !CLOSED_STATES.has(reply.state))
    await runAgentOnReply(db, { row, settings, link, reply, payload, save });
  return done({
    request_id: reply.request_id,
    stage: reply.clarify_stage,
    files: content.candidates.length,
  });
}

/** A reply, waiting. Slack or Teams refusing to give it up fails it at once. */
export async function runReply(
  db: Db,
  row: InboundRow,
): Promise<Record<string, unknown>> {
  try {
    return await processReply(db, row);
  } catch (error) {
    if (isPermanentSlackError(error) || isPermanentTeamsError(error))
      throw new NonRetryableJobError(
        error instanceof SlackApiError
          ? "MikeGC couldn't read a reply in Slack."
          : "MikeGC couldn't read a reply in Teams.",
      );
    throw error;
  }
}

/** When a reply's job has failed for good: settle it without its content. */
export async function markReplyFailed(db: Db, row: InboundRow): Promise<void> {
  await settleInbound(
    db,
    row.id,
    "failed",
    `MikeGC couldn't record a reply in the request's ${channelName(row.payload)} thread.`,
    row.payload,
  ).catch((error) => console.warn("[intake-reply] not settled", safeError(error)));
}

function channelName(payload: unknown): string {
  const kind = (payload as { kind?: string } | null)?.kind;
  if (kind === "slack_reply") return CHANNEL_NAMES.slack;
  if (kind === "teams_reply") return CHANNEL_NAMES.teams;
  return "email";
}
