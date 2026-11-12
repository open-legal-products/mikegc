const { jsonrepair } = require("jsonrepair") as {
  jsonrepair: (text: string) => string;
};
import { AppError } from "../../lib/appError";
import { enqueueDbJob } from "../../lib/dbq/enqueue";
import { dbJobsEnabled } from "../../lib/dbq/runner";
import type { DbJob } from "../../lib/dbq/types";
import { safeError } from "../../lib/safeError";
import type { Db } from "../../lib/supabase";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";

/** SQL owns live scope checks, transactions and replay. Never log input text. */
export async function intakeRpc<T>(
  db: Db,
  name: string,
  args: Record<string, unknown>,
): Promise<ServiceResult<T>> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await db.rpc(name, args);
    if (!error) return ok(data as T);
    // PostgreSQL guarantees these transactions aborted. Reuse the exact command.
    if (["40P01", "40001"].includes(error.code) && attempt < 2) continue;
    if (error.code === "P0002")
      return failure("not_found", "Request not found.");
    if (error.code === "42501")
      return failure("forbidden", "You don't have permission for this action.");
    if (error.code === "P0004")
      return failure(
        "conflict",
        "This command belongs to requests that were deleted. Start a new request.",
        "intake_purged",
      );
    if (error.code === "P0001")
      return failure(
        "conflict",
        "This request changed. Reload it before trying again.",
        "intake_conflict",
      );
    // A reused command or request ID: the client must start a fresh attempt.
    if (error.code === "P0007" || error.code === "23505")
      return failure(
        "conflict",
        "This change was already sent with different details. Try again.",
        "intake_command_reused",
      );
    if (["22023", "23514", "22P02", "22007", "22008"].includes(error.code))
      return failure(
        "validation",
        "Check the request details and the selected member.",
      );
    // Postgres details can contain rejected request text, so the message
    // names only its code; the error itself stays the cause, which the
    // Sentry boundary reads only its SQLSTATE from (see asReportableError).
    return internalFailure(
      new AppError(
        "db.query_failed",
        `Intake database operation failed (${error.code ?? "unknown"})`,
        { cause: error },
      ),
    );
  }
}

/** The model's JSON object: fences stripped, the outer braces, repaired. */
export function parseModelJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = cleaned.slice(start, end + 1);
  for (const attempt of [() => JSON.parse(slice), () => JSON.parse(jsonrepair(slice))]) {
    try {
      const value: unknown = attempt();
      if (value && typeof value === "object" && !Array.isArray(value))
        return value as Record<string, unknown>;
    } catch {
      // Try the next, more forgiving reading.
    }
  }
  return null;
}

/**
 * Queue one of intake's jobs. With the job runner switched off
 * (DB_JOBS_ENABLED=false) nothing would claim it, so it runs here, detached
 * from the caller, without retries, and its failure hook runs if it fails.
 */
export async function dispatchIntakeJob(
  db: Db,
  args: {
    kind: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
    maxAttempts: number;
    runAt?: string;
    handler: (db: Db, job: DbJob) => Promise<unknown>;
    onFailure?: (db: Db, job: DbJob) => Promise<void>;
  },
): Promise<void> {
  if (!dbJobsEnabled()) {
    const now = new Date().toISOString();
    const job: DbJob = {
      id: `inline:${args.dedupeKey}`,
      kind: args.kind,
      payload: args.payload,
      status: "running",
      attempts: 1,
      max_attempts: 1,
      run_at: now,
      claimed_at: now,
      finished_at: null,
      last_error: null,
      dedupe_key: args.dedupeKey,
      result: null,
      created_at: now,
    };
    void args.handler(db, job).catch(async (error) => {
      console.warn(`[${args.kind}] inline job failed`, safeError(error));
      await args.onFailure?.(db, job).catch(() => undefined);
    });
    return;
  }
  await enqueueDbJob(db, {
    kind: args.kind,
    payload: args.payload,
    dedupeKey: args.dedupeKey,
    maxAttempts: args.maxAttempts,
    ...(args.runAt ? { runAt: args.runAt } : {}),
  });
}
