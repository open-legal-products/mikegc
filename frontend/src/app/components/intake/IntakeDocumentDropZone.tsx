"use client";

import { useRef, useState } from "react";
import { DocumentPill } from "@/app/components/shared/DocumentPill";
import { FileTypeIcon } from "@/app/components/shared/FileTypeIcon";
import {
  SUPPORTED_DOCUMENT_ACCEPT,
  formatUnsupportedDocumentWarning,
  partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import type { IntakePickedDocument } from "./IntakeDocumentPicker";

/** The accepted file types, upright and overlapping in a row. */
const PROMPT_FILE_TYPES = ["pdf", "docx", "xlsx", "pptx"];

/**
 * What an empty upload field asks for: the accepted file types as icons,
 * then the action. A screen reader hears the types in words.
 */
export function IntakeUploadPrompt() {
  return (
    <>
      <span aria-hidden="true" className="mb-2 flex justify-center">
        {PROMPT_FILE_TYPES.map((fileType, index) => (
          <span
            key={fileType}
            className={`${index ? "-ml-2" : ""} drop-shadow-[0_1px_2px_rgba(15,23,42,0.18)]`}
          >
            <FileTypeIcon fileType={fileType} className="h-4 w-4" />
          </span>
        ))}
      </span>
      <span className="block">
        Drag and drop documents here, or click to browse.
      </span>
      <span className="sr-only">
        PDF, Word, Excel and PowerPoint files are supported.
      </span>
    </>
  );
}

/**
 * Collects files for a request: drop them on the area, or click it to browse.
 * Files only wait here; the caller uploads them to the request.
 */
export function IntakeDocumentDropZone({
  files,
  onAdd,
  onRemove,
  disabled = false,
  labelledBy,
  picked = [],
  onBrowse,
  onRemovePicked,
}: {
  files: File[];
  /** Library documents chosen to add, copied once the request exists. */
  picked?: IntakePickedDocument[];
  /** Clicking the area opens this, such as the Add documents modal. */
  onBrowse?: () => void;
  onRemovePicked?: (id: string) => void;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  /** The field label that names the area. */
  labelledBy: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  function add(candidates: File[]) {
    const { supported, unsupported } =
      partitionSupportedDocumentFiles(candidates);
    setWarning(formatUnsupportedDocumentWarning(unsupported));
    if (supported.length) onAdd(supported);
  }

  return (
    <section
      aria-labelledby={labelledBy}
      aria-busy={disabled}
      className={`rounded-xl bg-gray-100 p-4 transition-colors ${dragging && !disabled ? "ring-2 ring-inset ring-blue-500/40" : ""}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        if (!disabled) add(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={SUPPORTED_DOCUMENT_ACCEPT}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          add(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {files.length + picked.length ? (
        <>
          <button
            type="button"
            onClick={() => (onBrowse ? onBrowse() : input.current?.click())}
            disabled={disabled}
            className="mb-3 block rounded-md text-left text-xs text-gray-500 transition-colors hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed"
          >
            {dragging
              ? "Drop documents to add them"
              : "Drop more documents here, or click to add more."}
          </button>
          <ul className="flex flex-wrap gap-1.5">
            {files.map((file, index) => (
              <li key={`${file.name}:${index}`} className="min-w-0">
                <DocumentPill
                  filename={file.name}
                  onRemove={() => onRemove(index)}
                  removeDisabled={disabled}
                />
              </li>
            ))}
            {picked.map((document) => (
              <li key={document.id} className="min-w-0">
                <DocumentPill
                  filename={document.filename}
                  onRemove={() => onRemovePicked?.(document.id)}
                  removeDisabled={disabled}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <button
          type="button"
          onClick={() => (onBrowse ? onBrowse() : input.current?.click())}
          disabled={disabled}
          className="w-full rounded-lg py-4 text-center text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed"
        >
          {dragging ? "Drop documents to add them" : <IntakeUploadPrompt />}
        </button>
      )}
      {warning && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {warning}
        </p>
      )}
    </section>
  );
}
