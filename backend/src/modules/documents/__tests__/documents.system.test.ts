import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

const mocks = vi.hoisted(() => ({
  loadActiveVersion: vi.fn(),
  downloadFile: vi.fn(),
  extractDocxBodyText: vi.fn(),
  writeTrackedEdits: vi.fn(),
}));
vi.mock("../../../lib/documentVersions", () => ({
  loadActiveVersion: mocks.loadActiveVersion,
}));
vi.mock("../../../lib/storage", () => ({ downloadFile: mocks.downloadFile }));
vi.mock("../../../lib/docxTrackedChanges", () => ({
  extractDocxBodyText: mocks.extractDocxBodyText,
}));
vi.mock("../documents.trackedEdits", () => ({
  writeTrackedEdits: mocks.writeTrackedEdits,
}));
import {
  applyOrgTrackedEdits,
  loadOrgDocument,
  readOrgDocumentText,
} from "../documents.system";

const org = "org-a";

/** The few reads these helpers make, answered from fixed rows. */
function fakeDb(rows: {
  document?: Record<string, unknown> | null;
  versions?: number;
  text?: Record<string, unknown> | null;
}): Db {
  const chain = (result: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is"]) builder[name] = () => builder;
    builder.maybeSingle = async () => ({ data: result, error: null });
    builder.then = (resolve: (r: unknown) => unknown) =>
      resolve({ count: rows.versions ?? 1, error: null });
    return builder;
  };
  return {
    from: (table: string) =>
      chain(
        table === "documents"
          ? rows.document ?? null
          : table === "document_version_texts"
            ? rows.text ?? null
            : null,
      ),
  } as unknown as Db;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadActiveVersion.mockResolvedValue({
    id: "v1",
    storage_path: "documents/intake-org-a/doc/v1.docx",
    filename: "nda.docx",
    file_type: "docx",
  });
});

describe("organization-owned documents", () => {
  it("reaches only a document the organization owns, with no uploader", async () => {
    const own = fakeDb({ document: { id: "doc", org_id: org, user_id: null }, versions: 2 });
    expect(await loadOrgDocument(own, org, "doc")).toEqual({
      id: "doc",
      filename: "nda.docx",
      isDocx: true,
      version: { id: "v1", storagePath: "documents/intake-org-a/doc/v1.docx" },
      versionCount: 2,
    });
    for (const document of [
      { id: "doc", org_id: org, user_id: "member" },
      { id: "doc", org_id: "org-b", user_id: null },
      null,
    ])
      expect(await loadOrgDocument(fakeDb({ document }), org, "doc")).toBeNull();
  });

  it("reads a Word document from its file and anything else as extracted", async () => {
    const doc = {
      id: "doc",
      filename: "nda.docx",
      isDocx: true,
      version: { id: "v1", storagePath: "path" },
      versionCount: 1,
    };
    mocks.downloadFile.mockResolvedValue(new Uint8Array([1]).buffer);
    mocks.extractDocxBodyText.mockResolvedValue("The term is five years.");
    expect(await readOrgDocumentText(fakeDb({}), doc)).toEqual({
      status: "ready",
      text: "The term is five years.",
    });
    const pdf = { ...doc, filename: "terms.pdf", isDocx: false };
    expect(
      await readOrgDocumentText(fakeDb({ text: { status: "processing", text_content: null } }), pdf),
    ).toEqual({ status: "pending" });
    expect(
      await readOrgDocumentText(fakeDb({ text: { status: "ready", text_content: "Pay in 30 days." } }), pdf),
    ).toEqual({ status: "ready", text: "Pay in 30 days." });
    expect(
      await readOrgDocumentText(fakeDb({ text: { status: "failed", text_content: null } }), pdf),
    ).toEqual({ status: "unavailable" });
  });

  it("marks up against the version it read, stored under the organization", async () => {
    const db = fakeDb({});
    const doc = {
      id: "doc",
      filename: "nda.docx",
      isDocx: true,
      version: { id: "v1", storagePath: "path" },
      versionCount: 1,
    };
    const edits = [{ find: "five", replace: "two", context_before: "", context_after: "" }];
    await applyOrgTrackedEdits({ db, orgId: org, request: { id: "request", version: 1 }, doc, author: "MikeGC", edits });
    expect(mocks.writeTrackedEdits).toHaveBeenCalledWith({
      documentId: "doc",
      storageOwner: "intake-org-a",
      author: "MikeGC",
      edits,
      db,
      expectedVersion: { id: "v1", storagePath: "path" },
      intakeRequest: { orgId: org, id: "request", version: 1 },
    });
  });
});
