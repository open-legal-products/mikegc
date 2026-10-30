"use client";

import { useId, useState } from "react";
import type { IntakeDocument } from "@mike/contracts";
import type { Document } from "@/app/components/shared/types";
import {
  getDocument,
  getDocumentUrl,
  uploadIntakeDocuments,
} from "@/app/lib/mikeApi";
import { notifyError, notifyPartialFailure } from "@/app/lib/userFacingError";
import { DocumentSidePanel } from "@/app/components/shared/DocumentSidePanel";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { IntakeDocumentDropZone } from "./IntakeDocumentDropZone";
import { formatIntakeDateTime } from "./intakeLabels";

const noop = () => {};

/**
 * A request's documents. Every member of the organization can open them in
 * the document viewer and add more; uploads are linked to the request by the
 * upload worker, so the list is simply reloaded afterwards.
 */
export function IntakeDocuments({
  orgId,
  requestId,
  documents,
  onChanged,
}: {
  orgId: string;
  requestId: string;
  documents: IntakeDocument[];
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState<File[]>([]);
  const [viewing, setViewing] = useState<Document | null>(null);
  const addLabel = useId();

  async function add(files: File[]) {
    setUploading(files);
    try {
      const outcomes = await uploadIntakeDocuments(
        orgId,
        requestId,
        files.map((file) => ({ file })),
      );
      const failed = outcomes.filter(
        (outcome) => outcome.status !== "completed",
      ).length;
      if (failed)
        notifyPartialFailure(
          `${failed} of ${files.length} documents couldn't be uploaded. Try adding them again.`,
          { action: "upload the documents" },
        );
    } catch (error) {
      notifyError(error, { action: "upload the documents" });
    } finally {
      setUploading([]);
      onChanged();
    }
  }

  async function open(documentId: string) {
    try {
      setViewing(await getDocument(documentId));
    } catch (error) {
      notifyError(error, { action: "open the document" });
    }
  }

  async function download(documentId: string, versionId?: string) {
    try {
      const { url, filename } = await getDocumentUrl(documentId, versionId);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
    } catch (error) {
      notifyError(error, { action: "download the document" });
    }
  }

  return (
    <section aria-labelledby="intake-documents" className="space-y-2">
      <h2 id="intake-documents" className="text-sm font-medium text-gray-900">
        Documents
      </h2>
      {documents.length > 0 && (
        <GlassCardUI>
          <ul>
            {documents.map((document) => (
              <li
                key={document.document_id}
                className="space-y-0.5 border-t border-gray-100 px-4 py-2.5 first:border-t-0"
              >
                {document.status === "ready" ? (
                  <button
                    type="button"
                    onClick={() => void open(document.document_id)}
                    className="rounded-md text-left text-sm font-medium text-gray-900 [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  >
                    {document.filename}
                  </button>
                ) : (
                  <p className="text-sm text-gray-700 [overflow-wrap:anywhere]">
                    {document.filename}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  {document.status === "ready"
                    ? `${document.added_by_name} · ${formatIntakeDateTime(document.created_at)}`
                    : document.status === "error"
                      ? "Couldn't process this file. Upload it again."
                      : "Processing…"}
                </p>
              </li>
            ))}
          </ul>
        </GlassCardUI>
      )}
      <p id={addLabel} className="sr-only">
        Add documents
      </p>
      <IntakeDocumentDropZone
        files={uploading}
        disabled={uploading.length > 0}
        labelledBy={addLabel}
        emptyPrompt="Drag and drop documents here, or click to browse."
        onAdd={(files) => void add(files)}
        onRemove={noop}
      />
      <DocumentSidePanel
        doc={viewing}
        readOnly
        versions={[]}
        versionsLoading={false}
        canDelete={false}
        onClose={() => setViewing(null)}
        onLoadVersions={noop}
        onSelectVersion={noop}
        onDownloadDocument={(documentId) => download(documentId)}
        onDownloadVersion={(documentId, versionId) =>
          download(documentId, versionId)
        }
        onRenameVersion={noop}
        onDeleteVersion={noop}
        onUploadNewVersion={async () => {}}
        onReplaceVersion={noop}
        onDelete={noop}
      />
    </section>
  );
}
