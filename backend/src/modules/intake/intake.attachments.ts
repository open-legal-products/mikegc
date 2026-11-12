import { randomUUID } from "node:crypto";
import { createDocumentVersion } from "../documents/documents.service";
import { convertedPdfKey } from "../../lib/convert";
import { contentSha256 } from "../../lib/documentVersions";
import {
  ALLOWED_DOCUMENT_TYPES,
  contentTypeForDocumentType,
  documentSuffix,
  shouldConvertToPdf,
} from "../../lib/documentTypes";
import { enqueueConversion } from "../../lib/queue/conversionQueue";
import { safeError } from "../../lib/safeError";
import {
  deleteFileBestEffort,
  downloadFile,
  storageKey,
  uploadFile,
} from "../../lib/storage";
import type { Db } from "../../lib/supabase";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type AttachmentCandidate,
  type DocumentEntry,
  type SkippedAttachment,
} from "./intake.inboundPayload";
import { intakeRpc } from "./intake.shared";
import { SKIPPED_REASON } from "./intake.triage";

/**
 * Documents MikeGC makes from what arrives with a message: a new request's
 * attachments, or the files a requester sends in reply. Each is the
 * request's own document, owned by the organization, with no uploader.
 */

/** A document owner segment for MikeGC's files, which have no uploader. */
export const ownerSegment = (orgId: string) => `intake-${orgId}`;

/**
 * A failure an admin can act on. Its message is the sentence shown in the
 * settings page's recent messages, so it never carries message content.
 */
export class IntakeAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeAutomationError";
  }
}

export const RECORDED_INCOMPLETE =
  "The request was recorded, but MikeGC couldn't add all of its documents or reply in its thread.";

/** A channel's file, held to the same limits as an email attachment. */
export type ChannelFile = {
  name: string;
  size: number | null;
  url: string | null;
};

/**
 * Files shared in a channel as attachment candidates: PDF, Word, Excel and
 * PowerPoint, up to 10 of 25 MB each. The rest are listed as skipped.
 */
export function channelAttachments(
  files: ChannelFile[],
  via: "slack" | "teams",
): { candidates: AttachmentCandidate[]; skipped: SkippedAttachment[] } {
  const candidates: AttachmentCandidate[] = [];
  const skipped: SkippedAttachment[] = [];
  for (const file of files) {
    const fileType = documentSuffix(file.name);
    if (!ALLOWED_DOCUMENT_TYPES.has(fileType))
      skipped.push({ name: file.name, reason: "type" });
    else if (file.size !== null && file.size > MAX_ATTACHMENT_BYTES)
      skipped.push({ name: file.name, reason: "size" });
    else if (!file.url) skipped.push({ name: file.name, reason: "unreadable" });
    else if (candidates.length >= MAX_ATTACHMENTS)
      skipped.push({ name: file.name, reason: "count" });
    else
      candidates.push({
        name: file.name,
        file_type: fileType,
        size: file.size,
        key: null,
        url: file.url,
        via,
      });
  }
  return { candidates, skipped };
}

/**
 * Make one attachment MikeGC's document on the request, as an upload is
 * made: linked before any bytes are written, so it never belongs to no
 * request, then given its version and marked ready. A Word or PowerPoint file
 * is queued for the PDF rendition the viewer opens. A reply's files are
 * linked to the reply. Returns false when the request is gone.
 */
