import { z } from "zod";
import { dbJobsEnabled, NonRetryableJobError } from "../../lib/dbq/runner";
import type { DbJob } from "../../lib/dbq/types";
import { isPersonalOrg } from "../../lib/personalOrgs";
import { configuredFrontendUrl } from "../../lib/runtimeConfig";
import { safeError } from "../../lib/safeError";
import { downloadFile } from "../../lib/storage";
import type { Db } from "../../lib/supabase";
import { loadAutomationRow } from "./intake.settingsRow";
import {
  ChannelDeliveryError,
  loadLinkById,
  type ChannelAdapter,
  type ChannelContext,
  type ChannelSource,
  type OutboundDocument,
  type OutboundMessage,
} from "./intake.channels";
import { gmailAdapter } from "./intake.gmail";
import { outlookAdapter } from "./intake.outlook";
import { dispatchIntakeJob, intakeRpc } from "./intake.shared";
import { slackAdapter } from "./intake.slack";
import { teamsAdapter } from "./intake.teams";

/**
 * The intake.deliver job: send one outbox row (an acknowledgement, a
 * question or a resolution) through its request's channel. A retry first asks
 * the channel whether an earlier attempt landed, so a send that timed out is
 * not repeated; transient failures are retried with backoff, and a permanent
 * one is recorded on the row with a sentence members can act on.
 */

export const INTAKE_DELIVER_JOB = "intake.deliver";
const JOB_ATTEMPTS = 5;

const ADAPTERS: Record<ChannelSource, ChannelAdapter> = {
  slack: slackAdapter,
  outlook: outlookAdapter,
  gmail: gmailAdapter,
  teams: teamsAdapter,
};

const CHANNEL_NAMES: Record<ChannelSource, string> = {
  slack: "Slack",
  outlook: "Outlook",
  gmail: "Gmail",
  teams: "Teams",
};

const jobPayload = z.object({ orgId: z.uuid(), outboundId: z.uuid() });

type OutboundRow = {
  id: string;
  org_id: string;
  request_id: string;
  link_id: string;
  message_id: string | null;
  author_id: string | null;
  kind: "acknowledgement" | "question" | "answer";
  documents: {
    document_id: string;
    version_id: string;
    external_id?: string | null;
    left_out?: boolean;
  }[];
  status: "pending" | "sent" | "failed";
  external_id: string | null;
  attempted_at: string | null;
};

async function loadOutbound(
  db: Db,
  ids: { orgId: string; outboundId: string },
): Promise<OutboundRow | null> {
  const { data, error } = await db
    .from("intake_outbound")
    .select(
      "id, org_id, request_id, link_id, message_id, author_id, kind, documents, status, external_id, attempted_at",
    )
    .eq("id", ids.outboundId)
    .eq("org_id", ids.orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as OutboundRow | null) ?? null;
}

async function recordDelivery(
  db: Db,
  row: OutboundRow,
  update: {
    status: "pending" | "sent" | "failed";
    externalId?: string | null;
    error?: string | null;
    documents?: OutboundDocument[];
  },
) {
  const result = await intakeRpc<boolean>(db, "intake_record_delivery", {
    p_org: row.org_id,
    p_outbound: row.id,
    p_status: update.status,
    p_external_id: update.externalId ?? null,
    p_error: update.error ?? null,
    p_documents: update.documents
      ? update.documents.map((d) => ({
          document_id: d.documentId,
          version_id: d.versionId,
          ...(d.externalId ? { external_id: d.externalId } : {}),
          ...(d.leftOut ? { left_out: true } : {}),
        }))
      : null,
  });
  if (!result.ok)
    throw result.kind === "error" ? result.error : new Error(result.detail);
}

/**
 * The link to a request, in the workspace the web app names it by. Only the
 * organization's members can open it, so it goes in notes for them, never in
 * a message to a requester.
 */
export async function requestLink(db: Db, orgId: string, requestId: string) {
  const workspace = (await isPersonalOrg(db, orgId)) ? "personal" : orgId;
  return `${configuredFrontendUrl()}/intake/${requestId}?org=${encodeURIComponent(workspace)}`;
}

