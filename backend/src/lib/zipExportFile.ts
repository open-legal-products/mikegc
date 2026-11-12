import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createFileReadStream } from "./storage";
import { MAX_ZIP_EXPORT_BYTES, ZIP_EXPORT_LIMIT_DETAIL, uniqueArchiveFilename } from "./zipExport";
import { NonRetryableJobError } from "./dbq/runner";
import { DbJobDeferredError } from "./dbq/types";

// Hold the slot through upload/cleanup, so concurrent jobs cannot fill disk
// with several large archives. Other job kinds remain free to run.
let building = false;
export async function buildZipExportFile(
  entries: { filename: string; storagePath: string }[],
  maxBytes = MAX_ZIP_EXPORT_BYTES,
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  if (building)
    throw new DbJobDeferredError(new Date(Date.now() + 30_000).toISOString(), "export_capacity");
  building = true;
  let directory: string | undefined;
  const streams: Readable[] = [];
  let released = false;
  const cleanup = async () => {
    if (released) return;
    released = true;
    for (const stream of streams) stream.destroy();
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { building = false; }
  };
  try {
    directory = await mkdtemp(join(tmpdir(), "mike-export-"));
    const filePath = join(directory, "documents.zip");
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const names = new Set<string>();
    let sourceBytes = 0;
    const limitError = () => new NonRetryableJobError(ZIP_EXPORT_LIMIT_DETAIL, { reportLevel: null });
    for (const entry of entries) {
      // The generator starts only when JSZip reaches this entry. Neither
      // source files nor the finished archive are retained as whole buffers.
      const stream = Readable.from((async function* () {
        const source = createFileReadStream(entry.storagePath);
        try {
          for await (const chunk of source) {
            sourceBytes += chunk.length;
            if (sourceBytes > maxBytes) throw limitError();
            yield chunk;
          }
        } finally { source.destroy(); }
      })());
      streams.push(stream);
      zip.file(uniqueArchiveFilename(entry.filename, names), stream, { compression: "STORE" });
    }
    let outputBytes = 0;
    const boundOutput = new Transform({
      transform(chunk, _encoding, callback) {
        outputBytes += chunk.length;
        callback(outputBytes > maxBytes ? limitError() : null, chunk);
      },
    });
    await pipeline(zip.generateNodeStream({ streamFiles: true, compression: "STORE" }), boundOutput, createWriteStream(filePath));
    return { filePath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
