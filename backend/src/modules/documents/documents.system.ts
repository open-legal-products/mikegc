// Documents an organization owns rather than a member, such as the
// attachments MikeGC records for intake: no uploader, so no user's access
// applies. Their callers are trusted jobs acting for the organization, which
// name it, and these helpers only reach documents it owns that way.

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
  const { data: doc, error } = await db
    .from("documents")
    .select("id, org_id, user_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw error;
  const row = doc as { id: string; org_id: string | null; user_id: string | null } | null;
  if (!row || row.org_id !== orgId || row.user_id !== null) return null;
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
 * Mark up the organization's Word document with tracked changes signed by
 * `author`, against the version its text was read from.
 */
export async function applyOrgTrackedEdits(params: {
  db: Db;
  orgId: string;
  request: { id: string; version: number };
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
    intakeRequest: { orgId: params.orgId, ...params.request },
  });
}
