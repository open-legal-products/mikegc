import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import JSZip from "jszip";
import { setStorageAdapter } from "../../../lib/storage";
import type { DbJob } from "../../../lib/dbq/types";
import { tableDb } from "../../../__tests__/helpers/tableDb";

vi.mock("../../../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/access")>()),
  createDocumentAccessChecker: () => async () => ({ ok: true }),
}));
import { handleExportBuild } from "../exportBuild";

it("keeps every document when two share a filename instead of overwriting the ZIP entry", async () => {
  const ids = ["d1", "d2"];
  const fake = tableDb({
    documents: ids.map((id) => ({ id, user_id: "u1", project_id: null, current_version_id: `v-${id}` })),
    document_versions: ids.map((id) => ({ id: `v-${id}`, document_id: id, storage_path: `${id}.pdf`, filename: "Contract.pdf", version_number: 1, deleted_at: null })),
  });
  const upload = vi.fn(async () => {});
  setStorageAdapter({
    enabled: true, configurationHint: "test",
    openReadStream: async (key: string) => [new TextEncoder().encode(key)],
    uploadFileFromPath: async (key: string, path: string, type: string) => (upload as (...args: unknown[]) => Promise<void>)(key, await readFile(path), type),
  } as never);
  const job = {
    id: "export-1", kind: "export.build", payload: { userId: "u1", type: "documents-zip", document_ids: ids },
    status: "running", attempts: 1, max_attempts: 3,
  } as unknown as DbJob;

  await handleExportBuild(fake.db, job);

  const zip = await JSZip.loadAsync((upload.mock.calls[0] as unknown[])[1] as ArrayBuffer);
  expect(Object.keys(zip.files)).toEqual(["Contract.pdf", "Contract (2).pdf"]);
  expect(await zip.file("Contract.pdf")!.async("text")).toBe("d1.pdf");
  expect(await zip.file("Contract (2).pdf")!.async("text")).toBe("d2.pdf");
});
