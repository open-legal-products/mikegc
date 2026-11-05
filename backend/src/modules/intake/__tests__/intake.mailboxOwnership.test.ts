import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { automatedIntakeRpc, memoryDb, type MemoryDb } from "./memoryDb";

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(), downloadFile: vi.fn(), deleteFileBestEffort: vi.fn(),
  enqueueDbJob: vi.fn(), createDocumentVersion: vi.fn(),
}));
vi.mock("../../../lib/storage", async (original) => ({
  ...(await original<typeof import("../../../lib/storage")>()),
  uploadFile: mocks.uploadFile, downloadFile: mocks.downloadFile,
  deleteFileBestEffort: mocks.deleteFileBestEffort,
}));
vi.mock("../../../lib/dbq/enqueue", () => ({ enqueueDbJob: mocks.enqueueDbJob }));
vi.mock("../../documents/documents.service", () => ({ createDocumentVersion: mocks.createDocumentVersion }));
import type { DbJob } from "../../../lib/dbq/types";
import type { Db } from "../../../lib/supabase";
import { recordMail } from "../intake.mailbox";
import { handleIntakeReply } from "../intake.reply";
import type { ReadMail } from "../intake.outlook";
import type { AutomationRow } from "../intake.settingsRow";

const org = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const env = { ...process.env };
const bytes = new Uint8Array([37, 80, 68, 70]).buffer;
let memory: MemoryDb;
let storage: Map<string, ArrayBuffer>;
let attachmentRead: Mock<() => Promise<Buffer | null>>;
const settings = () => memory.rows("intake_automation")[0] as unknown as AutomationRow;
const inbound = () => memory.rows("intake_inbound");
const attachmentKey = () => (inbound()[0]!.payload as { attachments: { key: string }[] }).attachments[0]!.key;
const mail = (): ReadMail => ({
  provider: "gmail", providerId: "gm-reply", internetMessageId: "<reply@acme.test>", thread: "t1",
  headers: [{ name: "Authentication-Results", value: "mx.google.com; dmarc=pass header.from=acme.test" }],
  from: { name: "Jane Business", email: "jane@acme.test" }, to: ["intake@firm.test"], cc: [],
  subject: "Re: NDA", date: "2026-11-04T09:00:00.000Z", text: "Here is the agreement.",
  newText: "Here is the agreement.", isDraft: false,
  attachments: [{ name: "agreement.pdf", size: 4, contentType: "application/pdf", inline: false, read: attachmentRead }],
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DB_JOBS_ENABLED = "true";
  storage = new Map();
  attachmentRead = vi.fn(async () => Buffer.from(bytes));
  mocks.uploadFile.mockImplementation(async (key, value) => { storage.set(key, value); });
  mocks.downloadFile.mockImplementation(async (key) => storage.get(key) ?? null);
  mocks.deleteFileBestEffort.mockImplementation(async (key) => { storage.delete(key); });
  mocks.enqueueDbJob.mockResolvedValue({ id: "job", deduped: false });
  mocks.createDocumentVersion.mockImplementation(async (_db, version) => {
    memory.rows("document_versions").push(version);
    return { data: { id: version.id }, error: null };
  });
  // No provider/model traffic is permitted in these recovery tests.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external call"); }));
  memory = memoryDb({
    intake_automation: [{ org_id: org, email_enabled: true, email_provider: "gmail", email_mailbox: "intake@firm.test", email_allowed_domains: ["acme.test"] }],
    intake_channel_links: [{ id: "link-1", org_id: org, request_id: requestId, source: "gmail", thread_key: "gmail:t1", address: { provider: "gmail", mailbox: "intake@firm.test", to: ["jane@acme.test"], cc: [] } }],
    intake_requests: [{ id: requestId, org_id: org, state: "needs_information", subject: "Synthetic NDA", assignee_id: null, clarify_stage: null }],
  }, automatedIntakeRpc);
});
afterAll(() => { process.env = env; vi.unstubAllGlobals(); });

async function importReply() {
  const row = inbound()[0]!;
  const job: DbJob = { id: "reply-job", kind: "intake.reply", payload: { orgId: org, inboundId: row.id }, status: "running", attempts: 1, max_attempts: 4, run_at: "", claimed_at: "", finished_at: null, last_error: null, dedupe_key: null, result: null, created_at: "" };
  await handleIntakeReply(memory.db, job);
  expect(row).toMatchObject({ status: "done", payload: null });
  const [version] = memory.rows("document_versions");
  expect(version).toMatchObject({ filename: "agreement.pdf", file_type: "pdf", size_bytes: 4 });
  expect(storage.get(String(version!.storage_path))).toEqual(bytes);
  expect(memory.rows("documents")).toEqual([expect.objectContaining({ id: version!.document_id, status: "ready" })]);
  expect(memory.rows("intake_request_documents")).toEqual([expect.objectContaining({ document_id: version!.document_id, message_id: memory.rows("intake_messages")[0]!.id })]);
  expect(mocks.createDocumentVersion).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
}

