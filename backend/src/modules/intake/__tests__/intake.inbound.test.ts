import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "./memoryDb";

const mocks = vi.hoisted(() => ({
  memory: null as unknown as { db: unknown },
  uploadFile: vi.fn(),
  deleteFileBestEffort: vi.fn(),
  enqueueDbJob: vi.fn(),
}));
vi.mock("../../../lib/supabase", () => ({
  createServerSupabase: () => mocks.memory.db,
}));
vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  uploadFile: mocks.uploadFile,
  deleteFileBestEffort: mocks.deleteFileBestEffort,
}));
vi.mock("../../../lib/dbq/enqueue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/dbq/enqueue")>()),
  enqueueDbJob: mocks.enqueueDbJob,
}));
// Small limits, so a test can exceed them without megabytes of base64.
vi.mock("../intake.inboundPayload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../intake.inboundPayload")>()),
  MAX_ATTACHMENT_BYTES: 64,
}));
vi.mock("../../user/user.service", () => ({
  getEffectiveApiKeys: vi.fn(),
  envApiKeys: vi.fn(() => ({})),
}));
import { encryptString } from "../../../lib/mcp/client";
import { htmlToText } from "../intake.inbound";
import { intakeWebhooksRouter } from "../intake.webhooks.routes";

const org = "00000000-0000-4000-8000-000000000001";
const webhookId = "00000000-0000-4000-8000-0000000000aa";
const secret = "slack-signing-secret";
const env = { ...process.env };
let memory: MemoryDb;
const app = express();
app.use("/webhooks/intake", intakeWebhooksRouter);
const inbound = () => memory.rows("intake_inbound");

