import { afterEach, expect, it, vi } from "vitest";
import { access, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import JSZip from "jszip";
const read = vi.hoisted(() => vi.fn());
vi.mock("../storage", () => ({ createFileReadStream: read }));
import { buildZipExportFile } from "../zipExportFile";
afterEach(() => vi.resetAllMocks());
it("bounds actual streamed bytes and releases its slot after failure", async () => {
  read.mockImplementation(() => Readable.from([Buffer.alloc(80), Buffer.alloc(80)]));
  await expect(buildZipExportFile([{ filename: "a", storagePath: "a" }], 100)).rejects.toThrow("export limit");
  read.mockImplementation(() => Readable.from([Buffer.from("contract")]));
  const artifact = await buildZipExportFile([{ filename: "a", storagePath: "a" }]);
  expect(await (await JSZip.loadAsync(await readFile(artifact.filePath))).file("a")!.async("string")).toBe("contract");
  await artifact.cleanup();
  await expect(access(artifact.filePath)).rejects.toThrow();
});
it("defers other archives until upload cleanup releases the disk reservation", async () => {
  read.mockImplementation(() => Readable.from([Buffer.from("contract")]));
  const first = await buildZipExportFile([{ filename: "a", storagePath: "a" }]);
  await expect(buildZipExportFile([{ filename: "b", storagePath: "b" }])).rejects.toMatchObject({ code: "export_capacity" });
  expect(read).toHaveBeenCalledTimes(1);
  await first.cleanup();
  const next = await buildZipExportFile([{ filename: "b", storagePath: "b" }]);
  await next.cleanup();
  expect(read).toHaveBeenCalledTimes(2);
});
