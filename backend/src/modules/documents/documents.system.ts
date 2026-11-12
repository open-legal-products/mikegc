// Trusted reads and edits for organization jobs. The general loader accepts
// organization-owned documents only; the intake loader also accepts member
// uploads after verifying the request association and document scope.

import { extractDocxBodyText, type EditInput } from "../../lib/docxTrackedChanges";
import { loadActiveVersion } from "../../lib/documentVersions";
import { downloadFile } from "../../lib/storage";
import type { Db } from "../../lib/supabase";
import { writeTrackedEdits, type TrackedEditsResult } from "./documents.trackedEdits";

export type OrgDocument = {
  id: string;
  filename: string;
  isDocx: boolean;
  /** The current version, which edits are made against. */
  version: { id: string; storagePath: string };
  /** How many versions it has; an original upload has one. */
  versionCount: number;
};

/** The organization's own document, or null when it is not one. */
export async function loadOrgDocument(
  db: Db,
  orgId: string,
  documentId: string,
): Promise<OrgDocument | null> {
  return loadDocument(db, orgId, documentId, false);
}

/** A document attached to this request, including a member's intake upload. */
export async function loadIntakeDocument(db: Db, orgId: string, requestId: string, documentId: string): Promise<OrgDocument | null> {
  const { data, error } = await db.from("intake_request_documents").select("document_id")
    .eq("org_id", orgId).eq("request_id", requestId).eq("document_id", documentId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return loadDocument(db, orgId, documentId, true);
}

async function loadDocument(db: Db, orgId: string, documentId: string, intake: boolean): Promise<OrgDocument | null> {
  const { data: doc, error } = await db
    .from("documents")
    .select("id, org_id, user_id, library_kind")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw error;
  const row = doc as { id: string; org_id: string | null; user_id: string | null; library_kind?: string } | null;
  if (!row || row.org_id !== orgId || (intake ? row.library_kind !== "intake_attachment" : row.user_id !== null)) return null;
  const version = await loadActiveVersion(documentId, db);
  if (!version) return null;
  const { count, error: countError } = await db
    .from("document_versions")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .is("deleted_at", null);
  if (countError) throw countError;
  const filename = version.filename?.trim() || "Untitled document";
  return {
    id: documentId,
    filename,
    isDocx: version.file_type === "docx" || /\.docx$/i.test(filename),
    version: { id: version.id, storagePath: version.storage_path },
    versionCount: count ?? 1,
  };
}

/**
 * The document's text: a Word document read from its file, as tracked edits
 * locate text, and anything else as text extraction stored it. `pending`
 * while extraction has not finished.
 */
export async function readOrgDocumentText(
  db: Db,
  doc: OrgDocument,
): Promise<{ status: "ready"; text: string } | { status: "pending" | "unavailable" }> {
  if (doc.isDocx) {
    const raw = await downloadFile(doc.version.storagePath);
    if (!raw) return { status: "unavailable" };
    return { status: "ready", text: await extractDocxBodyText(Buffer.from(raw)) };
  }
  const { data, error } = await db
    .from("document_version_texts")
    .select("status, text_content")
    .eq("version_id", doc.version.id)
    .maybeSingle();
  if (error) throw error;
  const row = data as { status: string; text_content: string | null } | null;
  if (!row || row.status === "pending" || row.status === "processing")
    return { status: "pending" };
  return row.status === "ready" && row.text_content !== null
    ? { status: "ready", text: row.text_content }
    : { status: "unavailable" };
}

/**
 * Mark up an intake document at the request and document versions reviewed.
 * Persistence rechecks its live scope under the request's lifecycle locks.
 */
export async function applyIntakeTrackedEdits(params: {
  db: Db;
  orgId: string;
  requestId: string;
  requestVersion: number;
  doc: OrgDocument;
  author: string;
  edits: EditInput[];
}): Promise<TrackedEditsResult> {
  return writeTrackedEdits({
    documentId: params.doc.id,
    storageOwner: `intake-${params.orgId}`,
    author: params.author,
    edits: params.edits,
    db: params.db,
    expectedVersion: params.doc.version,
    intake: { orgId: params.orgId, requestId: params.requestId, requestVersion: params.requestVersion },
  });
}
