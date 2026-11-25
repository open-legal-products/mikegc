import { Readable } from "node:stream";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_ZIP_EXPORT_BYTES,
  MAX_ZIP_EXPORT_DOCUMENTS,
  uniqueArchiveFilename,
  zipExportLimitDetail,
} from "../zipExport";

describe("ZIP export limits", () => {
  it("accepts exports at the configured limits", () => {
    expect(
      zipExportLimitDetail(MAX_ZIP_EXPORT_DOCUMENTS, MAX_ZIP_EXPORT_BYTES),
    ).toBeNull();
  });

  it("rejects excessive document counts and total bytes", () => {
    expect(zipExportLimitDetail(MAX_ZIP_EXPORT_DOCUMENTS + 1, 0)).toMatch(
      /at most 200 documents/i,
    );
    expect(zipExportLimitDetail(1, MAX_ZIP_EXPORT_BYTES + 1)).toMatch(
      /at most 2 GB/i,
    );
  });

  it("keeps documents with duplicate filenames as separate archive entries", () => {
    const usedNames = new Set<string>();

    expect(uniqueArchiveFilename("Contract.pdf", usedNames)).toBe(
      "Contract.pdf",
    );
    expect(uniqueArchiveFilename("Contract.pdf", usedNames)).toBe(
      "Contract (2).pdf",
    );
    expect(uniqueArchiveFilename("Contract.pdf", usedNames)).toBe(
      "Contract (3).pdf",
    );
  });

  it("consumes streamed ZIP entries one at a time", async () => {
    let firstStarted = false;
    let secondStarted = false;
    let releaseFirst = () => {};
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = Readable.from(
      (async function* () {
        firstStarted = true;
        await firstBlocked;
        yield Buffer.from("first");
      })(),
    );
    const second = Readable.from(
      (async function* () {
        secondStarted = true;
        yield Buffer.from("second");
      })(),
    );
    const zip = new JSZip();
    zip.file("first.txt", first);
    zip.file("second.txt", second);
    const archive = zip.generateNodeStream({
      type: "nodebuffer",
      streamFiles: true,
      compression: "STORE",
    });
    const output: Buffer[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      archive
        .on("data", (chunk) => output.push(Buffer.from(chunk)))
        .once("error", reject)
        .once("end", resolve);
    });

    await vi.waitFor(() => expect(firstStarted).toBe(true));
    expect(secondStarted).toBe(false);
    releaseFirst();
    await completed;

    expect(secondStarted).toBe(true);
    const generated = await JSZip.loadAsync(Buffer.concat(output));
    await expect(generated.file("first.txt")?.async("text")).resolves.toBe(
      "first",
    );
    await expect(generated.file("second.txt")?.async("text")).resolves.toBe(
      "second",
    );
  });
  it("keeps names that differ only by case apart", () => {
    const used = new Set<string>();
    expect(uniqueArchiveFilename("Contract.pdf", used)).toBe("Contract.pdf");
    expect(uniqueArchiveFilename("contract.pdf", used)).toBe("contract (2).pdf");
    expect(uniqueArchiveFilename("CONTRACT (2).PDF", used)).toBe("CONTRACT (2) (2).PDF");
  });
  it("keeps a filename one entry of the archive, never a path out of it", () => {
    const used = new Set<string>();
    expect(uniqueArchiveFilename("../../.zshrc", used)).toBe(".._.._.zshrc");
    expect(uniqueArchiveFilename("deal\\..\\notes.pdf", used)).toBe("deal_.._notes.pdf");
    expect(uniqueArchiveFilename("a/b.pdf", used)).toBe("a_b.pdf");
    expect(uniqueArchiveFilename("..", used)).toBe("Untitled");
    expect(uniqueArchiveFilename(" ", used)).toBe("Untitled (2)");
  });
  it("keeps apart names a file system unpacks to one file", () => {
    const used = new Set<string>();
    expect(uniqueArchiveFilename("R\u00e9sum\u00e9.pdf", used)).toBe("R\u00e9sum\u00e9.pdf");
    // The same name as macOS stores it: letters followed by combining accents.
    expect(uniqueArchiveFilename("Re\u0301sume\u0301.pdf", used)).toBe("Re\u0301sume\u0301 (2).pdf");
    // Windows drops trailing dots and spaces.
    expect(uniqueArchiveFilename("Notes.txt", used)).toBe("Notes.txt");
    expect(uniqueArchiveFilename("Notes.txt.", used)).toBe("Notes.txt (2).");
  });
});
