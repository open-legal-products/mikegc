import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, requesterLoopRpc, type MemoryDb } from "./memoryDb";

const mocks = vi.hoisted(() => ({ downloadFile: vi.fn(), enqueueDbJob: vi.fn() }));
vi.mock("../../../lib/dbq/enqueue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/dbq/enqueue")>()),
  enqueueDbJob: mocks.enqueueDbJob,
}));
vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  downloadFile: mocks.downloadFile,
}));
import { NonRetryableJobError } from "../../../lib/dbq/runner";
import type { DbJob } from "../../../lib/dbq/types";
import { encryptString } from "../../../lib/mcp/client";
import {
  dispatchIntakeDeliverOrFail,
  handleIntakeDeliver,
  markIntakeDeliverFailed,
  requeueStalledIntakeDeliveries,
} from "../intake.deliver";

const org = "00000000-0000-4000-8000-000000000001";
const emma = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-0000000000a1";
const outboundId = "00000000-0000-4000-8000-0000000000f1";
const messageId = "00000000-0000-4000-8000-0000000000f2";
const env = { ...process.env };
let memory: MemoryDb;
let slackCalls: { method: string; params: Record<string, string> }[];
let uploads: string[];

const job = (attempts = 1): DbJob => ({
  id: "job-1",
  kind: "intake.deliver",
  payload: { orgId: org, outboundId },
  status: "running",
  attempts,
  max_attempts: 5,
  run_at: "",
  claimed_at: "",
  finished_at: null,
  last_error: null,
  dedupe_key: `intake.deliver:${outboundId}`,
  result: null,
  created_at: "",
});
const outbox = () => memory.rows("intake_outbound")[0]!;

function setup(options: { scopes?: string[] | null; kind?: string; documents?: number } = {}) {
  const token = encryptString("xoxb-bot-token");
  memory = memoryDb(
    {
      organizations: [{ id: org, kind: "team" }],
      user_profiles: [{ user_id: emma, display_name: "Emma Chen", email: "emma@firm.test" }],
      intake_automation: [
        {
          org_id: org,
          slack_enabled: true,
          slack_bot_user_id: "UBOT",
          slack_bot_token_encrypted: token.encrypted,
          slack_bot_token_iv: token.iv,
          slack_bot_token_tag: token.tag,
          slack_scopes: options.scopes === undefined ? ["chat:write", "chat:write.customize", "files:write"] : options.scopes,
        },
      ],
      intake_requests: [{ id: requestId, org_id: org, subject: "Review the Acme NDA", assignee_id: emma }],
      intake_channel_links: [
        {
          id: "link-1",
          org_id: org,
          request_id: requestId,
          source: "slack",
          thread_key: "T1:C42:1.1",
          address: { channel: "C42", thread_ts: "1793610840.000100", channel_name: "legal-requests" },
        },
      ],
      intake_messages: [{ id: messageId, org_id: org, request_id: requestId, kind: "resolution", body: "Approved with edits." }],
      document_versions: Array.from({ length: options.documents ?? 2 }, (_, i) => ({
        id: `v${i}`,
        filename: `doc-${i}.docx`,
        file_type: "docx",
        size_bytes: 3,
        storage_path: `documents/intake-${org}/d${i}/source.docx`,
        deleted_at: null,
      })),
      intake_outbound: [
        {
          id: outboundId,
          org_id: org,
          request_id: requestId,
          link_id: "link-1",
          message_id: messageId,
          author_id: emma,
          kind: options.kind ?? "answer",
          documents: Array.from({ length: options.documents ?? 2 }, (_, i) => ({ document_id: `d${i}`, version_id: `v${i}` })),
          status: "pending",
          external_id: null,
          attempted_at: null,
        },
      ],
    },
    requesterLoopRpc(),
  );
}