async function memberName(db: Db, userId: string): Promise<string> {
  const { data, error } = await db
    .from("user_profiles")
    .select("display_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const p = data as { display_name: string | null; email: string | null } | null;
  return p?.display_name?.trim() || p?.email || "A member of Legal";
}

/** The message as adapters receive it, or null when its request is gone. */
async function outboundMessage(
  db: Db,
  row: OutboundRow,
): Promise<OutboundMessage | null> {
  const { data: request, error } = await db
    .from("intake_requests")
    .select("subject, assignee_id")
    .eq("id", row.request_id)
    .maybeSingle();
  if (error) throw error;
  if (!request) return null;
  const r = request as { subject: string; assignee_id: string | null };
  let text = "";
  if (row.message_id) {
    const { data: message, error: messageError } = await db
      .from("intake_messages")
      .select("body")
      .eq("id", row.message_id)
      .maybeSingle();
    if (messageError) throw messageError;
    text = (message as { body: string } | null)?.body ?? "";
  }
  const versionIds = row.documents.map((d) => d.version_id);
  const versions = new Map<
    string,
    { filename: string | null; file_type: string | null; size_bytes: number | null }
  >();
  if (versionIds.length) {
    const { data, error: versionError } = await db
      .from("document_versions")
      .select("id, filename, file_type, size_bytes, deleted_at")
      .in("id", versionIds);
    if (versionError) throw versionError;
    for (const v of (data ?? []) as {
      id: string;
      filename: string | null;
      file_type: string | null;
      size_bytes: number | null;
      deleted_at: string | null;
    }[])
      if (!v.deleted_at) versions.set(v.id, v);
  }
  const documents: OutboundDocument[] = row.documents.map((d) => {
    const v = versions.get(d.version_id);
    return {
      documentId: d.document_id,
      versionId: d.version_id,
      name: v?.filename || "Document",
      fileType: v?.file_type || "",
      sizeBytes: v?.size_bytes ?? null,
      externalId: d.external_id ?? null,
      // A version deleted since it was chosen can't be sent.
      leftOut: d.left_out || !v,
    };
  });
  return {
    id: row.id,
    kind: row.kind,
    author: row.author_id
      ? { kind: "member", name: await memberName(db, row.author_id) }
      : { kind: "mikegc" },
    text,
    requestSubject: r.subject,
    acknowledgement:
      row.kind === "acknowledgement"
        ? {
            subject: r.subject,
            assignee: r.assignee_id ? await memberName(db, r.assignee_id) : null,
          }
        : undefined,
    documents,
  };
}

/** A document version's bytes, read from where its version stores them. */
async function readVersion(db: Db, doc: OutboundDocument): Promise<ArrayBuffer> {
  const { data, error } = await db
    .from("document_versions")
    .select("storage_path")
    .eq("id", doc.versionId)
    .maybeSingle();
  if (error) throw error;
  const path = (data as { storage_path: string | null } | null)?.storage_path;
  const bytes = path ? await downloadFile(path) : null;
  if (!bytes) throw new ChannelDeliveryError(`${doc.name} couldn't be read.`, true);
  return bytes;
}

/**
 * The job body. A row no longer pending (sent, failed, or deleted with its
 * request) is skipped.
 */
export async function handleIntakeDeliver(
  db: Db,
  job: DbJob,
): Promise<Record<string, unknown>> {
  const ids = jobPayload.safeParse(job.payload);
  if (!ids.success) throw new NonRetryableJobError("intake.deliver: invalid payload");
  const row = await loadOutbound(db, ids.data);
  if (!row) return { skipped: "missing" };
  if (row.status !== "pending") return { skipped: row.status };
  const link = await loadLinkById(db, row.link_id);
  const settings = await loadAutomationRow(db, row.org_id);
  const message = await outboundMessage(db, row);
  if (!link || !settings || !message) return { skipped: "missing" };
  const adapter = ADAPTERS[link.source];
  const ctx: ChannelContext = {
    db,
    settings,
    fromName: settings.email_from_name?.trim() || "Legal",
    readDocument: (doc) => readVersion(db, doc),
    saveProgress: (progress) =>
      recordDelivery(db, row, {
        status: "pending",
        externalId: progress.externalId,
        documents: progress.documents,
      }),
  };
  try {
    // Before every retry, never the first attempt: did an earlier send land?
    let delivered = row.external_id;
    if (!delivered && row.attempted_at)
      delivered = await adapter.findDelivered(ctx, link, message, row.attempted_at);
    if (!row.attempted_at) await recordDelivery(db, row, { status: "pending" });
    const result = await adapter.deliver(ctx, link, message, delivered);
    await recordDelivery(db, row, {
      status: "sent",
      externalId: result.externalId,
      documents: result.documents,
    });
    return { outbound_id: row.id, sent: true };
  } catch (error) {
    if (error instanceof ChannelDeliveryError && error.permanent) {
      await recordDelivery(db, row, { status: "failed", error: error.sentence });
      throw new NonRetryableJobError(error.sentence);
    }
    throw error;
  }
}

/** When sending has failed for good: say so on the row. */
export async function markIntakeDeliverFailed(db: Db, job: DbJob): Promise<void> {
  const ids = jobPayload.safeParse(job.payload);
  if (!ids.success) return;
  const row = await loadOutbound(db, ids.data);
  if (!row || row.status !== "pending") return;
  const link = await loadLinkById(db, row.link_id).catch(() => null);
  await recordDelivery(db, row, {
    status: "failed",
    error: link
      ? `MikeGC couldn't reach ${CHANNEL_NAMES[link.source]}. Try again.`
      : "MikeGC couldn't send this message. Try again.",
  }).catch((error) =>
    console.warn("[intake-deliver] failure not recorded", safeError(error)),
  );
}

/**
 * Queue an outbox row's delivery for a member's command. If it can't be
 * queued, the row is marked failed, so the request offers Retry rather than
 * showing it as sending for good; the queueing error is then thrown.
 */
export async function dispatchIntakeDeliverOrFail(
  db: Db,
  orgId: string,
  outboundId: string,
): Promise<void> {
  try {
    await dispatchIntakeDeliver(db, orgId, outboundId);
  } catch (error) {
    try {
      const marked = await intakeRpc<boolean>(db, "intake_record_delivery", {
        p_org: orgId,
        p_outbound: outboundId,
        p_status: "failed",
        p_external_id: null,
        p_error: "MikeGC couldn't queue this message. Try again.",
        p_documents: null,
      });
      if (!marked.ok) throw marked.kind === "error" ? marked.error : new Error(marked.kind);
    } catch (markError) {
      // Left pending: the stale-work sweep queues it again.
      console.warn("[intake-deliver] unqueued message not marked failed", safeError(markError));
    }
    throw error;
  }
}

/** A message pending this long is queued again, in case it never was. */
const STALLED_DELIVERY_MS = 15 * 60_000;

/**
 * Queue again the messages left pending without a job: queueing failed and
 * so did marking them failed, or the process stopped in between. A message
 * whose job is still live is deduplicated by its key, so nothing goes twice.
 * Without the job queue there is nothing to lose a job from, and a delivery
 * running inline must not be started again, so the sweep does nothing.
 */
export async function requeueStalledIntakeDeliveries(db: Db): Promise<number> {
  if (!dbJobsEnabled()) return 0;
  const { data, error } = await db
    .from("intake_outbound")
    .select("id, org_id")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - STALLED_DELIVERY_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; org_id: string }[];
  for (const row of rows) await dispatchIntakeDeliver(db, row.org_id, row.id);
  return rows.length;
}

/** Queue an outbox row's delivery. */
export async function dispatchIntakeDeliver(
  db: Db,
  orgId: string,
  outboundId: string,
): Promise<void> {
  await dispatchIntakeJob(db, {
    kind: INTAKE_DELIVER_JOB,
    payload: { orgId, outboundId },
    dedupeKey: `${INTAKE_DELIVER_JOB}:${outboundId}`,
    maxAttempts: JOB_ATTEMPTS,
    handler: handleIntakeDeliver,
    onFailure: markIntakeDeliverFailed,
  });
}
