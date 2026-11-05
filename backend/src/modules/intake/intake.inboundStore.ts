import { randomUUID } from "node:crypto";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";

/** Ownership of this attempt's payload, including its staged attachment keys. */
type PayloadOwnership = "owned" | "unowned" | "unknown";
export type InboundStoreResult<T> = ServiceResult<T> & {
  payloadOwnership: PayloadOwnership;
};

export type InboundInsert = {
  id?: string;
  org_id: string;
  source: "email" | "slack" | "outlook" | "gmail" | "teams";
  kind?: "request" | "reply";
  external_id: string;
  status: "pending" | "ignored";
  payload: Record<string, unknown> | null;
  request_id?: string | null;
  error?: string | null;
};

/**
 * Store once, keeping the INSERT outcome apart from later job dispatch.
 * Only proven-unowned payloads may be discarded: a unique-key loser or a
 * statement PostgreSQL rejected/rolled back. Connection errors, missing
 * acknowledgements and thrown transport failures may follow a commit, so
 * retaining their bytes is safer than deleting a durable row's attachments.
 */
export async function insertInbound(
  db: Db,
  row: InboundInsert,
): Promise<InboundStoreResult<string | null>> {
  // A stable identity also distinguishes our own commit from a concurrent
  // duplicate if an INSERT acknowledgement is retried/lost.
  const id = row.id ?? randomUUID();
  try {
    const { data, error } = await db
      .from("intake_inbound")
      .insert({ ...row, id, error: row.error ?? null })
      .select("id")
      .single();
    if (error?.code === "23505") {
      const existing = await db
        .from("intake_inbound")
        .select("id")
        .eq("org_id", row.org_id)
        .eq("source", row.source)
        .eq("external_id", row.external_id)
        .maybeSingle();
      if (existing.error || !existing.data)
        return Object.assign(internalFailure(existing.error ?? new Error("Inbound ownership could not be confirmed")), {
          payloadOwnership: "unknown" as const,
        });
      if (existing.data.id === id)
        return Object.assign(ok(id), { payloadOwnership: "owned" as const });
      return Object.assign(ok(null), { payloadOwnership: "unowned" as const });
    }
    if (error || !data) {
      // Data/constraint errors and definite transaction rollbacks prove no
      // insert committed. 40003 (statement_completion_unknown) does not.
      // Other outcomes, including PostgREST/connection errors,
      // do not prove that this attempt's payload is unreferenced.
      const rejected = /^(22|23)[0-9A-Z]{3}$/.test(error?.code ?? "") ||
        ["40001", "40P01", "42501"].includes(error?.code ?? "");
      return Object.assign(internalFailure(error ?? new Error("Inbound insert acknowledgement missing")), {
        payloadOwnership: rejected ? "unowned" as const : "unknown" as const,
      });
    }
    return Object.assign(ok((data as { id: string }).id), { payloadOwnership: "owned" as const });
  } catch (error) {
    return Object.assign(internalFailure(error), { payloadOwnership: "unknown" as const });
  }
}
