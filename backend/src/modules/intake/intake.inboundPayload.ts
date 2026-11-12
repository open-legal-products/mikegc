import { z } from "zod";

/**
 * What MikeGC keeps of a received message until it is handled, and the
 * progress a retried job resumes from. The row's payload is cleared once the
 * message is done, failed or ignored; the request then holds its content.
 */

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Longest message text kept; the request's description is shorter still. */
export const MAX_MESSAGE_CHARS = 100_000;

/** Why an attachment was left off the request, listed in its description. */
export const skippedReason = z.enum(["type", "size", "count", "unreadable"]);
export type SkippedReason = z.infer<typeof skippedReason>;
const skipped = z.object({ name: z.string(), reason: skippedReason });
export type SkippedAttachment = z.infer<typeof skipped>;

/** A file Slack shared on the message, read later with the bot token. */
const slackFile = z.object({
  id: z.string().nullable(),
  name: z.string(),
  size: z.number().nullable(),
  url: z.string().nullable(),
});
export type SlackFileRef = z.infer<typeof slackFile>;

/**
 * An accepted attachment: an email's bytes staged in storage under `key`, or
 * a Slack file to download from `url`.
 */
const candidate = z.object({
  name: z.string(),
  file_type: z.string(),
  size: z.number().nullable(),
  key: z.string().nullable(),
  url: z.string().nullable(),
  /** Where `url` is read from: Slack with the bot token, Teams through Graph. */
  via: z.enum(["slack", "teams"]).nullable().optional(),
});
export type AttachmentCandidate = z.infer<typeof candidate>;

/** A rule's preprocessing: the workflow or playbook to follow, and its condition. */
const preprocessPlan = z.object({
  with: z
    .object({ kind: z.enum(["workflow", "playbook"]), id: z.string() })
    .nullable(),
  /** The rule's condition, which the readiness check reads. */
  condition: z.string().nullable().default(null),
});

/**
 * What the intake agent decided for one message, saved before any of it is
 * done so a retry does the same without asking the model again. Every value
 * here was checked by the tool that set it.
 */
export const agentPlan = z.object({
  /** Whether a model shaped the plan, or the safe defaults did. */
  agent: z.boolean(),
  /** MikeGC's answer in a thread with no request; nothing is recorded. */
  reply: z.string().nullable().default(null),
  /** MikeGC's questions on the request, so its rule can be chosen. */
  questions: z.array(z.string()).default([]),
  /**
   * MikeGC's answer to the requester in a recorded request's thread: what it
   * took from their message, or a reply to it. The request doesn't wait.
   */
  answer: z.string().nullable().default(null),
  /** The request to record, for a message that has none yet. */
  record: z
    .object({
      subject: z.string(),
      description: z.string(),
      requester_name: z.string(),
      requester_email: z.string().nullable(),
      requested_by_date: z.string().nullable(),
      /** Indexes into `candidates` of the attachments to add. */
      attachments: z.array(z.number().int().nonnegative()),
    })
    .nullable()
    .default(null),
  /**
   * The rule chosen, once decided: its member (null when no rule fits) and
   * its preprocessing. Null while the rule is undecided.
   */
  rule: z
    .object({
      assignee_id: z.string().nullable(),
      preprocess: preprocessPlan.nullable(),
    })
    .nullable()
    .default(null),
  /**
   * Details to change on the request a reply is about, each with the words
   * MikeGC's note uses for it, by field.
   */
  update: z
    .object({
      subject: z.string().nullable(),
      description: z.string().nullable(),
      requested_by_date: z.string().nullable(),
      lines: z.record(z.string(), z.string()),
    })
    .nullable()
    .default(null),
  candidates: z.array(candidate).default([]),
});
export type AgentPlan = z.infer<typeof agentPlan>;

/** Each attachment's document, named before it is made so it is made once. */
const documentEntry = z.object({
  document_id: z.string(),
  version_id: z.string(),
  done: z.boolean(),
});
export type DocumentEntry = z.infer<typeof documentEntry>;

const progress = {
  agent: agentPlan.optional(),
  documents: z.record(z.string(), documentEntry).optional(),
  /**
   * Set once the request is recorded. The message's link to it is cleared if
   * the request is deleted, and this tells that apart from never recorded.
   */
  recorded: z.boolean().optional(),
  /** Set once MikeGC answered in the chat instead of recording a request. */
  conversed: z.boolean().optional(),
  /** Set once that answer is counted against the thread's rounds. */
  remembered: z.boolean().optional(),
  /** Set once the Slack thread had MikeGC's answer, before the outbox. */
  replied: z.boolean().optional(),
  /** Set once the request is linked to its thread. */
  linked: z.boolean().optional(),
  /** Set once MikeGC's acknowledgement (or first questions) is in the outbox. */
  acknowledged: z.boolean().optional(),
  /** Set once AI preprocessing is queued, so it is queued once. */
  preprocessQueued: z.boolean().optional(),
  /** Set once a related request's note pointing here is posted. */
  relatedNoted: z.boolean().optional(),
};

export const slackInboundPayload = z.object({
  kind: z.literal("slack"),
  /** The Slack workspace, part of the thread's key. */
  team_id: z.string().nullable().optional(),
  channel: z.string(),
  ts: z.string(),
  /** The thread the mention was posted in, when not at the top level. */
  thread_ts: z.string().nullable(),
  user: z.string(),
  text: z.string(),
  files: z.array(slackFile),
  ...progress,
});
export type SlackInboundPayload = z.infer<typeof slackInboundPayload>;

const stagedAttachment = z.object({
  name: z.string(),
  file_type: z.string(),
  size: z.number(),
  key: z.string(),
});
const person = z.object({ name: z.string().nullable(), email: z.string().nullable() });

