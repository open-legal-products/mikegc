import { getOrgRole, isOrgAdmin } from "../../lib/access";
import type { UserApiKeys } from "../../lib/llm";
import {
  CLAUDE_LOW_MODELS,
  CLAUDE_MID_MODELS,
  GEMINI_LOW_MODELS,
  GEMINI_MID_MODELS,
  MISTRAL_LOW_MODELS,
  MISTRAL_MID_MODELS,
  OPENAI_LOW_MODELS,
  OPENAI_MID_MODELS,
  builtInModelIds,
} from "../../lib/llm/models";
import { hasApiKeyForModel } from "../../lib/modelSelection";
import type { Db } from "../../lib/supabase";
import { envApiKeys, getEffectiveApiKeys } from "../user/user.service";
import type { IntakeChannel } from "@mike/contracts";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  clip,
  type AttachmentCandidate,
  type SkippedAttachment,
} from "./intake.inboundPayload";

/**
 * What intake's AI works from: the model the organization chose for
 * triage, its assignment rules, and a received message as one shape for
 * every channel. Also the request MikeGC records from a message: its
 * fallback fields and its description. The intake agent (intake.agent.ts)
 * decides what to do with a message.
 */

const DESCRIPTION_MAX = 20_000;
export const SUBJECT_MAX = 200;
export const SUMMARY_MAX = 4_000;
// Same rule as the intake_requests check constraint.
const EMAIL = /^[^@\s]+@[^@\s]+$/;
/**
 * Fast, low-cost models, in the order new settings start triage on one. Read
 * when needed, not at import: this module is reached through the user
 * module's facade, whose importers may stand in for the LLM layer.
 */
const triageModels = () => [
  ...CLAUDE_LOW_MODELS,
  ...OPENAI_LOW_MODELS,
  ...GEMINI_LOW_MODELS,
  ...MISTRAL_LOW_MODELS,
];
/** Stronger models, in the order new settings start preprocessing on one. */
const preprocessModels = () => [
  ...CLAUDE_MID_MODELS,
  ...OPENAI_MID_MODELS,
  ...GEMINI_MID_MODELS,
  ...MISTRAL_MID_MODELS,
];

/** A received message as the agent reads it, whichever channel it came from. */
export type InboundMessage = {
  source: IntakeChannel;
  sender: { name: string; email: string | null };
  sentAt: Date;
  /** The email's subject; null for Slack. */
  subject: string | null;
  /** What the fallback subject is made from: the subject or first line. */
  subjectHint: string | null;
  /** The message, or the Slack thread with each message's author and time. */
  text: string;
  candidates: AttachmentCandidate[];
  skipped: SkippedAttachment[];
};

/** How a channel is named in prompts and the request's description. */
export const CHANNEL_NAMES: Record<InboundMessage["source"], string> = {
  slack: "Slack",
  outlook: "Outlook",
  gmail: "Gmail",
  teams: "Teams",
};

/** An assignment rule whose member triage may still assign. */
export type TriageRule = {
  condition: string;
  assignee_id: string;
  /** Whether MikeGC preprocesses what the rule assigns, and following what. */
  preprocess: boolean;
  preprocess_with: { kind: "workflow" | "playbook"; id: string } | null;
};

export type TriageModel = { model: string; apiKeys: UserApiKeys | undefined };

/**
 * The keys intake's AI runs with: the organization's keys as the owner or
 * admin who last saved the settings, or only the deployment's own keys once
 * that person no longer administers the organization.
 */
async function intakeApiKeys(
  db: Db,
  orgId: string,
  configuredBy: string | null,
): Promise<{ apiKeys: UserApiKeys | undefined; available: UserApiKeys }> {
  let apiKeys: UserApiKeys | undefined;
  if (configuredBy && isOrgAdmin(await getOrgRole(configuredBy, orgId, db)))
    apiKeys = await getEffectiveApiKeys(configuredBy, orgId, db);
  return { apiKeys, available: apiKeys ?? envApiKeys() };
}

/**
 * From one lookup of the keys intake runs with as `configuredBy`: the models
 * triage and preprocessing can be set to, every catalogued model with a key,
 * and whether a given model has a key.
 */
export async function intakeModelKeys(
  db: Db,
  orgId: string,
  configuredBy: string | null,
): Promise<{ available: string[]; hasKey: (model: string | null) => boolean }> {
  const keys = (await intakeApiKeys(db, orgId, configuredBy)).available;
  return {
    available: builtInModelIds().filter((id) => hasApiKeyForModel(id, keys)),
    hasKey: (model) => !!model && hasApiKeyForModel(model, keys),
  };
}

/** The models triage and preprocessing can be set to: every catalogued model with a key. */
export async function availableIntakeModels(
  db: Db,
  orgId: string,
  configuredBy: string | null,
): Promise<string[]> {
  return (await intakeModelKeys(db, orgId, configuredBy)).available;
}

/** What new settings start triage on: a fast, low-cost model with a key, if any. */
export function defaultTriageModel(available: string[]): string | null {
  return triageModels().find((id) => available.includes(id)) ?? null;
}

/**
 * What new settings start preprocessing on: a stronger model with a key, as
 * it reads and marks up documents, if any.
 */
export function defaultPreprocessingModel(available: string[]): string | null {
  return preprocessModels().find((id) => available.includes(id)) ?? null;
}

/**
 * The model and keys triage or preprocessing runs with: the model the
 * organization chose for it, if it still has a key. Null when none is chosen
 * or its key has gone; neither runs without a model.
 */
