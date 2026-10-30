import type { Db } from "../../lib/supabase";
import { intakeRpc } from "./intake.shared";

/** Stop lifecycle work when the authorized RPC fails, without exposing database details. */
async function required<T>(
  db: Db,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await intakeRpc<T>(db, name, args);
  if (!result.ok)
    throw new Error(
      "Intake data operation failed; check access and try again.",
    );
  return result.data;
}
/**
 * Account exports no longer include intake requests, which are organization
 * records. Artifacts built before that change carry an intake manifest, so a
 * download still rechecks access, request identity and erasure revision.
 */
export async function validateIntakeExport(
  db: Db,
  userId: string,
  manifest: unknown,
): Promise<boolean> {
  if (!manifest || typeof manifest !== "object") return false;
  const m = manifest as { version?: unknown; requests?: unknown };
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    m.version !== 1 ||
    !Array.isArray(m.requests) ||
    m.requests.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        !uuid.test(row.id) ||
        !uuid.test(row.incarnation_id) ||
        !Number.isSafeInteger(row.export_revision) ||
        row.export_revision < 1,
    )
  )
    return false;
  for (let i = 0; i < m.requests.length; i += 100) {
    const result = await intakeRpc<boolean>(db, "intake_validate_export", {
      p_actor: userId,
      p_requests: m.requests.slice(i, i + 100),
    });
    if (!result.ok || result.data !== true) return false;
  }
  return true;
}
/** Permanently purge request content through the owner-authorized transaction. */
export async function purgeIntake(
  db: Db,
  orgId: string,
  userId: string,
): Promise<void> {
  await required(db, "intake_purge", { p_org: orgId, p_actor: userId });
}