/** What an Outlook or Gmail message keeps until it is handled. */
const mailFields = {
  provider: z.enum(["graph", "gmail"]),
  /** The intake mailbox it arrived in. */
  mailbox: z.string(),
  /** The provider's ID for the message, which a reply is made to. */
  provider_id: z.string(),
  /** Its Message-ID header. */
  message_id: z.string(),
  /** Outlook's conversationId or Gmail's threadId. */
  thread: z.string(),
  from: person,
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string().nullable(),
  /** When it was sent, ISO 8601. */
  date: z.string(),
  text: z.string(),
  attachments: z.array(stagedAttachment),
  skipped: z.array(skipped),
  /** The Message-IDs it answers (In-Reply-To, then References). */
  references: z.array(z.string()).default([]),
};

/** A new email to the intake mailbox. */
export const mailInboundPayload = z.object({
  kind: z.literal("mail"),
  ...mailFields,
  /**
   * The request whose thread this mail is in, when its sender isn't on that
   * thread: it becomes a new request, and the other gets a note linking here.
   */
  related_request_id: z.string().nullable().default(null),
  ...progress,
});
export type MailInboundPayload = z.infer<typeof mailInboundPayload>;

const teamsFile = z.object({
  name: z.string(),
  size: z.number().nullable(),
  /** The SharePoint URL of a file shared in the channel. */
  url: z.string().nullable(),
});
export type TeamsFileRef = z.infer<typeof teamsFile>;

/** Where a Teams channel thread is, as an activity names it. */
const teamsThread = {
  tenant_id: z.string(),
  service_url: z.string(),
  /** The thread's conversation ID, ending in ;messageid=<root>. */
  conversation_id: z.string(),
  team_id: z.string().nullable(),
  /** The team's Microsoft 365 group, which Graph names it by. */
  aad_group_id: z.string().nullable(),
  channel_id: z.string().nullable(),
  root_message_id: z.string(),
  team_name: z.string().nullable().default(null),
  channel_name: z.string().nullable().default(null),
};

/** A Teams message that mentions MikeGC in a thread with no request. */
export const teamsInboundPayload = z.object({
  kind: z.literal("teams"),
  ...teamsThread,
  activity_id: z.string(),
  from: z.object({
    id: z.string(),
    aad_object_id: z.string().nullable(),
    name: z.string().nullable(),
  }),
  /** When it was sent, ISO 8601. */
  date: z.string(),
  text: z.string(),
  files: z.array(teamsFile),
  ...progress,
});
export type TeamsInboundPayload = z.infer<typeof teamsInboundPayload>;

export const inboundPayload = z.discriminatedUnion("kind", [
  slackInboundPayload,
  mailInboundPayload,
  teamsInboundPayload,
]);
export type InboundPayload = z.infer<typeof inboundPayload>;

/** A reply's progress, which a retried intake.reply job resumes from. */
const replyProgress = {
  documents: z.record(z.string(), documentEntry).optional(),
  /** Set once the reply is on the request. */
  recorded: z.boolean().optional(),
  /**
   * The agent's plan for the reply, with the request as the agent read it:
   * whether its rule was undecided, and MikeGC's rounds of questions so far.
   */
  agent: agentPlan.optional(),
  agentStage: z.enum(["rule"]).nullable().optional(),
  agentRound: z.number().int().nonnegative().optional(),
  /** Set once the plan's changes to the request's details are made. */
  updated: z.boolean().optional(),
  /** Set once the rule stage is settled: true when it was still waiting. */
  ruleSettled: z.boolean().optional(),
  /** Set once the chosen rule's preprocessing is queued. */
  preprocessQueued: z.boolean().optional(),
  /** Set once MikeGC's answer is in the request's thread. */
  answered: z.boolean().optional(),
};

/** A requester's message in a linked Slack thread: read from Slack when handled. */
export const slackReplyPayload = z.object({
  kind: z.literal("slack_reply"),
  channel: z.string(),
  ts: z.string(),
  thread_ts: z.string(),
  user: z.string(),
  ...replyProgress,
});
/** A reply in a linked email thread, with its attachments staged. */
export const mailReplyPayload = z.object({
  kind: z.literal("mail_reply"),
  ...mailFields,
  ...replyProgress,
});
/** A message in a linked Teams thread. */
export const teamsReplyPayload = z.object({
  kind: z.literal("teams_reply"),
  activity_id: z.string(),
  service_url: z.string(),
  from: z.object({
    id: z.string(),
    aad_object_id: z.string().nullable(),
    name: z.string().nullable(),
  }),
  date: z.string(),
  text: z.string(),
  files: z.array(teamsFile),
  ...replyProgress,
});
export const replyPayload = z.discriminatedUnion("kind", [
  slackReplyPayload,
  mailReplyPayload,
  teamsReplyPayload,
]);
export type ReplyPayload = z.infer<typeof replyPayload>;

/** Storage keys an email's attachments wait under until it is handled. */
export function stagedKeys(payload: unknown): string[] {
  const value = payload as { attachments?: unknown } | null;
  if (!value || !Array.isArray(value.attachments)) return [];
  return value.attachments.flatMap((a) =>
    a && typeof a === "object" && typeof (a as { key?: unknown }).key === "string"
      ? [(a as { key: string }).key]
      : [],
  );
}

/** Postgres text cannot hold NUL, and a lone surrogate is not valid UTF-8. */
export function cleanText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const end = /[\uD800-\uDBFF]/.test(value.charAt(max - 1)) ? max - 1 : max;
  return value.slice(0, end);
}
