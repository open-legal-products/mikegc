import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";
import type { Db } from "../../../lib/supabase";
import { verifyDownload } from "../../../lib/downloadTokens";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  apply: vi.fn(),
  index: vi.fn(),
  objects: new Map<string, Buffer>(),
  order: [] as string[],
}));
// Keep active-version loading, hashing, signed links and the lifecycle RPC
// adapter real. Only blob IO, DOCX binary work and indexing are substituted.
vi.mock("../../../lib/storage", () => ({
  downloadFile: mocks.download,
  uploadFile: mocks.upload,
  deleteFileBestEffort: mocks.remove,
}));
vi.mock("../../../lib/docxTrackedChanges", () => ({ applyTrackedEdits: mocks.apply }));
vi.mock("../documents.indexing", () => ({ processDocumentTextInline: mocks.index }));
import { writeTrackedEdits } from "../documents.trackedEdits";

const documentId = "intake-document";
const request = { orgId: "org-a", id: "request-a", version: 17 };
const snapshot = { id: "original-version", storagePath: "documents/intake-org-a/intake-document/original.docx" };
const filename = "Negotiated NDA.docx";
const change = {
  id: "change-a", delId: "del-4", insId: "ins-5",
  deletedText: "five", insertedText: "two",
  contextBefore: "Term: ", contextAfter: " years.", reason: "Shorten the term",
};
const storedEdit = {
  id: "persisted-edit", change_id: change.id,
  deleted_text: "five", inserted_text: "two",
  context_before: "Term: ", context_after: " years.",
};
// The view intentionally shares a larger backing buffer. Stored bytes, size
// and hash must describe only the edited document, never the padding.
const edited = Buffer.from("padding:edited-docx:padding").subarray(8, 19);
const edits = [{ find: "five", replace: "two", context_before: "Term: ", context_after: " years.", reason: change.reason }];

type CommitArgs = {
  p_version: { id: string; storage_path: string };
  [key: string]: unknown;
};
function database(outcome: "commit" | "reject" | "lost-response" | "throw" = "commit") {
  const reads = scriptedDb([
    { table: "documents", data: { current_version_id: snapshot.id } },
    { table: "document_versions", data: {
      id: snapshot.id, document_id: documentId,
      storage_path: snapshot.storagePath, filename: `  ${filename}  `,
      version_number: 4, source: "upload", file_type: "docx",
    } },
  ]);
  let committedVersion: string | null = null;
  const rpc = vi.fn(async (name: string, args: CommitArgs) => {
    expect(name).toBe("commit_intake_document_edits");
    mocks.order.push("commit-rpc");
    expect(mocks.objects.get(args.p_version.storage_path)).toEqual(edited);
    if (outcome === "reject") return { data: null, error: null };
    // A lost acknowledgement can follow a successful transaction: deleting
    // this blob would then corrupt the active version.
    committedVersion = args.p_version.id;
    if (outcome === "lost-response") return { data: null, error: { message: "Synthetic connection lost after commit" } };
    if (outcome === "throw") throw new Error("Synthetic transport rejected after commit");
    return { data: {
      version: { id: committedVersion, version_number: 12 },
      edits: [storedEdit],
    }, error: null };
  });
  const db = { ...reads.db, rpc } as unknown as Db;
  return { ...reads, db, rpc, committedVersion: () => committedVersion };
}
const write = (db: Db, overrides: Partial<Parameters<typeof writeTrackedEdits>[0]> = {}) => writeTrackedEdits({
  db, documentId, storageOwner: "intake-org-a", author: "MikeGC",
  edits, expectedVersion: snapshot, intakeRequest: request, ...overrides,
});
function onlyGuardedCommit(fake: ReturnType<typeof database>) {
  expect(fake.rpc).toHaveBeenCalledTimes(1);
  expect(fake.rpc.mock.calls[0][0]).toBe("commit_intake_document_edits");
  // The strict read script also fails any direct version/edit insertion.
  expect(fake.calls.map(({ table, op }) => ({ table, op }))).toEqual([
    { table: "documents", op: "select" },
    { table: "document_versions", op: "select" },
  ]);
  fake.done();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DOWNLOAD_SIGNING_SECRET", "synthetic-intake-edit-test-secret");
  mocks.objects.clear(); mocks.order.length = 0;
  mocks.download.mockResolvedValue(Buffer.from("original-docx"));
  mocks.apply.mockResolvedValue({ bytes: edited, changes: [change], errors: [] });
  mocks.upload.mockImplementation(async (path: string, bytes: ArrayBuffer) => {
    mocks.order.push("upload"); mocks.objects.set(path, Buffer.from(bytes));
  });
  mocks.remove.mockImplementation(async (path: string) => { mocks.objects.delete(path); });
  mocks.index.mockImplementation(async () => { mocks.order.push("index"); });
});
afterEach(() => vi.unstubAllEnvs());