export async function resolveIntakeModel(
  db: Db,
  orgId: string,
  configuredBy: string | null,
  model: string | null,
): Promise<TriageModel | null> {
  if (!model) return null;
  const { apiKeys, available } = await intakeApiKeys(db, orgId, configuredBy);
  return hasApiKeyForModel(model, available) ? { model, apiKeys } : null;
}

/**
 * The day relative dates in a message count from, in UTC as YYYY-MM-DD: the
 * day it was sent, so "by Friday" means the Friday after it was written even
 * when it is read later. A sent time after `now` counts as `now`.
 */
export function today(sentAt: Date, now: Date): string {
  return (sentAt > now ? now : sentAt).toISOString().slice(0, 10);
}

/**
 * The organization's assignment rules, in order, leaving out any whose member
 * has asked for their account to be deleted. A member who has left takes
 * their rules with them.
 */
export async function loadTriageRules(
  db: Db,
  orgId: string,
): Promise<TriageRule[]> {
  const { data, error } = await db
    .from("intake_assignment_rules")
    .select("condition, assignee_id, preprocess, preprocess_kind, preprocess_ref")
    .eq("org_id", orgId)
    .order("position", { ascending: true });
  if (error) throw error;
  const rules = (
    (data ?? []) as {
      condition: string;
      assignee_id: string;
      preprocess: boolean;
      preprocess_kind: "workflow" | "playbook" | null;
      preprocess_ref: string | null;
    }[]
  ).map((r) => ({
    condition: r.condition,
    assignee_id: r.assignee_id,
    preprocess: r.preprocess,
    preprocess_with:
      r.preprocess_kind && r.preprocess_ref
        ? { kind: r.preprocess_kind, id: r.preprocess_ref }
        : null,
  }));
  if (rules.length === 0) return [];
  const { data: profiles, error: profileError } = await db
    .from("user_profiles")
    .select("user_id, account_deletion_requested_at")
    .in("user_id", [...new Set(rules.map((r) => r.assignee_id))]);
  if (profileError) throw profileError;
  const leaving = new Set(
    (
      (profiles ?? []) as {
        user_id: string;
        account_deletion_requested_at: string | null;
      }[]
    )
      .filter((p) => p.account_deletion_requested_at)
      .map((p) => p.user_id),
  );
  return rules.filter((r) => !leaving.has(r.assignee_id));
}

/** Name <address>, or whichever of the two is known. */
export function senderLine(sender: InboundMessage["sender"]): string {
  return sender.email ? `${sender.name} <${sender.email}>` : sender.name;
}

/**
 * "2 Nov 2026, 09:14 UTC". The time is written into the request's text, which
 * every member reads wherever they are, so it says which clock it is on.
 */
export function formatSent(date: Date): string {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${when} UTC`;
}

/** One line of text, trimmed and collapsed, no longer than `max`. */
export function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > max
    ? clip(collapsed, max - 1).trimEnd() + "…"
    : collapsed;
}

/** A real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 2000 &&
    y <= 2100 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** The request MikeGC records from the message alone, with no model. */
export function fallbackFields(message: InboundMessage) {
  return {
    subject:
      line(message.subjectHint, SUBJECT_MAX) ??
      line(`Request from ${message.sender.name}`, SUBJECT_MAX)!,
    requester_name: line(message.sender.name, 200) ?? "Unknown sender",
    requester_email: validEmail(message.sender.email),
  };
}

export function validEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.length >= 3 && email.length <= 320 && EMAIL.test(email)
    ? email
    : null;
}

export const SKIPPED_REASON: Record<SkippedAttachment["reason"], string> = {
  type: "not a PDF, Word, Excel or PowerPoint file",
  size: `larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`,
  count: `more than ${MAX_ATTACHMENTS} attachments`,
  unreadable: "could not be read",
};

/** The line between a request's summary and the message it was recorded from. */
export const ORIGINAL_MESSAGE = "--- Original message ---";

/**
 * The request's description: the summary, then the original message with its
 * sender and time, then the attachments left off. Without a summary it is
 * the message itself. The message is shortened to fit 20,000 characters.
 */
export function composeDescription(args: {
  summary: string | null;
  message: InboundMessage;
}): string {
  const { summary, message } = args;
  const text = message.text.trim() || "(The message had no text.)";
  const head = summary
    ? [
        summary,
        "",
        ORIGINAL_MESSAGE,
        `From: ${senderLine(message.sender)} in ${CHANNEL_NAMES[message.source]}`,
        `Sent: ${formatSent(message.sentAt)}`,
        ...(message.subject ? [`Subject: ${message.subject}`] : []),
        "",
      ].join("\n") + "\n"
    : "";
  const tail = message.skipped.length
    ? "\n\n--- Not attached ---\n" +
      message.skipped
        .map((s) => `- ${s.name}: ${SKIPPED_REASON[s.reason]}`)
        .join("\n")
    : "";
  const shortened = "\n[Message shortened to fit.]";
  const room = DESCRIPTION_MAX - head.length - tail.length;
  // The skipped list is bounded by the message's attachments, but a
  // pathological one still must not crowd out the message.
  if (room < 1000)
    return clip(head + clip(text, 1000) + tail, DESCRIPTION_MAX);
  const body =
    text.length > room ? clip(text, room - shortened.length) + shortened : text;
  return head + body + tail;
}
