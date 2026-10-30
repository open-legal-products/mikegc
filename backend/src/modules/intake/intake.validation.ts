import { z } from "zod";
export const intakeId = z.uuid();
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
  category: z.enum(["nda", "general"]).optional(),
  assignee: z.union([z.enum(["unassigned", "me"]), intakeId]).optional(),
  search: z.string().max(200).default(""),
  sort: z.enum(["updated", "target"]).default("updated"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
/** A business target date needs an IANA timezone so it means one calendar day. */
const datedTogether = (v: {
  requested_by_date: string | null;
  timezone: string | null;
}) => (v.requested_by_date === null) === (v.timezone === null);
const knownTimezone = (v: { timezone: string | null }) => {
  if (v.timezone === null) return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: v.timezone });
    return true;
  } catch {
    return false;
  }
};
const details = {
  category: z.enum(["nda", "general"]),
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
  requested_by_date: z.iso.date().nullable().default(null),
  timezone: z.string().min(1).max(100).nullable().default(null),
};
export const intakeSubmit = z
  .object({
    ...details,
    id: intakeId,
    command_id: intakeId,
    assignee_id: intakeId.nullable().default(null),
  })
  .strict()
  .refine(datedTogether)
  .refine(knownTimezone);
export const intakeEdit = z
  .object({
    ...details,
    command_id: intakeId,
    expected_version: z.number().int().positive(),
  })
  .strict()
  .refine(datedTogether)
  .refine(knownTimezone);
const versioned = {
  command_id: intakeId,
  expected_version: z.number().int().positive(),
};
/** Each command's body, keyed by its URL action. */
export const intakeCommands = {
  assignment: z
    .object({ ...versioned, assignee_id: intakeId.nullable() })
    .strict(),
  notes: z.object({ command_id: intakeId, body: text(20000) }).strict(),
  wait: z.object({ ...versioned, body: text(20000).optional() }).strict(),
  resume: z.object({ ...versioned, body: text(20000).optional() }).strict(),
  resolve: z.object({ ...versioned, body: text(20000) }).strict(),
  cancel: z.object({ ...versioned, body: text(20000) }).strict(),
  reopen: z.object(versioned).strict(),
} as const;
export type IntakeCommandAction = keyof typeof intakeCommands;
export type IntakeCommandInput = {
  command_id: string;
  expected_version?: number;
  body?: string;
  assignee_id?: string | null;
};