describe("intake tracked edits guarded persistence", () => {
  it("uploads once, atomically commits version and edit rows, then indexes the acknowledged version", async () => {
    const fake = database();
    const result = await write(fake.db);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const args = fake.rpc.mock.calls[0][1];
    expect(args).toEqual({
      p_org: "org-a", p_request: "request-a", p_request_version: 17,
      p_document: documentId, p_expected_version: snapshot.id, p_expected_path: snapshot.storagePath,
      p_version: {
        id: result.version_id, storage_path: result.storage_path,
        source: "assistant_edit", filename, file_type: "docx",
        size_bytes: edited.byteLength,
        content_sha256: createHash("sha256").update(edited).digest("hex"),
      },
      p_edits: [{
        document_id: documentId, version_id: result.version_id,
        change_id: change.id, del_w_id: "del-4", ins_w_id: "ins-5",
        deleted_text: "five", inserted_text: "two", context_before: "Term: ", context_after: " years.", status: "pending",
      }],
    });
    expect(result.storage_path).toBe(`documents/intake-org-a/${documentId}/edits/${result.version_id}.docx`);
    expect(result.version_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.version_number).toBe(12);
    expect(result.annotations).toEqual([expect.objectContaining({
      edit_id: "persisted-edit", document_id: documentId,
      version_id: result.version_id, version_number: 12,
      change_id: change.id, reason: change.reason, status: "pending",
    })]);
    expect(verifyDownload(result.download_url.slice("/download/".length))).toEqual({ path: result.storage_path, filename });
    expect(mocks.download).toHaveBeenCalledWith(snapshot.storagePath);
    expect(mocks.apply).toHaveBeenCalledWith(Buffer.from("original-docx"), edits, { author: "MikeGC" });
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(result.storage_path, expect.any(ArrayBuffer), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(mocks.order).toEqual(["upload", "commit-rpc", "index"]);
    expect(mocks.index).toHaveBeenCalledExactlyOnceWith(fake.db, [result.version_id]);
    expect(mocks.remove).not.toHaveBeenCalled();
    onlyGuardedCommit(fake);
  });

  it("removes only the newly uploaded orphan after an acknowledged rejection, without edits, activation or indexing", async () => {
    const fake = database("reject");
    expect(await write(fake.db)).toEqual({ ok: false, error: "The request or document changed. Automated edits were not applied." });
    const path = fake.rpc.mock.calls[0][1].p_version.storage_path;
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(path, "intake-edit-superseded");
    expect(path).not.toBe(snapshot.storagePath);
    expect(mocks.objects.size).toBe(0);
    expect(fake.committedVersion()).toBeNull();
    expect(mocks.index).not.toHaveBeenCalled();
    onlyGuardedCommit(fake);
  });

  it.each(["lost-response", "throw"] as const)("retains possibly committed bytes on %s and never attempts a separate activation", async outcome => {
    const fake = database(outcome);
    if (outcome === "throw") await expect(write(fake.db)).rejects.toThrow("Synthetic transport rejected after commit");
    else expect(await write(fake.db)).toEqual({ ok: false, error: "Could not save intake edits. Check the document before retrying." });
    const { id, storage_path } = fake.rpc.mock.calls[0][1].p_version;
    expect(fake.committedVersion()).toBe(id);
    expect(mocks.objects.get(storage_path)).toEqual(edited);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
    onlyGuardedCommit(fake);
  });

  it.each([{ ...snapshot, id: "stale-version" }, { ...snapshot, storagePath: "stale-path" }])("refuses a stale document snapshot before binary work or upload (%j)", async expectedVersion => {
    const fake = database();
    expect(await write(fake.db, { expectedVersion })).toMatchObject({ ok: false, error: expect.stringMatching(/document changed/i) });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(fake.rpc).not.toHaveBeenCalled(); fake.done();
  });

  it.each([
    { expectedVersion: undefined },
    { reuseVersion: { versionId: snapshot.id, versionNumber: 4, storagePath: snapshot.storagePath } },
  ])("refuses to bypass the intake guard with an absent snapshot or reused turn version (%j)", async overrides => {
    const fake = database();
    expect(await write(fake.db, overrides)).toEqual({ ok: false, error: "Intake edits require an original document snapshot." });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(fake.rpc).not.toHaveBeenCalled(); fake.done();
  });
});
