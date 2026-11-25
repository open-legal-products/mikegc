import { z } from "zod";
export const intakeId = z.uuid();
/** A team organization's id, or "personal" for the caller's own workspace. */
export const intakeWorkspace = z.union([z.literal("personal"), intakeId]);
/** One of a fixed set of whole-number periods, from the query string. */
const period = <T extends number>(choices: readonly T[], fallback: T) =>
  z.coerce
    .number()
    .refine((v): v is T => choices.includes(v as T))
    .default(fallback);
/** The viewer's timezone, as the browser names it; the database checks it. */
const viewerTimezone = z.string().min(1).max(64).default("UTC");
/**
 * The viewer's timezone, which the dashboard counts its weeks and overdue
 * requests in, and the periods its figures cover.
 */
export const intakeDashboardQuery = z
  .object({
    timezone: viewerTimezone,
    weeks: period([4, 8, 12, 26] as const, 8),
    created_days: period([7, 30, 90, 365] as const, 30),
    resolved_days: period([7, 30, 90, 365] as const, 30),
    median_days: period([30, 90, 365] as const, 30),
  })
  .strict();
/** Bound submitted text without changing the exact content later shown for review. */
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim().length > 0);
const states = z.enum([
  "submitted",
  "in_review",
  "needs_information",
  "resolved",
  "cancelled",
]);
export const intakePage = z.object({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const intakeList = z.object({
  state: states.optional(),
  assignee: z.union([z.enum(["unassigned", "me"]), intakeId]).optional(),
  search: z.string().max(200).default(""),
  sort: z.enum(["updated", "updated_asc", "target"]).default("updated"),
  /** What a dashboard figure counted, so it can open those requests. */
  scope: z
    .enum(["open", "unassigned", "overdue", "recorded_30d", "resolved_30d"])
    .optional(),
  /** One requester's name, matched without case. */
  requester: z.string().trim().min(1).max(200).optional(),
  /** The viewer's, in which a target date that has passed is overdue. */
  timezone: viewerTimezone,
  /** Only requests with a reply nobody has opened yet. */
  new_reply: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const details = {
  subject: text(200),
  description: text(20000),
  requester_name: text(200),
  // Same rule as the intake_requests check constraint and the form, so an
  // address the database accepted (including a backfilled one) stays valid.
  requester_email: z
    .string()
    .min(3)
    .max(320)
    .regex(/^[^@\s]+@[^@\s]+$/)
    .nullable()
    .default(null),
  requester_team: text(200).nullable().default(null),
  /** A calendar date, overdue once it has passed where the viewer is. */
  requested_by_date: z.iso.date().nullable().default(null),
};
export const intakeSubmit = z
  .object({
    ...details,
    id: intakeId,
    command_id: intakeId,
    assignee_id: intakeId.nullable().default(null),
  })
  .strict();
export const intakeEdit = z
  .object({
    ...details,
    command_id: intakeId,
    expected_version: z.number().int().positive(),
  })
  .strict();
const versioned = {
  command_id: intakeId,
  expected_version: z.number().int().positive(),
};
/** Each command's body, keyed by its URL action. */
/** Documents the actor can read, copied onto a request or their note. */
export const intakeDocumentCopy = z
  .object({
    document_ids: z.array(intakeId).min(1).max(20),
    message_id: intakeId.nullable().default(null),
  })
  .strict();
export const intakeCommands = {
  assignment: z
    .object({ ...versioned, assignee_id: intakeId.nullable() })
    .strict(),
  notes: z.object({ command_id: intakeId, body: text(20000) }).strict(),
  // Sent to the requester, a question needs its text.
  wait: z
    .object({
      ...versioned,
      body: text(20000).optional(),
      send_to_requester: z.boolean().default(false),
    })
    .strict()
    .refine((v) => !v.send_to_requester || v.body !== undefined),
  resume: z.object({ ...versioned, body: text(20000).optional() }).strict(),
  resolve: z
    .object({
      ...versioned,
      body: text(20000).optional(),
      send_to_requester: z.boolean().default(false),
      /** The request's documents to send with the resolution; the database checks them. */
      documents: z.array(intakeId).max(10).optional(),
      /** The reply sent to the requester, written apart from the resolution. */
      reply: text(20000).optional(),
    })
    .strict()
    .refine(
      (v) =>
        v.send_to_requester ||
        (v.documents === undefined && v.reply === undefined),
    ),
  cancel: z.object({ ...versioned, body: text(20000) }).strict(),
  reopen: z.object(versioned).strict(),
  delete: z.object(versioned).strict(),
  stop_asking: z.object(versioned).strict(),
} as const;
export type IntakeCommandAction = keyof typeof intakeCommands;
export type IntakeCommandInput = {
  command_id: string;
  expected_version?: number;
  body?: string;
  assignee_id?: string | null;
  send_to_requester?: boolean;
  documents?: string[];
  reply?: string;
};
/** A change to automated intake; secrets are write-only and bounded. */
export const intakeAutomationUpdate = z
  .object({
    email_enabled: z.boolean().optional(),
    email_allowed_domains: z.array(z.string().max(255)).max(50).optional(),
    email_from_name: z.string().trim().min(1).max(80).optional(),
    teams_enabled: z.boolean().optional(),
    teams_app_id: z.string().trim().regex(/^[0-9a-fA-F-]{36}$/).optional(),
    teams_tenant_id: z.string().trim().regex(/^[0-9a-fA-F-]{36}$/).optional(),
    teams_client_secret: z.string().trim().min(1).max(500).optional(),
    teams_use_outlook_app: z.literal(true).optional(),
    slack_enabled: z.boolean().optional(),
    slack_signing_secret: z.string().trim().min(1).max(300).optional(),
    slack_bot_token: z
      .string()
      .trim()
      .max(300)
      .regex(/^xoxb-[\x21-\x7e]+$/)
      .optional(),
    triage_model: z.string().trim().min(1).max(200).nullable().optional(),
    preprocessing_model: z.string().trim().min(1).max(200).nullable().optional(),
    rules: z
      .array(
        z
          .object({
            condition: z.string().trim().min(1).max(500),
            assignee_id: intakeId,
            preprocess: z.boolean().default(false),
            preprocess_with: z
              .object({
                kind: z.enum(["workflow", "playbook"]),
                id: z.string().trim().min(1).max(200),
                // Shown to the reader; the saved reference is kind and id.
                name: z.string().max(500).nullable().optional(),
              })
              .strict()
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();
const AUTOMATION_PROBLEMS: Record<string, string> = {
  email_allowed_domains: "List at most 50 sender domains.",
  slack_signing_secret: "Paste the Slack app's signing secret.",
  slack_bot_token: "Paste the Bot User OAuth Token, which starts with xoxb-.",
  email_from_name: "Give the sender name 1 to 80 characters.",
  teams_app_id: "Paste the Teams app's Application (client) ID.",
  teams_tenant_id: "Paste your Microsoft 365 Directory (tenant) ID.",
  teams_client_secret: "Paste the Teams app's client secret value.",
  rules: "Give each rule a condition of 1 to 500 characters and a member, with at most 100 rules.",
};
/** What to fix in a rejected automation change, by its first problem. */
export function automationUpdateProblem(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  return (
    (typeof field === "string" && AUTOMATION_PROBLEMS[field]) ||
    "Check the automation settings."
  );
}

/** Connect the intake mailbox: Microsoft 365 or Google Workspace. */
export const intakeMailboxConnection = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("graph"),
      mailbox: z.string().trim().min(3).max(320),
      // Either the app's details, or the Teams channel's app (checked by the
      // service, which says which to send).
      tenant_id: z.string().trim().min(1).max(200).optional(),
      client_id: z.string().trim().min(1).max(200).optional(),
      client_secret: z.string().trim().min(1).max(500).optional(),
      use_teams_app: z.literal(true).optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("gmail"),
      mailbox: z.string().trim().min(3).max(320),
      service_account_key: z.string().max(20_000).optional(),
    })
    .strict(),
]);

/** The reply a member saw: the request's last reply time when it opened. */
export const intakeReplySeen = z
  .object({ seen_at: z.iso.datetime({ offset: true }).nullable().optional() })
  .strict();
