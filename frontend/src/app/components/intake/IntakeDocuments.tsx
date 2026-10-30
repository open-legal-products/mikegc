"use client";

import { useId, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { IntakeDocument } from "@mike/contracts";
import type { Document } from "@/app/components/shared/types";
import {
  getDocument,
  getDocumentUrl,
  uploadIntakeDocuments,
} from "@/app/lib/mikeApi";
import { notifyError, notifyPartialFailure } from "@/app/lib/userFacingError";
import {
  SUPPORTED_DOCUMENT_ACCEPT,
  formatUnsupportedDocumentWarning,
  partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import { DocumentPill } from "@/app/components/shared/DocumentPill";
import { DocumentSidePanel } from "@/app/components/shared/DocumentSidePanel";

const noop = () => {};

/**
 * Uploads files to a request. The upload worker links each document to the
 * request, so the caller only reloads the list afterwards.
 */
export function useIntakeDocumentUpload(
  orgId: string,
  requestId: string,
  onChanged: () => void,
) {
  const [uploading, setUploading] = useState<File[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  async function add(candidates: File[]) {
    const { supported, unsupported } =
      partitionSupportedDocumentFiles(candidates);
    setWarning(formatUnsupportedDocumentWarning(unsupported));
    if (!supported.length || uploading.length) return;
    setUploading(supported);
    try {
      const outcomes = await uploadIntakeDocuments(
        orgId,
        requestId,
        supported.map((file) => ({ file })),
      );
      const failed = outcomes.filter(
        (outcome) => outcome.status !== "completed",
      ).length;
      if (failed)
        notifyPartialFailure(
          `${failed} of ${supported.length} documents couldn't be uploaded. Try adding them again.`,
          { action: "upload the documents" },
        );
    } catch (error) {
      notifyError(error, { action: "upload the documents" });
    } finally {
      setUploading([]);
      onChanged();
    }
  }

  return { uploading, warning, add };
}

/**
 * A request's documents as one row of file chips. Every member of the
 * organization can open them in the document viewer and add more.
 */
export function IntakeDocuments({
  documents,
  uploading,
  warning,
  onAdd,
}: {
  documents: IntakeDocument[];
  uploading: File[];
  warning: string | null;
  onAdd: (files: File[]) => void;
}) {
  const heading = useId();
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<Document | null>(null);

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

  const spinner = (
    <Loader2
      aria-hidden="true"
      className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none"
    />
  );

  return (
    <section aria-labelledby={heading} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 id={heading} className="mr-1 text-sm font-medium text-gray-900">
          Documents
        </h2>
        {documents.map((document) => (
          <DocumentPill
            key={document.document_id}
            filename={document.filename}
            fileType={document.file_type}
            icon={document.status === "ready" ? undefined : spinner}
            status={
              document.status === "ready"
                ? undefined
                : document.status === "error"
                  ? "Couldn't process"
                  : "Processing"
            }
            tone={document.status === "error" ? "error" : "default"}
            onOpen={
              document.status === "ready"
                ? () => void open(document.document_id)
                : undefined
            }
          />
        ))}
        {uploading.map((file, index) => (
          <DocumentPill
            key={`${file.name}:${index}`}
            filename={file.name}
            icon={spinner}
            status="Uploading"
          />
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={uploading.length > 0}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-gray-500 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus aria-hidden="true" className="h-3 w-3" />
          Add
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={SUPPORTED_DOCUMENT_ACCEPT}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            onAdd(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      {!documents.length && !uploading.length && (
        <p className="text-xs text-gray-500">
          None yet. Drop files anywhere on this page, or choose Add.
        </p>
      )}
      {warning && (
        <p role="alert" className="text-xs text-red-600">
          {warning}
        </p>
      )}
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