function stubSlack(overrides: Record<string, (p: Record<string, string>) => unknown> = {}) {
  slackCalls = [];
  uploads = [];
  let file = 0;
  const methods: Record<string, (p: Record<string, string>) => unknown> = {
    "chat.postMessage": () => ({ ok: true, ts: "1793611111.000100" }),
    "files.getUploadURLExternal": () => ({ ok: true, upload_url: `https://files.slack.com/upload/v1/${++file}`, file_id: `F${file}` }),
    "files.completeUploadExternal": () => ({ ok: true }),
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith("https://files.slack.com/upload/")) {
        uploads.push(target);
        return new Response("OK");
      }
      const method = target.replace("https://slack.com/api/", "");
      const params = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
      slackCalls.push({ method, params });
      return Response.json(methods[method]?.(params) ?? { ok: false, error: "unknown_method" });
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-encryption-secret-for-intake";
  mocks.downloadFile.mockResolvedValue(new Uint8Array([80, 75, 3]).buffer);
  stubSlack();
});
afterAll(() => {
  process.env = env;
  vi.unstubAllGlobals();
});

describe("sending a message to the requester", () => {
  it("posts a lawyer's resolution under their name, then each document in the thread", async () => {
    setup();
    await expect(handleIntakeDeliver(memory.db, job())).resolves.toEqual({ outbound_id: outboundId, sent: true });
    const post = slackCalls.find((c) => c.method === "chat.postMessage")!.params;
    expect(post).toMatchObject({
      channel: "C42",
      thread_ts: "1793610840.000100",
      text: "Approved with edits.",
      username: "Emma Chen (Legal)",
      unfurl_links: "false",
    });
    const completes = slackCalls.filter((c) => c.method === "files.completeUploadExternal");
    expect(completes.map((c) => JSON.parse(c.params.files!))).toEqual([
      [{ id: "F1", title: "doc-0.docx" }],
      [{ id: "F2", title: "doc-1.docx" }],
    ]);
    expect(completes[0]!.params).toMatchObject({ channel_id: "C42", thread_ts: "1793610840.000100" });
    expect(uploads).toHaveLength(2);
    // The current version of each document, from its storage.
    expect(mocks.downloadFile).toHaveBeenCalledWith(`documents/intake-${org}/d0/source.docx`);
    expect(outbox()).toMatchObject({
      status: "sent",
      external_id: "1793611111.000100",
      documents: [
        { document_id: "d0", version_id: "v0", external_id: "F1" },
        { document_id: "d1", version_id: "v1", external_id: "F2" },
      ],
    });
  });
  it("uploads only what's left on a retry, without posting the text again", async () => {
    setup();
    stubSlack({
      "files.completeUploadExternal": (p) =>
        JSON.parse(p.files!)[0].id === "F2" ? { ok: false, error: "ratelimited" } : { ok: true },
    });
    await expect(handleIntakeDeliver(memory.db, job())).rejects.toBeTruthy();
    expect(outbox()).toMatchObject({
      status: "pending",
      external_id: "1793611111.000100",
      documents: [{ document_id: "d0", external_id: "F1" }, { document_id: "d1", version_id: "v1" }],
    });
    stubSlack();
    await handleIntakeDeliver(memory.db, job(2));
    expect(slackCalls.some((c) => c.method === "chat.postMessage")).toBe(false);
    expect(slackCalls.filter((c) => c.method === "files.completeUploadExternal")).toHaveLength(1);
    expect(outbox()).toMatchObject({ status: "sent" });
  });
  it("posts the text alone, and says so, when the Slack app can't send files", async () => {
    setup({ scopes: ["chat:write", "chat:write.customize"] });
    await handleIntakeDeliver(memory.db, job());
    expect(slackCalls.some((c) => c.method === "files.getUploadURLExternal")).toBe(false);
    expect(outbox()).toMatchObject({
      status: "sent",
      documents: [
        { document_id: "d0", left_out: true },
        { document_id: "d1", left_out: true },
      ],
    });
  });
  it("signs a member's question itself when Slack can't post under their name", async () => {
    setup({ scopes: ["chat:write", "files:write"], kind: "question", documents: 0 });
    memory.rows("intake_messages")[0]!.body = "Which entity is <signing>?";
    await handleIntakeDeliver(memory.db, job());
    const post = slackCalls.find((c) => c.method === "chat.postMessage")!.params;
    expect(post.username).toBeUndefined();
    expect(post.text).toBe("Emma Chen (Legal) asks:\nWhich entity is &lt;signing&gt;?");
  });
  it("records a permanent failure with a sentence members can act on, and stops", async () => {
    setup();
    stubSlack({ "chat.postMessage": () => ({ ok: false, error: "not_in_channel" }) });
    await expect(handleIntakeDeliver(memory.db, job())).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(outbox()).toMatchObject({
      status: "failed",
      error: "Couldn't send: MikeGC was removed from #legal-requests.",
    });
    // Not pending any more: a duplicate job does nothing.
    await expect(handleIntakeDeliver(memory.db, job())).resolves.toEqual({ skipped: "failed" });
  });
  it("retries a transient failure, then says so when the attempts run out", async () => {
    setup();
    stubSlack({ "chat.postMessage": () => ({ ok: false, error: "internal_error" }) });
    await expect(handleIntakeDeliver(memory.db, job())).rejects.not.toBeInstanceOf(NonRetryableJobError);
    expect(outbox()).toMatchObject({ status: "pending" });
    await markIntakeDeliverFailed(memory.db, job(5));
    expect(outbox()).toMatchObject({ status: "failed", error: "MikeGC couldn't reach Slack. Try again." });
  });
  it("marks a message it couldn't queue as failed, so the request offers Retry", async () => {
    setup();
    process.env.DB_JOBS_ENABLED = "true";
    mocks.enqueueDbJob.mockRejectedValueOnce(new Error("connection reset"));
    await expect(dispatchIntakeDeliverOrFail(memory.db, org, outboundId)).rejects.toThrow("connection reset");
    expect(outbox()).toMatchObject({ status: "failed", error: "MikeGC couldn't queue this message. Try again." });
    // Queued, it is left as it is.
    mocks.enqueueDbJob.mockResolvedValueOnce({ id: "job-2", deduped: false });
    memory.rows("intake_outbound")[0]!.status = "pending";
    await dispatchIntakeDeliverOrFail(memory.db, org, outboundId);
    expect(outbox()).toMatchObject({ status: "pending" });
    expect(mocks.enqueueDbJob).toHaveBeenLastCalledWith(
      memory.db,
      expect.objectContaining({ kind: "intake.deliver", dedupeKey: `intake.deliver:${outboundId}` }),
    );
  });
  it("leaves a message it couldn't queue or mark failed for the stale-work sweep", async () => {
    setup();
    process.env.DB_JOBS_ENABLED = "true";
    mocks.enqueueDbJob.mockRejectedValueOnce(new Error("connection reset"));
    const rpc = vi
      .spyOn(memory.db, "rpc")
      .mockResolvedValueOnce({ data: null, error: { code: "08006", message: "connection lost" } } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(dispatchIntakeDeliverOrFail(memory.db, org, outboundId)).rejects.toThrow("connection reset");
    expect(rpc).toHaveBeenCalledWith("intake_record_delivery", expect.objectContaining({ p_status: "failed" }));
    rpc.mockRestore();
    // The mark's failure is said, not swallowed, and the row stays pending.
    expect(warn).toHaveBeenCalledWith("[intake-deliver] unqueued message not marked failed", expect.anything());
    warn.mockRestore();
    expect(outbox()).toMatchObject({ status: "pending" });
  });
  it("queues again messages left pending without a job, and only those", async () => {
    setup();
    process.env.DB_JOBS_ENABLED = "true";
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    outbox().created_at = old;
    memory.rows("intake_outbound").push(
      { ...outbox(), id: "recent", created_at: new Date().toISOString() },
      { ...outbox(), id: "sent", status: "sent", created_at: old },
    );
    mocks.enqueueDbJob.mockResolvedValue({ id: "job-3", deduped: false });
    expect(await requeueStalledIntakeDeliveries(memory.db)).toBe(1);
    expect(mocks.enqueueDbJob).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(
      memory.db,
      expect.objectContaining({ kind: "intake.deliver", dedupeKey: `intake.deliver:${outboundId}` }),
    );
    // Without the job queue a delivery may be running inline, so none is started.
    process.env.DB_JOBS_ENABLED = "false";
    expect(await requeueStalledIntakeDeliveries(memory.db)).toBe(0);
  });
  it("queues at most a hundred stalled messages a sweep, and the rest on the next", async () => {
    setup();
    process.env.DB_JOBS_ENABLED = "true";
    const old = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    memory.tables.intake_outbound = Array.from({ length: 101 }, (_, i) => ({
      ...outbox(),
      id: `stalled-${String(i).padStart(3, "0")}`,
      created_at: old(200 - i),
    }));
    mocks.enqueueDbJob.mockResolvedValue({ id: "job", deduped: false });
    expect(await requeueStalledIntakeDeliveries(memory.db)).toBe(100);
    expect(mocks.enqueueDbJob).toHaveBeenCalledTimes(100);
    // The oldest go first; once they're sent, the last one is queued.
    for (const row of memory.rows("intake_outbound").slice(0, 100)) row.status = "sent";
    mocks.enqueueDbJob.mockClear();
    expect(await requeueStalledIntakeDeliveries(memory.db)).toBe(1);
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(
      memory.db,
      expect.objectContaining({ dedupeKey: "intake.deliver:stalled-100" }),
    );
  });
  it("posts nothing on a retry it can't tell landed, and says to check the thread", async () => {
    setup();
    memory.rows("intake_outbound")[0]!.attempted_at = new Date(Date.now() - 60_000).toISOString();
    // A thread longer than the five pages a retry reads, without the message.
    stubSlack({
      "conversations.replies": () => ({
        ok: true,
        messages: [{ ts: "1.0", text: "unrelated" }],
        response_metadata: { next_cursor: "more" },
      }),
    });
    await expect(handleIntakeDeliver(memory.db, job(2))).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(slackCalls.filter((c) => c.method === "conversations.replies")).toHaveLength(5);
    expect(slackCalls.some((c) => c.method === "chat.postMessage")).toBe(false);
    expect(outbox()).toMatchObject({
      status: "failed",
      error: expect.stringContaining("MikeGC couldn't tell whether this reached the Slack thread."),
    });
  });
  it("sends nothing once Slack is switched off", async () => {
    setup();
    memory.rows("intake_automation")[0]!.slack_enabled = false;
    await expect(handleIntakeDeliver(memory.db, job())).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(slackCalls).toEqual([]);
    expect(outbox().error).toMatch(/Slack is turned off/);
  });
});

it("a deleted organization cannot send a queued message or attachments",async()=>{
 setup();
 memory.rows("organizations")[0]!.deleted_at="2026-11-12T00:00:00Z";
 await handleIntakeDeliver(memory.db,job());
 expect(slackCalls).toHaveLength(0);
 expect(mocks.downloadFile).not.toHaveBeenCalled();
});

it("stops attachments if the organization is deleted after the message lands", async () => {
  setup();
  stubSlack({ "chat.postMessage": () => {
    memory.rows("organizations")[0]!.deleted_at = new Date().toISOString();
    return { ok: true, ts: "1793611111.000100" };
  } });
  await expect(handleIntakeDeliver(memory.db, job())).rejects.toBeInstanceOf(NonRetryableJobError);
  expect(slackCalls.filter(c => c.method === "files.getUploadURLExternal")).toHaveLength(0);
  expect(uploads).toHaveLength(0);
});

it("does not revive a delivery cancelled by deletion even if the workspace is restored", async () => {
  setup();
  stubSlack({ "chat.postMessage": () => {
    // Deletion's trigger cancels the outbox; restoration leaves it cancelled.
    outbox().status = "failed";
    return { ok: true, ts: "1793611111.000100" };
  } });
  await expect(handleIntakeDeliver(memory.db, job())).rejects.toBeInstanceOf(NonRetryableJobError);
  expect(outbox().status).toBe("failed");
  expect(uploads).toHaveLength(0);
});
