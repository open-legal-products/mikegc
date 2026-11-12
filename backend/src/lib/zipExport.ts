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
 * A document's filename as one archive entry. A filename is whatever a
 * project member typed, and an archive reads "/" as a folder and ".." as
 * the folder above, so "../../x.pdf" would be written outside the folder the
 * archive is unpacked into by a tool that follows it.
 */
function archiveEntryName(filename: string): string {
  const name = filename.replace(/[/\\\u0000-\u001f]/g, "_").trim();
  return name === "" || name === "." || name === ".." ? "Untitled" : name;
}

/**
 * The form two names are compared in. macOS and Windows unpack
 * "Contract.pdf" and "contract.pdf" to one file, as they do one name in two
 * Unicode forms, and Windows drops trailing dots and spaces; the second file
 * would replace the first there.
 */
function archiveNameKey(name: string): string {
  return name.normalize("NFC").toLowerCase().replace(/[. ]+$/, "");
}

/**
 * A name for a document that is one entry of the archive (never a path) and
 * that no earlier entry has.
 */
export function uniqueArchiveFilename(
  filename: string,
  usedNames: Set<string>,
): string {
  const requestedName = archiveEntryName(filename);
  const taken = (name: string) => usedNames.has(archiveNameKey(name));
  if (!taken(requestedName)) {
    usedNames.add(archiveNameKey(requestedName));
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
  usedNames.add(archiveNameKey(candidate));
  return candidate;
}
