"use client";

import { useRef, useState } from "react";
import { DocumentPill } from "@/app/components/shared/DocumentPill";
import {
  SUPPORTED_DOCUMENT_ACCEPT,
  formatUnsupportedDocumentWarning,
  partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";

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
  emptyPrompt = "Drag and drop documents here, or click to browse. PDF, Word, Excel and PowerPoint files are supported.",
}: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  /** The field label that names the area. */
  labelledBy: string;
  emptyPrompt?: string;
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

  const browse = (label: string) => (
    <button
      type="button"
      onClick={() => input.current?.click()}
      disabled={disabled}
      className="w-full rounded-lg py-4 text-center text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed"
    >
      {dragging ? "Drop documents to add them" : label}
    </button>
  );

  return (
    <section
      aria-labelledby={labelledBy}
      aria-busy={disabled}
      className={`rounded-xl bg-gray-100 p-3 transition-colors ${dragging && !disabled ? "ring-2 ring-inset ring-blue-500/40" : ""}`}
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
      {files.length ? (
        <>
          <ul className="flex flex-wrap gap-1.5 px-1 pt-1">
            {files.map((file, index) => (
              <li key={`${file.name}:${index}`} className="min-w-0">
                <DocumentPill
                  filename={file.name}
                  onRemove={() => onRemove(index)}
                  removeDisabled={disabled}
                />
              </li>
            ))}
          </ul>
          {browse("Drop more documents here, or click to browse.")}
        </>
      ) : (
        browse(emptyPrompt)
      )}
      {warning && (
        <p role="alert" className="px-1 pb-1 text-xs text-red-600">
          {warning}
        </p>
      )}
    </section>
  );
}