/** Drop the INSERT acknowledgement after the real in-memory insert commits. */
function ambiguousInsert(mode: "error" | "throw" | "missing" | "duplicate"): Db {
  return { ...memory.db, from: (table: string) => {
    const query = memory.db.from(table);
    if (table !== "intake_inbound") return query;
    // memoryDb exposes one builder for all query phases.
    const single = (query as unknown as { single: () => Promise<{ data: unknown; error: unknown }> }).single.bind(query);
    return Object.assign(query, { single: async () => {
      const result = await single();
      if (!result.error) {
        if (mode === "throw") throw new Error("Lost INSERT response");
        if (mode === "missing") return { data: null, error: null };
        if (mode === "duplicate") return { data: null, error: { code: "23505", message: "INSERT replay after lost acknowledgement" } };
        return { data: null, error: { code: "", message: "Lost INSERT response" } };
      }
      return result;
    } });
  } } as Db;
}

describe("mail attachment ownership across persistence and dispatch", () => {
  it("keeps a committed reply's bytes after enqueue failure and imports them on retry", async () => {
    mocks.enqueueDbJob.mockRejectedValueOnce(new Error("Queue unavailable"));
    await expect(recordMail(memory.db, settings(), mail())).rejects.toThrow("Queue unavailable");
    expect(inbound()).toHaveLength(1);
    const key = attachmentKey();
    expect(storage.get(key)).toEqual(bytes);
    expect(mocks.deleteFileBestEffort).not.toHaveBeenCalled();
    await expect(recordMail(memory.db, settings(), mail())).resolves.toBe("duplicate");
    expect(attachmentRead).toHaveBeenCalledTimes(1);
    await importReply();
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, expect.objectContaining({ kind: "storage.cleanup", payload: { keys: [key], prefixes: [] } }));
  });

  it.each([
    { kind: "reply", mode: "error" }, { kind: "reply", mode: "throw" }, { kind: "reply", mode: "missing" },
    { kind: "request", mode: "error" }, { kind: "request", mode: "throw" }, { kind: "request", mode: "missing" },
  ] as const)("keeps bytes after a committed $kind INSERT's ambiguous $mode and recovers without restaging", async ({ kind, mode }) => {
    if (kind === "request") memory.tables.intake_channel_links = [];
    await expect(recordMail(ambiguousInsert(mode), settings(), mail())).rejects.toBeTruthy();
    expect(inbound()).toHaveLength(1);
    expect(storage.get(attachmentKey())).toEqual(bytes);
    expect(mocks.deleteFileBestEffort).not.toHaveBeenCalled();
    await expect(recordMail(memory.db, settings(), mail())).resolves.toBe("duplicate");
    expect(attachmentRead).toHaveBeenCalledTimes(1);
    if (kind === "reply") await importReply();
  });

  it.each(["reply", "request"] as const)("recognizes its own committed %s payload if an INSERT replay reports a duplicate", async (kind) => {
    if (kind === "request") memory.tables.intake_channel_links = [];
    await expect(recordMail(ambiguousInsert("duplicate"), settings(), mail())).resolves.toBe("received");
    expect(inbound()).toHaveLength(1);
    expect(storage.get(attachmentKey())).toEqual(bytes);
    expect(mocks.deleteFileBestEffort).not.toHaveBeenCalled();
    if (kind === "reply") await importReply();
  });

  it.each(["reply", "request"] as const)("cleans only a duplicate %s loser's bytes even if requeue fails", async (kind) => {
    if (kind === "request") memory.tables.intake_channel_links = [];
    const winnerKey = `intake-inbound/${org}/winner/0`;
    storage.set(winnerKey, bytes);
    memory.intercept = ({ table, op, values }) => {
      if (table === "intake_inbound" && op === "insert" && !inbound().length)
        inbound().push({ ...(values as object), id: "winner", kind, status: "pending", payload: { attachments: [{ key: winnerKey }] } });
      return undefined;
    };
    mocks.enqueueDbJob.mockRejectedValueOnce(new Error("Queue unavailable"));
    await expect(recordMail(memory.db, settings(), mail())).rejects.toBeTruthy();
    expect(inbound()).toHaveLength(1);
    expect(storage).toEqual(new Map([[winnerKey, bytes]]));
    expect(mocks.deleteFileBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFileBestEffort).not.toHaveBeenCalledWith(winnerKey, expect.anything());
  });

  it.each(["reply", "request"] as const)("cleans definitively rejected %s INSERT bytes", async (kind) => {
    if (kind === "request") memory.tables.intake_channel_links = [];
    memory.intercept = ({ table, op }) => table === "intake_inbound" && op === "insert" ? { code: "23503", message: "synthetic missing parent" } : undefined;
    await expect(recordMail(memory.db, settings(), mail())).rejects.toBeTruthy();
    expect(inbound()).toEqual([]);
    expect(storage.size).toBe(0);
    expect(mocks.deleteFileBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueDbJob).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "reply", code: "08006" }, { kind: "request", code: "08006" },
    { kind: "reply", code: "40003" }, { kind: "request", code: "40003" },
  ] as const)("retains staged $kind bytes when INSERT error $code cannot prove rollback", async ({ kind, code }) => {
    if (kind === "request") memory.tables.intake_channel_links = [];
    memory.intercept = ({ table, op }) => table === "intake_inbound" && op === "insert" ? { code, message: "INSERT outcome uncertain" } : undefined;
    await expect(recordMail(memory.db, settings(), mail())).rejects.toBeTruthy();
    expect(inbound()).toEqual([]);
    expect(storage.size).toBe(1);
    expect(mocks.deleteFileBestEffort).not.toHaveBeenCalled();
  });
});
