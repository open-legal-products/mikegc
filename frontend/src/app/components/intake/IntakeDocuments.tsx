"use client";

import { useId, useRef, useState } from "react";
import { Cloud, Loader2, Plus, Upload } from "lucide-react";
import type { IntakeDocument } from "@mike/contracts";
import type { Document } from "@/app/components/shared/types";
import {
  getDocument,
  getDocumentUrl,
  listDocumentVersions,
  uploadIntakeDocuments,
  type DocumentVersion,
} from "@/app/lib/mikeApi";
import { notifyError, notifyPartialFailure } from "@/app/lib/userFacingError";
import {
  SUPPORTED_DOCUMENT_ACCEPT,
  formatUnsupportedDocumentWarning,
  partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import { FileTypeIcon } from "@/app/components/shared/FileTypeIcon";
import { IntakeUploadPrompt } from "./IntakeDocumentDropZone";
import { LIQUID_GLASS_MODAL_ROW_HOVER_CLASS } from "@/app/components/ui/liquid-surface";
import { DocumentSidePanel } from "@/app/components/shared/DocumentSidePanel";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "@/shared/ui/dropdown";

const noop = () => {};

/**
 * The file directory's columns. Narrow cards keep the name and size; the
 * date and who added the file join as the card widens.
 */
const DOCUMENT_GRID_CLASS =
  "grid grid-cols-[14px_minmax(0,1fr)_64px] items-center gap-2 @[30rem]:grid-cols-[14px_minmax(0,1fr)_84px_64px] @[40rem]:grid-cols-[14px_minmax(0,1fr)_minmax(0,8rem)_84px_64px]";
const ADDED_BY_CELL_CLASS = "hidden truncate @[40rem]:block";
const ADDED_CELL_CLASS = "hidden truncate @[30rem]:block";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAdded(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A file on its way to a request, and the note it was added with, if any. */
export type IntakeUpload = { file: File; messageId: string | null };

/**
 * Uploads files to a request. The upload worker links each document to the
 * request, and to the note it was added with, so the caller only reloads the
 * list afterwards. Uploads from the documents field and from notes can run at
 * the same time.
 */
export function useIntakeDocumentUpload(
  orgId: string,
  requestId: string,
  onChanged: () => void,
) {
  const [uploading, setUploading] = useState<IntakeUpload[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  async function add(candidates: File[], messageId: string | null = null) {
    const { supported, unsupported } =
      partitionSupportedDocumentFiles(candidates);
    if (!messageId) setWarning(formatUnsupportedDocumentWarning(unsupported));
    if (!supported.length) return;
    const batch = supported.map((file) => ({ file, messageId }));
    setUploading((current) => [...current, ...batch]);
    try {
      const files = supported.map((file) => ({ file }));
      const outcomes = await (messageId
        ? uploadIntakeDocuments(orgId, requestId, files, { messageId })
        : uploadIntakeDocuments(orgId, requestId, files));
      const failed = outcomes.filter(
        (outcome) => outcome.status !== "completed",
      ).length;
      if (failed)
        notifyPartialFailure(
          messageId
            ? `The note was added, but ${failed} of ${supported.length} documents couldn't be uploaded. Add them to the request's documents instead.`
            : `${failed} of ${supported.length} documents couldn't be uploaded. Try adding them again.`,
          { action: "upload the documents" },
        );
    } catch (error) {
      // A note is saved before its documents upload, so say so.
      if (messageId)
        notifyPartialFailure(
          "The note was added, but its documents couldn't be uploaded. Add them to the request's documents instead.",
          { action: "upload the documents" },
        );
      else notifyError(error, { action: "upload the documents" });
    } finally {
      setUploading((current) =>
        current.filter((upload) => !batch.includes(upload)),
      );
      onChanged();
    }
  }

  return { uploading, warning, add };
}

/**
 * Opens a request's documents in the document viewer. The documents section
 * and the notes they were added with share one viewer.
 */
export function useIntakeDocumentViewer() {
  const [viewing, setViewing] = useState<Document | null>(null);
  // Its versions, as the library lists them, and the one being viewed.
  const [history, setHistory] = useState<{
    documentId: string;
    currentVersionId: string | null;
    versions: DocumentVersion[];
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(null);
  // Only the latest versions request answers: one for a document opened
  // before it never replaces the open document's history.
  const versionRequest = useRef(0);

  async function open(documentId: string) {
    try {
      setVersionId(null);
      setViewing(await getDocument(documentId));
    } catch (error) {
      notifyError(error, { action: "open the document" });
    }
  }

  async function loadVersions(documentId: string) {
    const request = ++versionRequest.current;
    setHistoryLoading(true);
    try {
      const res = await listDocumentVersions(documentId);
      if (request !== versionRequest.current) return;
      setHistory({
        documentId,
        currentVersionId: res.current_version_id,
        versions: res.versions,
      });
    } catch (error) {
      if (request !== versionRequest.current) return;
      notifyError(error, {
        action: "load the version history",
        onRetry: () => void loadVersions(documentId),
      });
    } finally {
      if (request === versionRequest.current) setHistoryLoading(false);
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

  const panel = (
    <DocumentSidePanel
      doc={viewing}
      readOnly
      showVersions
      versionId={versionId}
      currentVersionId={
        history?.documentId === viewing?.id ? history?.currentVersionId : null
      }
      versions={
        history && history.documentId === viewing?.id ? history.versions : []
      }
      versionsLoading={historyLoading}
      canDelete={false}
      onClose={() => {
        setViewing(null);
        setVersionId(null);
      }}
      onLoadVersions={(documentId) => loadVersions(documentId)}
      onSelectVersion={(id) => setVersionId(id)}
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
  );

  return { open, panel };
}

/**
 * A request's documents as rows like the file directory's. Until it has any,
 * a grey field below adds them; after that an Add menu beside the heading
 * does, with saved documents or an upload. Files can also be dropped anywhere
 * on the page. Every member of the organization can open them in the
 * document viewer and add more.
 */
export function IntakeDocuments({
  documents,
  uploading,
  warning,
  onAdd,
  onOpen,
  onBrowse,
}: {
  documents: IntakeDocument[];
  uploading: File[];
  warning: string | null;
  onAdd: (files: File[]) => void;
  onOpen: (documentId: string) => void;
  /** Clicking the area opens this, such as the Add documents modal. */
  onBrowse?: () => void;
}) {
  const heading = useId();
  const input = useRef<HTMLInputElement>(null);
  // Set while a menu item opens a dialog, which then keeps focus.
  const openingDialog = useRef(false);
  const busy = uploading.length > 0;
  const spinner = <IntakeDocumentSpinner />;
  const rows = documents.length + uploading.length;
  const hasDocuments = documents.length > 0;
  const uploadingStatus =
    uploading.length === 1
      ? "Uploading 1 document…"
      : `Uploading ${uploading.length} documents…`;

  return (
    <section aria-labelledby={heading} className="@container">
      <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
        <h2 id={heading} className="text-sm font-medium text-gray-900">
          Documents
        </h2>
        {hasDocuments && (
          <Dropdown>
            <DropdownTrigger asChild>
              <TextButtonUI
                size="icon-xs"
                aria-label="Add documents"
                title="Add documents"
                className="-mr-1 h-6"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
              </TextButtonUI>
            </DropdownTrigger>
            <DropdownContent
              align="end"
              className="min-w-40"
              onCloseAutoFocus={(event) => {
                if (openingDialog.current) event.preventDefault();
                openingDialog.current = false;
              }}
            >
              {onBrowse && (
                <DropdownItem
                  onSelect={() => {
                    openingDialog.current = true;
                    onBrowse();
                  }}
                >
                  <Cloud
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-gray-500"
                  />
                  Saved Documents
                </DropdownItem>
              )}
              <DropdownItem onSelect={() => input.current?.click()}>
                <Upload
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-gray-500"
                />
                Upload Documents
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        )}
      </div>
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
      {rows > 0 && (
        // Rows keep their own padding for the hover; with no field below,
        // the last one sits as far from the card's edge as from its sides.
        <div className={`-mx-2 text-xs ${hasDocuments ? "-mb-1" : "mb-3"}`}>
          <div
            aria-hidden="true"
            className={`${DOCUMENT_GRID_CLASS} px-2 pb-1 pt-0.5 text-[11px] font-medium text-gray-400`}
          >
            <span className="col-span-2">Name</span>
            <span className={ADDED_BY_CELL_CLASS}>Added by</span>
            <span className={ADDED_CELL_CLASS}>Added</span>
            <span className="text-right">Size</span>
          </div>
          <ul>
            {documents.map((document) => {
              const ready = document.status === "ready";
              const cells = (
                <>
                  <FileTypeIcon fileType={document.file_type} />
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-gray-700">
                      {document.filename}
                    </span>
                    {!ready && (
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 ${document.status === "error" ? "text-red-600" : "text-gray-400"}`}
                      >
                        {document.status === "error" ? null : spinner}
                        {document.status === "error"
                          ? "Couldn't process"
                          : "Processing"}
                      </span>
                    )}
                  </span>
                  <span className={`${ADDED_BY_CELL_CLASS} text-gray-400`}>
                    {document.added_by_name}
                  </span>
                  <span className={`${ADDED_CELL_CLASS} text-gray-400`}>
                    {formatAdded(document.created_at)}
                  </span>
                  <span className="truncate text-right text-gray-400">
                    {document.size_bytes == null
                      ? "--"
                      : formatSize(document.size_bytes)}
                  </span>
                </>
              );
              return (
                <li key={document.document_id}>
                  {ready ? (
                    <button
                      type="button"
                      aria-label={`Open ${document.filename}`}
                      title={document.filename}
                      onClick={() => onOpen(document.document_id)}
                      className={`w-full rounded-md ${DOCUMENT_GRID_CLASS} px-2 py-2 text-left transition-all ${LIQUID_GLASS_MODAL_ROW_HOVER_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40`}
                    >
                      {cells}
                    </button>
                  ) : (
                    <div
                      title={document.filename}
                      className={`${DOCUMENT_GRID_CLASS} px-2 py-2`}
                    >
                      {cells}
                    </div>
                  )}
                </li>
              );
            })}
            {uploading.map((file, index) => (
              <li
                key={`${file.name}:${index}`}
                title={file.name}
                className={`${DOCUMENT_GRID_CLASS} px-2 py-2`}
              >
                <FileTypeIcon fileType={file.name} />
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-gray-700">
                    {file.name}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-gray-400">
                    {spinner}
                    Uploading
                  </span>
                </span>
                <span className={`${ADDED_BY_CELL_CLASS} text-gray-400`}>
                  --
                </span>
                <span className={`${ADDED_CELL_CLASS} text-gray-400`}>--</span>
                <span className="truncate text-right text-gray-400">
                  {formatSize(file.size)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasDocuments ? (
        <>
          {/* The rows show each upload; this says so to a screen reader. */}
          <p className="sr-only" aria-live="polite">
            {busy ? uploadingStatus : ""}
          </p>
          {warning && (
            <p role="alert" className="mt-3 text-xs text-red-600">
              {warning}
            </p>
          )}
        </>
      ) : (
        <div
          aria-busy={busy}
          className={`rounded-xl bg-gray-100 ${rows ? "p-2" : "p-4"}`}
        >
          {busy ? (
            <p
              className="py-1.5 text-center text-xs text-gray-500"
              aria-live="polite"
            >
              {uploadingStatus}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => (onBrowse ? onBrowse() : input.current?.click())}
              className="w-full rounded-lg py-4 text-center text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <IntakeUploadPrompt />
            </button>
          )}
          {warning && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {warning}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** A document still uploading or being processed. */
export function IntakeDocumentSpinner() {
  return (
    <Loader2
      aria-hidden="true"
      className="h-3 w-3 animate-spin motion-reduce:animate-none"
    />
  );
}