function settings(overrides: Record<string, unknown> = {}) {
  const sealed = encryptString(secret);
  return {
    org_id: org,
    slack_webhook_id: webhookId,
    slack_enabled: true,
    slack_bot_user_id: "UBOT",
    slack_signing_secret_encrypted: sealed.encrypted,
    slack_signing_secret_iv: sealed.iv,
    slack_signing_secret_tag: sealed.tag,
    email_enabled: true,
    email_allowed_domains: ["acme.test"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-encryption-secret-for-intake";
  memory = memoryDb({ intake_automation: [settings()] });
  mocks.memory = memory;
  mocks.enqueueDbJob.mockResolvedValue({ id: "job-1", deduped: false });
  mocks.uploadFile.mockResolvedValue(undefined);
});
afterAll(() => {
  process.env = env;
});

function slack(body: unknown, options: { secret?: string; ts?: number; raw?: string } = {}) {
  const raw = options.raw ?? JSON.stringify(body);
  const ts = String(options.ts ?? Math.floor(Date.now() / 1000));
  const signature =
    "v0=" +
    createHmac("sha256", options.secret ?? secret)
      .update(`v0:${ts}:${raw}`)
      .digest("hex");
  return request(app)
    .post(`/webhooks/intake/slack/${webhookId}`)
    .set("Content-Type", "application/json")
    .set("X-Slack-Request-Timestamp", ts)
    .set("X-Slack-Signature", signature)
    .send(raw);
}
const mention = (event: Record<string, unknown> = {}) => ({
  type: "event_callback",
  team_id: "T1",
  event: {
    type: "app_mention",
    user: "U123",
    text: "<@UBOT> please review the NDA",
    ts: "1762074840.000100",
    channel: "C42",
    ...event,
  },
});

describe("Slack events", () => {
  it("answers Slack's URL check once a signing secret is saved, before Slack is on", async () => {
    memory = memoryDb({ intake_automation: [settings({ slack_enabled: false })] });
    mocks.memory = memory;
    const res = await slack({ type: "url_verification", challenge: "3eZbrw1aBm" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: "3eZbrw1aBm" });
  });
  it("refuses unsigned, mis-signed, stale and altered requests", async () => {
    const body = mention();
    expect((await slack(body, { secret: "wrong" })).status).toBe(403);
    expect((await slack(body, { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(403);
    const signed = slack(body);
    // The same signature over a different body.
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const signature =
      "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
    const tampered = await request(app)
      .post(`/webhooks/intake/slack/${webhookId}`)
      .set("Content-Type", "application/json")
      .set("X-Slack-Request-Timestamp", ts)
      .set("X-Slack-Signature", signature)
      .send(raw.replace("review", "delete"));
    expect(tampered.status).toBe(403);
    expect(
      (await request(app).post(`/webhooks/intake/slack/${webhookId}`).send(raw)).status,
    ).toBe(403);
    expect((await signed).status).toBe(200);
    expect(inbound()).toHaveLength(1);
  });
  it("doesn't know an unknown URL or one without a signing secret", async () => {
    expect(
      (await request(app).post("/webhooks/intake/slack/not-a-uuid").send("{}")).status,
    ).toBe(404);
    memory = memoryDb({
      intake_automation: [settings({ slack_signing_secret_encrypted: null })],
    });
    mocks.memory = memory;
    expect((await slack({ type: "url_verification", challenge: "x" })).status).toBe(404);
  });
  it("stores a mention once and queues it, however often Slack delivers it", async () => {
    const res = await slack(mention({ files: [{ id: "F1", name: "nda.docx", size: 10, url_private_download: "https://files.slack.com/nda.docx" }] }));
    expect(res.status).toBe(200);
    expect(inbound()).toEqual([
      expect.objectContaining({
        org_id: org,
        source: "slack",
        external_id: "C42:1762074840.000100",
        status: "pending",
        payload: {
          kind: "slack",
          team_id: "T1",
          channel: "C42",
          ts: "1762074840.000100",
          thread_ts: null,
          user: "U123",
          text: "<@UBOT> please review the NDA",
          files: [{ id: "F1", name: "nda.docx", size: 10, url: "https://files.slack.com/nda.docx" }],
        },
      }),
    ]);
    const id = inbound()[0]!.id as string;
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, {
      kind: "intake.agent",
      payload: { inboundId: id, orgId: org },
      dedupeKey: `intake.agent:${id}`,
      maxAttempts: 4,
    });
    // Slack retries: nothing new is stored; a waiting message is queued again
    // (the queue drops it while one job is live).
    expect((await slack(mention())).status).toBe(200);
    expect(inbound()).toHaveLength(1);
    expect(mocks.enqueueDbJob).toHaveBeenCalledTimes(2);
    inbound()[0]!.status = "done";
    expect((await slack(mention())).status).toBe(200);
    expect(mocks.enqueueDbJob).toHaveBeenCalledTimes(2);
  });
  it("keeps the thread a mention was posted in", async () => {
    await slack(mention({ thread_ts: "1762074000.000001" }));
    expect(inbound()[0]!.payload).toMatchObject({ thread_ts: "1762074000.000001" });
  });
  const request21 = "00000000-0000-4000-8000-000000000021";
  const linkThread = () =>
    memory.rows("intake_channel_links").push({
      id: "link-1",
      org_id: org,
      request_id: request21,
      source: "slack",
      thread_key: "T1:C42:1762074000.000001",
      address: { channel: "C42", thread_ts: "1762074000.000001" },
    });
  const threadMessage = (event: Record<string, unknown> = {}) => ({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      user: "U9",
      text: "Acme is a customer.",
      ts: "1762074900.000200",
      thread_ts: "1762074000.000001",
      channel: "C42",
      ...event,
    },
  });
  it("records any person's message in a request's thread as its reply, once", async () => {
    linkThread();
    expect((await slack(threadMessage())).status).toBe(200);
    // A mention in the same thread fires app_mention too: the same message.
    expect((await slack(threadMessage({ type: "app_mention", text: "<@UBOT> Acme is a customer." }))).status).toBe(200);
    expect(inbound()).toEqual([
      expect.objectContaining({
        kind: "reply",
        source: "slack",
        external_id: "C42:1762074900.000200",
        request_id: request21,
        status: "pending",
        payload: {
          kind: "slack_reply",
          channel: "C42",
          ts: "1762074900.000200",
          thread_ts: "1762074000.000001",
          user: "U9",
        },
      }),
    ]);
    const id = inbound()[0]!.id as string;
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, {
      kind: "intake.agent",
      payload: { inboundId: id, orgId: org },
      dedupeKey: `intake.agent:${id}`,
      maxAttempts: 4,
    });
    // Settings learn that message events arrive.
    expect(memory.rows("intake_automation")[0]!.slack_messages_seen_at).toBeTruthy();
    // A file shared in the thread is a reply too.
    await slack(threadMessage({ ts: "1762074901.000300", subtype: "file_share" }));
    expect(inbound()).toHaveLength(2);
  });
  it("takes a reply without a mention in a thread where MikeGC chatted back, as a new message", async () => {
    memory.rows("intake_conversations").push({
      org_id: org,
      source: "slack",
      thread_key: "T1:C42:1762074000.000001",
      rounds: 1,
    });
    expect((await slack(threadMessage({ text: "can you review our NDA?" }))).status).toBe(200);
    // Its mention twin, if it had one, is the same message.
    expect((await slack(threadMessage({ type: "app_mention", text: "can you review our NDA?" }))).status).toBe(200);
    expect(inbound()).toEqual([
      expect.objectContaining({
        kind: "request",
        source: "slack",
        external_id: "C42:1762074900.000200",
        payload: expect.objectContaining({
          kind: "slack",
          thread_ts: "1762074000.000001",
          text: "can you review our NDA?",
        }),
      }),
    ]);
    // Another thread, where MikeGC never answered, still needs a mention.
    await slack(threadMessage({ ts: "1762074999.000500", thread_ts: "1762070000.000009" }));
    expect(inbound()).toHaveLength(1);
  });
  it("drops chatter, edits and top-level messages without storing them", async () => {
    linkThread();
    for (const body of [
      // A thread no request is linked to.
      threadMessage({ thread_ts: "1762070000.000009" }),
      // A top-level message, a thread's own root, an edit and a deletion.
      threadMessage({ thread_ts: undefined }),
      threadMessage({ ts: "1762074000.000001" }),
      threadMessage({ subtype: "message_changed" }),
      threadMessage({ subtype: "message_deleted" }),
      // MikeGC's own post and another bot's.
      threadMessage({ user: "UBOT" }),
      threadMessage({ bot_id: "B1" }),
    ])
      expect((await slack(body)).status).toBe(200);
    expect(inbound()).toEqual([]);
    expect(mocks.enqueueDbJob).not.toHaveBeenCalled();
  });
  it("ignores bots, MikeGC itself, other events and a turned-off Slack", async () => {
    for (const body of [
      mention({ bot_id: "B1" }),
      mention({ user: "UBOT" }),
      mention({ subtype: "bot_message" }),
      { type: "event_callback", event: { type: "message", user: "U1", ts: "1.1", channel: "C1" } },
    ])
      expect((await slack(body)).status).toBe(200);
    memory.rows("intake_automation")[0]!.slack_enabled = false;
    expect((await slack(mention())).status).toBe(200);
    expect(inbound()).toEqual([]);
    expect(mocks.enqueueDbJob).not.toHaveBeenCalled();
  });
  it("asks Slack to retry when the message can't be queued", async () => {
    mocks.enqueueDbJob.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await slack(mention())).status).toBe(500);
    expect((await slack(mention())).status).toBe(200);
    expect(inbound()).toHaveLength(1);
    expect(mocks.enqueueDbJob).toHaveBeenCalledTimes(2);
  });
});

describe("htmlToText", () => {
  it("reads an HTML email as text, leaving no markup even when tags are nested", () => {
    expect(
      htmlToText("<head><title>x</title></head><p>Hi &amp; thanks</p><ul><li>One</li></ul>"),
    ).toBe("Hi & thanks\n- One");
    expect(htmlToText("A<script>alert(1)</script><STYLE>p{}</STYLE>B<br/>C<p unclosed")).toBe(
      "AB\nC",
    );
    for (const nested of ["<scr<b>ipt>alert(1)</scr</b>ipt>", "<<b>p>text", "<<<a>>b>c"])
      expect(htmlToText(nested)).not.toMatch(/</);
  });
});
