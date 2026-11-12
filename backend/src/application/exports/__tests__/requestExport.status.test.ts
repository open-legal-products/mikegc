import { expect, it, vi } from "vitest";
import { tableDb } from "../../../__tests__/helpers/tableDb";
import { ZIP_EXPORT_LIMIT_DETAIL } from "../../../lib/zipExport";
import { Readable } from "node:stream";
import { setStorageAdapter } from "../../../lib/storage";
import { loadUserExportArtifact, getUserExportStatus } from "../requestExport";
it.each([ZIP_EXPORT_LIMIT_DETAIL, "PRIVATE_PROVIDER_ERROR"])("returns only an allowlisted export failure reason", async last_error => {
  const fake = tableDb({ db_jobs: [{ id: "job", kind: "export.build", status: "failed", payload: { userId: "user" }, last_error }] });
  expect(await getUserExportStatus(fake.db, "job", "user")).toEqual({ ok: true, body: {
    status: "failed", ...(last_error === ZIP_EXPORT_LIMIT_DETAIL ? { reason: "size_limit" } : {}),
  } });
});

it("streams finished document archives without downloading a whole buffer", async () => {
  const open = vi.fn(async () => [Buffer.from("zip-bytes")]);
  const download = vi.fn();
  setStorageAdapter({ enabled: true, headFile: async () => ({ sizeBytes: 9 }), openReadStream: open, downloadFile: download } as never);
  const fake = tableDb({ db_jobs: [{ id: "job", kind: "export.build", status: "done",
    payload: { userId: "user", type: "documents-zip" }, result: { storage_path: "archive.zip", filename: "documents.zip" } }] });
  expect(await loadUserExportArtifact(fake.db, "job", "other")).toEqual({ ok: false, kind: "not_found" });
  const artifact = await loadUserExportArtifact(fake.db, "job", "user");
  if (!artifact.ok) throw new Error("Expected artifact");
  expect(artifact.body).toBeInstanceOf(Readable);
  expect(open).not.toHaveBeenCalled();
  const chunks = [];
  for await (const chunk of artifact.body as Readable) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe("zip-bytes");
  expect(download).not.toHaveBeenCalled();
});