export async function addDocument(
  db: Db,
  args: {
    orgId: string;
    requestId: string;
    entry: { document_id: string; version_id: string };
    name: string;
    fileType: string;
    bytes: ArrayBuffer;
    messageId?: string | null;
  },
): Promise<boolean> {
  const { orgId, entry } = args;
  const documentId = entry.document_id;
  const { data: inserted, error: insertError } = await db
    .from("documents")
    .upsert(
      {
        id: documentId,
        user_id: null,
        org_id: orgId,
        status: "processing",
        library_kind: "intake_attachment",
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (insertError) throw insertError;
  // A retry finds the document an earlier attempt made; only this call's own
  // new row is removed when linking fails.
  const created = Array.isArray(inserted) && inserted.length > 0;
  const attached = await intakeRpc<null>(db, "intake_attach_automated", {
    p_org: orgId,
    p_request: args.requestId,
    p_document: documentId,
    p_message: args.messageId ?? null,
  });
  if (!attached.ok) {
    if (created) await db.from("documents").delete().eq("id", documentId);
    if (attached.kind === "not_found") return false;
    if (attached.kind === "error") throw attached.error;
    throw new IntakeAutomationError(RECORDED_INCOMPLETE);
  }
  if (!created) {
    // An earlier attempt that finished the document before it stopped.
    const { data: existing, error: existingError } = await db
      .from("documents")
      .select("status")
      .eq("id", documentId)
      .maybeSingle();
    if (existingError) throw existingError;
    if ((existing as { status?: string } | null)?.status === "ready") return true;
  }
  const key = storageKey(ownerSegment(orgId), documentId, args.name);
  try {
    await uploadFile(key, args.bytes, contentTypeForDocumentType(args.fileType));
    const { error: versionError } = await createDocumentVersion(db, {
      id: entry.version_id,
      document_id: documentId,
      storage_path: key,
      pdf_storage_path: args.fileType === "pdf" ? key : null,
      source: "upload",
      version_number: 1,
      filename: args.name,
      file_type: args.fileType,
      size_bytes: args.bytes.byteLength,
      page_count: null,
      textless_page_count: null,
      content_sha256: contentSha256(args.bytes),
    });
    if (versionError) throw versionError;
    const { error: readyError } = await db
      .from("documents")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("id", documentId);
    if (readyError) throw readyError;
  } catch (error) {
    // Only this attempt's own new document is removed; one an earlier
    // attempt made, and its request link, stay for the next retry.
    if (created)
      await Promise.all([
        deleteFileBestEffort(key, "intake-automation-rollback"),
        db.from("documents").delete().eq("id", documentId),
      ]);
    throw error;
  }
  if (shouldConvertToPdf(args.fileType)) {
    try {
      await enqueueConversion({
        documentId,
        versionId: entry.version_id,
        userId: ownerSegment(orgId),
        storagePath: key,
        fileType: args.fileType,
        pdfKey: convertedPdfKey(ownerSegment(orgId), documentId),
        finalizeDocumentStatus: false,
      });
    } catch (error) {
      // The document still opens as its original file.
      console.warn("[intake-automation] rendition not queued", safeError(error));
    }
  }
  return true;
}

/**
 * Fetch a channel file's bytes: null when it is larger than allowed,
 * "unreadable" when MikeGC can't fetch it at all.
 */
export type CandidateDownloader = (
  candidate: AttachmentCandidate,
) => Promise<ArrayBuffer | "unreadable" | null>;

/**
 * A note on the request naming the files MikeGC couldn't add, so a reviewer
 * can ask for them. Its id is the caller's, the same on every retry, so it
 * is posted once.
 */
export async function noteNotAttached(
  db: Db,
  args: { orgId: string; requestId: string; noteId: string; dropped: SkippedAttachment[] },
): Promise<void> {
  if (args.dropped.length === 0) return;
  const note = await intakeRpc<boolean>(db, "intake_note_automated", {
    p_org: args.orgId,
    p_request: args.requestId,
    p_note: args.noteId,
    p_body:
      "Not attached: MikeGC couldn't add these files, so ask the requester for a copy.\n" +
      args.dropped.map((s) => `- ${s.name}: ${SKIPPED_REASON[s.reason]}`).join("\n"),
  });
  if (!note.ok && note.kind !== "not_found")
    throw note.kind === "error" ? note.error : new Error(note.detail);
}

/**
 * Add the chosen attachments as the request's documents. Each document's
 * ids are named and saved before it is made, so a retry makes the same one,
 * and each is marked done once made. Returns the files that couldn't be
 * fetched, for the caller to name on the request (an earlier attempt's
 * too), or false when the request is gone.
 */
export async function addDocuments(
  db: Db,
  args: {
    orgId: string;
    requestId: string;
    candidates: AttachmentCandidate[];
    /** Indexes into `candidates` of the ones to add. */
    chosen: number[];
    documents: Record<string, DocumentEntry>;
    save: () => Promise<void>;
    download: CandidateDownloader;
    messageId?: string | null;
  },
): Promise<SkippedAttachment[] | false> {
  const dropped: SkippedAttachment[] = [];
  for (const index of args.chosen) {
    const candidate = args.candidates[index];
    if (!candidate) continue;
    let entry = args.documents[String(index)];
    if (entry?.done) {
      if (entry.dropped) dropped.push({ name: candidate.name, reason: entry.dropped });
      continue;
    }
    if (!entry) {
      // Named before it is made, so a retry makes this same document.
      entry = { document_id: randomUUID(), version_id: randomUUID(), done: false };
      args.documents[String(index)] = entry;
      await args.save();
    }
    const bytes = candidate.key
      ? await downloadFile(candidate.key)
      : await args.download(candidate);
    if (!bytes || bytes === "unreadable") {
      // Larger than the channel said, or one MikeGC can't fetch; or an
      // email's staged copy is gone.
      if (candidate.key) throw new Error("Staged intake attachment is missing");
      entry.done = true;
      entry.dropped = bytes === "unreadable" ? "unreadable" : "size";
      await args.save();
      dropped.push({ name: candidate.name, reason: entry.dropped });
      continue;
    }
    const added = await addDocument(db, {
      orgId: args.orgId,
      requestId: args.requestId,
      entry,
      name: candidate.name,
      fileType: candidate.file_type,
      bytes,
      messageId: args.messageId,
    });
    if (!added) return false;
    entry.done = true;
    await args.save();
  }
  return dropped;
}
