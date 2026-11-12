export const MAX_ZIP_EXPORT_DOCUMENTS = 200;
export const MAX_ZIP_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;

export function zipExportLimitDetail(
  documentCount: number,
  totalBytes: number,
): string | null {
  if (documentCount > MAX_ZIP_EXPORT_DOCUMENTS) {
    return `A ZIP download can include at most ${MAX_ZIP_EXPORT_DOCUMENTS} documents.`;
  }
  if (totalBytes > MAX_ZIP_EXPORT_BYTES) {
    return "A ZIP download can include at most 2 GB of source files.";
  }
  return null;
}

/**
 * A name no earlier entry of the archive has. Names are compared without
 * regard to case: macOS and Windows unpack "Contract.pdf" and "contract.pdf"
 * to one file, so the second would replace the first there.
 */
export function uniqueArchiveFilename(
  requestedName: string,
  usedNames: Set<string>,
): string {
  const taken = (name: string) => usedNames.has(name.toLowerCase());
  if (!taken(requestedName)) {
    usedNames.add(requestedName.toLowerCase());
    return requestedName;
  }

  const dot = requestedName.lastIndexOf(".");
  const stem = dot > 0 ? requestedName.slice(0, dot) : requestedName;
  const extension = dot > 0 ? requestedName.slice(dot) : "";
  let copyNumber = 2;
  let candidate = `${stem} (${copyNumber})${extension}`;
  while (taken(candidate)) {
    copyNumber += 1;
    candidate = `${stem} (${copyNumber})${extension}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}
