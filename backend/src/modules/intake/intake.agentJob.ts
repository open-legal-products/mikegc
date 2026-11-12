import { z } from "zod";
import { NonRetryableJobError } from "../../lib/dbq/runner";
import type { DbJob } from "../../lib/dbq/types";
import type { Db } from "../../lib/supabase";
import { markInboundFailed, runInbound } from "./intake.automationJob";
import type { ChannelSource } from "./intake.channels";
import { markReplyFailed, runReply } from "./intake.reply";
import { dispatchIntakeJob } from "./intake.shared";

/**
 * The intake.agent job: one for every message a channel delivers. A message
 * in the thread of a recorded request is that request's reply
 * (intake.reply.ts); any other is a new message (intake.automationJob.ts).
 * Either way the intake agent reads it and its plan is saved before any of
 * it is done.
 */

export const INTAKE_AGENT_JOB = "intake.agent";
const JOB_ATTEMPTS = 4;

const jobPayload = z.object({ inboundId: z.uuid(), orgId: z.uuid() });

/** A stored message, as both branches read it. */
export type InboundRow = {
  id: string;
  org_id: string;
  source: ChannelSource;
  /** A new message, or a message in a recorded request's thread. */
  kind: "request" | "reply";
  status: "pending" | "done" | "failed" | "ignored";
  payload: unknown;
  request_id: string | null;
  error: string | null;
};

async function loadInbound(
  db: Db,
  ids: { inboundId: string; orgId: string },
): Promise<InboundRow | null> {
  const { data, error } = await db
    .from("intake_inbound")
    .select("id, org_id, source, kind, status, payload, request_id, error")
    .eq("id", ids.inboundId)
    .eq("org_id", ids.orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as InboundRow | null) ?? null;
}

/**
 * The job body. A message no longer waiting (handled, or purged with the
 * organization's intake data) is skipped.
 */
export async function handleIntakeAgent(
  db: Db,
  job: DbJob,
): Promise<Record<string, unknown>> {
  const ids = jobPayload.safeParse(job.payload);
  if (!ids.success) throw new NonRetryableJobError(`${INTAKE_AGENT_JOB}: invalid payload`);
  const row = await loadInbound(db, ids.data);
  if (!row) return { skipped: "missing" };
  if (row.status !== "pending") return { skipped: row.status };
  return row.kind === "reply" ? runReply(db, row) : runInbound(db, row);
}

/** When a message's job has failed for good. */
export async function markIntakeAgentFailed(db: Db, job: DbJob): Promise<void> {
  const ids = jobPayload.safeParse(job.payload);
  if (!ids.success) return;
  const row = await loadInbound(db, ids.data);
  if (!row || row.status !== "pending") return;
  await (row.kind === "reply" ? markReplyFailed(db, row) : markInboundFailed(db, row));
}

/** Queue a stored message's job. */
export async function dispatchIntakeAgent(
  db: Db,
  orgId: string,
  inboundId: string,
): Promise<void> {
  await dispatchIntakeJob(db, {
    kind: INTAKE_AGENT_JOB,
    payload: { inboundId, orgId },
    dedupeKey: `${INTAKE_AGENT_JOB}:${inboundId}`,
    maxAttempts: JOB_ATTEMPTS,
    handler: handleIntakeAgent,
    onFailure: markIntakeAgentFailed,
  });
}
