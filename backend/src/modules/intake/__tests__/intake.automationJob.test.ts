import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { automatedIntakeRpc, memoryDb, type MemoryDb } from "./memoryDb";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  getEffectiveApiKeys: vi.fn(),
  envApiKeys: vi.fn(),
  createDocumentVersion: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFileBestEffort: vi.fn(),
  enqueueDbJob: vi.fn(),
  deleteFile: vi.fn(),
  enqueueConversion: vi.fn(),
  gmailDeliver: vi.fn(),
  teamsDeliver: vi.fn(),
  outlookDeliver: vi.fn(),
}));
vi.mock("../../../lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/llm")>()),
  streamChatWithTools: mocks.stream,
}));
vi.mock("../../../lib/providerCredentials/index", () => ({
  getEffectiveApiKeys: mocks.getEffectiveApiKeys,
  envApiKeys: mocks.envApiKeys,
}));
vi.mock("../../documents/documents.service", () => ({
  createDocumentVersion: mocks.createDocumentVersion,
}));
vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  uploadFile: mocks.uploadFile,
  downloadFile: mocks.downloadFile,
  deleteFileBestEffort: mocks.deleteFileBestEffort,
  deleteFile: mocks.deleteFile,
}));
vi.mock("../../../lib/dbq/enqueue", () => ({
  enqueueDbJob: mocks.enqueueDbJob,
}));
vi.mock("../../../lib/queue/conversionQueue", () => ({
  enqueueConversion: mocks.enqueueConversion,
}));
// Gmail itself is tested in intake.gmailChatReply.test.ts; here, what it is asked to send.
vi.mock("../intake.gmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../intake.gmail")>();
  return { ...actual, gmailAdapter: { ...actual.gmailAdapter, deliver: mocks.gmailDeliver } };
});
vi.mock("../intake.teams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../intake.teams")>();
  return { ...actual, teamsAdapter: { ...actual.teamsAdapter, deliver: mocks.teamsDeliver } };
});
vi.mock("../intake.outlook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../intake.outlook")>();
  return { ...actual, outlookAdapter: { ...actual.outlookAdapter, deliver: mocks.outlookDeliver } };
});
import { NonRetryableJobError } from "../../../lib/dbq/runner";
import { recordCall, replyCall, ruleCall, scripted, type ScriptedCall } from "./agentScript";
import type { DbJob } from "../../../lib/dbq/types";
import { encryptString } from "../../../lib/mcp/client";
import {
  dispatchIntakeAgent,
  handleIntakeAgent,
  markIntakeAgentFailed,
} from "../intake.agentJob";
import { handleIntakeDeliver } from "../intake.deliver";
import { purgeIntake } from "../intake.lifecycle";

const org = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const sam = "00000000-0000-4000-8000-000000000003";
const pat = "00000000-0000-4000-8000-000000000004";
const outsider = "00000000-0000-4000-8000-000000000009";
const inboundId = "00000000-0000-4000-8000-0000000000e1";
const env = { ...process.env };
let memory: MemoryDb;
let slackCalls: { method: string; params: Record<string, string> }[];
let slackReplies: Record<string, unknown>;
let model: ReturnType<typeof scripted>;
/** The model makes these tool calls, one list per step. */
function modelCalls(...steps: ScriptedCall[][]) {
  model = scripted(steps);
  mocks.stream.mockImplementation(model.stream);
}

const job = (): DbJob => ({
  id: "job-1",
  kind: "intake.agent",
  payload: { inboundId, orgId: org },
  status: "running",
  attempts: 1,
  max_attempts: 4,
  run_at: "",
  claimed_at: "",
  finished_at: null,
  last_error: null,
  dedupe_key: `intake.agent:${inboundId}`,
  result: null,
  created_at: "",
});
const row = () => memory.rows("intake_inbound")[0]!;
/** A new email to a Gmail intake mailbox, from an accepted sender. */
const gmailPayload = () => ({
  kind: "mail",
  provider: "gmail",
  mailbox: "intake@firm.test",
  provider_id: "gm-9",
  message_id: "<hello@firm.test>",
  thread: "t-9",
  from: { name: "Pat", email: "pat@firm.test" },
  to: ["intake@firm.test"],
  cc: [],
  subject: "How are you",
  date: "2026-11-02T09:14:00.000Z",
  text: "How are you?",
  attachments: [],
  skipped: [],
});
/** A new email to a Gmail intake mailbox, with attachments. */
const emailPayload = () => ({
  kind: "mail",
  provider: "gmail",
  mailbox: "intake@firm.test",
  provider_id: "gm-1",
  message_id: "<nda@acme.test>",
  thread: "t-1",
  from: { name: "Jane Business", email: "jane@acme.test" },
  to: ["intake@firm.test"],
  cc: [],
  subject: "NDA with Supplier Co",
  date: "2026-11-02T09:14:00.000Z",
  text: "Please review the attached NDA by Friday.",
  attachments: [
    { name: "nda.docx", file_type: "docx", size: 4, key: `intake-inbound/${org}/${inboundId}/0` },
    { name: "logo.pdf", file_type: "pdf", size: 4, key: `intake-inbound/${org}/${inboundId}/1` },
  ],
  skipped: [{ name: "photo.png", reason: "type" }],
});
const slackPayload = (overrides: Record<string, unknown> = {}) => ({
  kind: "slack",
  channel: "C42",
  ts: "1793610900.000300",
  thread_ts: "1793610840.000100",
  user: "U2",
  text: "<@UBOT> can Legal look at this?",
  files: [],
  ...overrides,
});

function setup(options: {
  payload: Record<string, unknown>;
  source?: "slack" | "gmail";
  /** False when no model key is available, so triage can't run. */
  model?: boolean;
  kind?: "team" | "personal";
}) {
  if (options.model === false) mocks.getEffectiveApiKeys.mockResolvedValue({});
  const token = encryptString("xoxb-bot-token");
  memory = memoryDb(
    {
      organizations: [{ id: org, kind: options.kind ?? "team" }],
      org_members: [
        { org_id: org, user_id: owner, role: "owner" },
        { org_id: org, user_id: sam, role: "member" },
        { org_id: org, user_id: pat, role: "member" },
      ],
      user_profiles: [
        { user_id: owner, display_name: "Olive Owner", email: "olive@firm.test", account_deletion_requested_at: null },
        { user_id: sam, display_name: "Sam Lawyer", email: "sam@firm.test", account_deletion_requested_at: null },
        { user_id: pat, display_name: "Pat Counsel", email: "pat@firm.test", account_deletion_requested_at: null },
      ],
      intake_assignment_rules: [
        { id: "r1", org_id: org, position: 0, condition: "The request is about an NDA", assignee_id: sam },
      ],
      intake_automation: [
        {
          org_id: org,
          email_enabled: true,
          slack_enabled: true,
          slack_bot_user_id: "UBOT",
          slack_bot_token_encrypted: token.encrypted,
          slack_bot_token_iv: token.iv,
          slack_bot_token_tag: token.tag,
          triage_model: "claude-haiku-4-5",
          configured_by: owner,
        },
      ],
      intake_inbound: [
        {
          id: inboundId,
          org_id: org,
          source: options.source ?? "gmail",
          external_id: "message-1",
          payload: options.payload,
        },
      ],
      intake_requests: [],
      documents: [],
      intake_request_documents: [],
    },
    automatedIntakeRpc,
  );
}

function stubSlack(overrides: Record<string, (params: Record<string, string>) => unknown> = {}) {
  slackCalls = [];
  slackReplies = {};
  const people: Record<string, unknown> = {
    U1: { real_name: "Jane Business", profile: { real_name: "Jane Business", email: "jane@acme.test" } },
    U2: { real_name: "Ravi Sales", profile: { real_name: "Ravi Sales", email: "ravi@acme.test" } },
  };
  const methods: Record<string, (params: Record<string, string>) => unknown> = {
    "users.info": (p) =>
      people[p.user!] ? { ok: true, user: people[p.user!] } : { ok: false, error: "user_not_found" },
    "conversations.replies": () => ({
      ok: true,
      messages: [
        {
          ts: "1793610840.000100",
          user: "U1",
          text: "Need the Supplier Co NDA signed off\nThey want it back by Friday.",
          files: [
            { id: "F1", name: "Supplier NDA.pdf", size: 4, url_private_download: "https://files.slack.com/F1/nda.pdf" },
            { id: "F2", name: "notes.txt", size: 4, url_private_download: "https://files.slack.com/F2/notes.txt" },
          ],
        },
        { ts: "1793610860.000200", user: "UBOT", text: "an earlier MikeGC reply" },
        { ts: "1793610900.000300", user: "U2", text: "<@UBOT> can Legal look at this?" },
      ],
    }),
    "chat.postMessage": (p) => {
      slackReplies = p;
      return { ok: true, ts: "1793610999.000900" };
    },
    "chat.getPermalink": () => ({ ok: true, permalink: "https://acme.slack.com/archives/C42/p1793610840000100" }),
    "conversations.info": () => ({ ok: true, channel: { name: "legal-requests" } }),
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith("https://files.slack.com/"))
        return new Response(new Uint8Array([37, 80, 68, 70]));
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
  process.env.FRONTEND_URL = "https://mike.example.com/";
  delete process.env.DB_JOBS_ENABLED;
  mocks.envApiKeys.mockReturnValue({});
  mocks.getEffectiveApiKeys.mockResolvedValue({ claude: "sk-org" });
  mocks.createDocumentVersion.mockImplementation(async (_db, version) => ({
    data: { id: version.id },
    error: null,
  }));
  mocks.downloadFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
  mocks.uploadFile.mockResolvedValue(undefined);
  mocks.enqueueConversion.mockResolvedValue(undefined);
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.enqueueDbJob.mockResolvedValue(undefined);
  modelCalls([recordCall(), ruleCall(1)]);
  stubSlack();
});
afterAll(() => {
  process.env = env;
  vi.unstubAllGlobals();
});

/** Run every intake.deliver job the code under test queued, as the runner would. */
async function deliverQueued(attempts = 1) {
  const queued = mocks.enqueueDbJob.mock.calls
    .map(([, input]) => input)
    .filter((input) => input.kind === "intake.deliver");
  for (const input of queued)
    await handleIntakeDeliver(memory.db, {
      ...job(),
      kind: "intake.deliver",
      payload: input.payload,
      attempts,
      max_attempts: 5,
      dedupe_key: input.dedupeKey,
    });
  return queued.length;
}

describe("recording an email", () => {
  it("leaves a message for an organization being deleted unread by the model", async () => {
    setup({ payload: emailPayload() });
    const organizations = memory.rows("organizations");
    if (!organizations.length) organizations.push({ id: org });
    for (const row of organizations) row.deleted_at = "2026-11-12T00:00:00Z";
    await expect(handleIntakeAgent(memory.db, job())).resolves.toEqual({
      skipped: "organization_deleted",
    });
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(memory.rows("intake_requests")).toEqual([]);
  });
  it("records MikeGC's triaged request with the relevant documents, then forgets the message", async () => {
    setup({ payload: emailPayload() });
    await expect(handleIntakeAgent(memory.db, job())).resolves.toEqual({
      request_id: inboundId,
      triaged: true,
      asked: false,
    });
    expect(memory.rpcCalls.find((c) => c.name === "intake_submit_automated")?.args).toMatchObject({
      p_org: org,
      p_inbound: inboundId,
      p_request: inboundId,
      p_subject: "Review Supplier Co NDA",
      p_requester_name: "Jane Business",
      p_requester_email: "jane@acme.test",
      p_date: "2026-11-06",
      p_assignee: sam,
    });
    const [request] = memory.rows("intake_requests");
    expect(request).toMatchObject({ created_by: null, source: "gmail", assignee_id: sam });
    expect(request!.description).toMatch(/^Jane needs the Supplier Co NDA reviewed by Friday\.\n\n--- Original message ---/);
    // Triage kept the NDA and left out the logo.
    const documents = memory.rows("documents");
    expect(documents).toEqual([
      expect.objectContaining({
        user_id: null,
        org_id: org,
        library_kind: "intake_attachment",
        status: "ready",
      }),
    ]);
    const documentId = documents[0]!.id as string;
    expect(memory.rows("intake_request_documents")).toEqual([
      expect.objectContaining({ request_id: inboundId, document_id: documentId, automated: true }),
    ]);
    const key = `documents/intake-${org}/${documentId}/source.docx`;
    expect(mocks.downloadFile).toHaveBeenCalledWith(`intake-inbound/${org}/${inboundId}/0`);
    expect(mocks.uploadFile).toHaveBeenCalledWith(key, expect.any(ArrayBuffer), expect.stringContaining("wordprocessingml"));
    expect(mocks.createDocumentVersion).toHaveBeenCalledWith(memory.db, expect.objectContaining({
      document_id: documentId,
      storage_path: key,
      pdf_storage_path: null,
      filename: "nda.docx",
      file_type: "docx",
      size_bytes: 4,
    }));
    // The viewer opens Word files from a PDF rendition, made as for uploads.
    expect(mocks.enqueueConversion).toHaveBeenCalledWith(expect.objectContaining({
      documentId,
      storagePath: key,
      fileType: "docx",
      pdfKey: `converted-pdfs/intake-${org}/${documentId}.pdf`,
      finalizeDocumentStatus: false,
    }));
    expect(row()).toMatchObject({ status: "done", payload: null, error: null, request_id: inboundId });
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, expect.objectContaining({
      kind: "storage.cleanup",
      payload: {
        keys: [`intake-inbound/${org}/${inboundId}/0`, `intake-inbound/${org}/${inboundId}/1`],
        prefixes: [],
      },
    }));
    // The model saw the organization's rules, never another organization's.
    const asked = model.requests[0]!;
    expect(asked.messages[0]!.content).toContain(
      'RULES: [{"number":1,"condition":"The request is about an NDA"}]',
    );
    expect(asked.tools!.map((t) => t.function.name)).toEqual([
      "reply",
      "record_request",
      "update_request",
      "choose_rule",
    ]);
    expect(asked).toMatchObject({ model: "claude-haiku-4-5", maxIterations: 4, requireTools: true });
    expect(model.results).toEqual([["recorded", "assigned by rule 1"]]);
  });
  it("queues AI preprocessing once the request and its documents are recorded, when its rule asks", async () => {
    setup({ payload: emailPayload() });
    Object.assign(memory.rows("intake_assignment_rules")[0]!, {
      preprocess: true,
      preprocess_kind: "playbook",
      preprocess_ref: "pb-1",
    });
    await handleIntakeAgent(memory.db, job());
    const queued = mocks.enqueueDbJob.mock.calls.filter(
      ([, input]) => input.kind === "intake.preprocess",
    );
    expect(queued).toEqual([
      [
        memory.db,
        expect.objectContaining({
          payload: expect.objectContaining({
            orgId: org,
            requestId: inboundId,
            with: { kind: "playbook", id: "pb-1" },
            condition: "The request is about an NDA",
            round: 0,
            // Its readiness check may ask too, so it sends the acknowledgement.
            acknowledge: true,
          }),
          dedupeKey: `intake.preprocess:${inboundId}:0`,
        }),
      ],
    ]);
    // After its documents, which preprocessing reads.
    expect(memory.rows("intake_request_documents")).toHaveLength(1);
  });
  it("doesn't queue preprocessing for a rule that doesn't ask for it", async () => {
    setup({ payload: emailPayload() });
    await handleIntakeAgent(memory.db, job());
    expect(
      mocks.enqueueDbJob.mock.calls.some(([, input]) => input.kind === "intake.preprocess"),
    ).toBe(false);
  });
  it("records the message as it is with no model to triage with, keeping every attachment", async () => {
    setup({ payload: emailPayload(), model: false });
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ triaged: false });
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(memory.rows("intake_requests")[0]).toMatchObject({
      subject: "NDA with Supplier Co",
      requester_email: "jane@acme.test",
      assignee_id: null,
      requested_by_date: null,
    });
    expect(memory.rows("intake_requests")[0]!.description).toBe(
      "Please review the attached NDA by Friday.\n\n--- Not attached ---\n- photo.png: not a PDF, Word, Excel or PowerPoint file",
    );
    expect(memory.rows("documents")).toHaveLength(2);
  });
  it("leaves the request unassigned when no rule matches", async () => {
    setup({ payload: emailPayload() });
    modelCalls([recordCall({ assignee_id: outsider }), ruleCall(0)]);
    await handleIntakeAgent(memory.db, job());
    expect(memory.rows("intake_requests")[0]).toMatchObject({ assignee_id: null, state: "submitted" });
  });
  it("resumes after a failure without asking the model again or duplicating documents", async () => {
    setup({ payload: emailPayload(), model: false });
    mocks.createDocumentVersion.mockRejectedValueOnce(new Error("storage hiccup"));
    await expect(handleIntakeAgent(memory.db, job())).rejects.toThrow("storage hiccup");
    expect(row()).toMatchObject({
      status: "pending",
      request_id: inboundId,
      error: "MikeGC couldn't record this message. Try sending it again.",
    });
    const planned = (row().payload as { documents: Record<string, { document_id: string; done: boolean }> }).documents;
    expect(planned["0"]).toMatchObject({ done: false });
    // The half-made document was rolled back.
    expect(memory.rows("documents")).toEqual([]);
    expect(mocks.deleteFileBestEffort).toHaveBeenCalled();

    await handleIntakeAgent(memory.db, job());
    expect(memory.rows("intake_requests")).toHaveLength(1);
    // The retried document kept the id it was given before it failed.
    expect(memory.rows("documents").map((d) => d.id)).toContain(planned["0"]!.document_id);
    expect(memory.rows("documents")).toHaveLength(2);
    expect(memory.rows("intake_request_documents")).toHaveLength(2);
    expect(row()).toMatchObject({ status: "done", error: null });
    // A third run finds nothing to do.
    await expect(handleIntakeAgent(memory.db, job())).resolves.toEqual({ skipped: "done" });
  });
  it("keeps a document an earlier attempt finished when a retry runs again", async () => {
    setup({ payload: emailPayload(), model: false });
    const made = mocks.createDocumentVersion.getMockImplementation()!;
    mocks.createDocumentVersion
      .mockImplementationOnce(made)
      .mockRejectedValueOnce(new Error("storage hiccup"));
    await expect(handleIntakeAgent(memory.db, job())).rejects.toThrow("storage hiccup");
    const planned = (row().payload as { documents: Record<string, { document_id: string; done: boolean }> }).documents;
    const first = planned["0"]!.document_id;
    expect(memory.rows("documents").find((d) => d.id === first)).toMatchObject({ status: "ready" });
    // As if the job stopped after the first document was finished but
    // before it was marked done: the retry neither remakes nor removes it.
    planned["0"]!.done = false;
    const uploads = mocks.uploadFile.mock.calls.length;
    mocks.deleteFileBestEffort.mockClear();
    await handleIntakeAgent(memory.db, job());
    expect(memory.rows("documents").find((d) => d.id === first)).toMatchObject({ status: "ready" });
    expect(mocks.uploadFile.mock.calls.length).toBe(uploads + 1);
    expect(mocks.deleteFileBestEffort).not.toHaveBeenCalled();
    expect(memory.rows("documents")).toHaveLength(2);
    expect(row()).toMatchObject({ status: "done" });
  });
  it("keeps a request deleted after it was recorded deleted when the job retries", async () => {
    setup({ payload: emailPayload(), model: false });
    mocks.createDocumentVersion.mockRejectedValueOnce(new Error("storage hiccup"));
    await expect(handleIntakeAgent(memory.db, job())).rejects.toThrow("storage hiccup");
    expect(row().payload).toMatchObject({ recorded: true });
    // A reviewer deletes it before the retry, which clears the message's link.
    memory.tables.intake_requests = [];
    row().request_id = null;
    await expect(handleIntakeAgent(memory.db, job())).resolves.toEqual({
      request_id: null,
      deleted: true,
    });
    expect(memory.rows("intake_requests")).toEqual([]);
    expect(row()).toMatchObject({ status: "done", payload: null });
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, expect.objectContaining({
      kind: "storage.cleanup",
      payload: {
        keys: [`intake-inbound/${org}/${inboundId}/0`, `intake-inbound/${org}/${inboundId}/1`],
        prefixes: [],
      },
    }));
  });
  it("skips a message that is gone or already handled", async () => {
    setup({ payload: emailPayload() });
    memory.tables.intake_inbound = [];
    await expect(handleIntakeAgent(memory.db, job())).resolves.toEqual({ skipped: "missing" });
    await expect(
      handleIntakeAgent(memory.db, { ...job(), payload: { inboundId: "x" } }),
    ).rejects.toBeInstanceOf(NonRetryableJobError);
  });
});

describe("recording a Slack thread", () => {
  it("keeps the mention when the thread read stops short of it", async () => {
    setup({ payload: slackPayload(), source: "slack", model: false });
    stubSlack({
      "conversations.replies": () => ({
        ok: true,
        messages: [{ ts: "1793610840.000100", user: "U1", text: "Need the Supplier Co NDA signed off" }],
      }),
    });
    await handleIntakeAgent(memory.db, job());
    const [request] = memory.rows("intake_requests");
    expect(request).toMatchObject({ requester_name: "Jane Business" });
    expect(request!.description).toContain("Ravi Sales, 2 Nov 2026, 09:15 UTC:\ncan Legal look at this?");
  });
  it("records the thread up to the mention, with its first author as requester, and replies once", async () => {
    setup({ payload: slackPayload(), source: "slack", model: false });
    await handleIntakeAgent(memory.db, job());
    expect(slackCalls.find((c) => c.method === "conversations.replies")?.params).toMatchObject({
      channel: "C42",
      ts: "1793610840.000100",
      latest: "1793610900.000300",
      inclusive: "true",
    });
    const [request] = memory.rows("intake_requests");
    expect(request).toMatchObject({
      source: "slack",
      subject: "Need the Supplier Co NDA signed off",
      requester_name: "Jane Business",
      requester_email: "jane@acme.test",
    });
    expect(request!.description).toBe(
      "Jane Business, 2 Nov 2026, 09:14 UTC:\nNeed the Supplier Co NDA signed off\nThey want it back by Friday.\n\n" +
        "Ravi Sales, 2 Nov 2026, 09:15 UTC:\ncan Legal look at this?\n\n" +
        "--- Not attached ---\n- notes.txt: not a PDF, Word, Excel or PowerPoint file",
    );
    expect(memory.rows("documents")).toHaveLength(1);
    expect(mocks.uploadFile.mock.calls[0]![0]).toMatch(/source\.pdf$/);
    expect(mocks.createDocumentVersion.mock.calls[0]![1]).toMatchObject({
      file_type: "pdf",
      pdf_storage_path: mocks.uploadFile.mock.calls[0]![0],
    });
    expect(mocks.enqueueConversion).not.toHaveBeenCalled();
    // Linked to its thread, named for the request page.
    expect(memory.rows("intake_channel_links")).toEqual([
      expect.objectContaining({
        request_id: inboundId,
        source: "slack",
        thread_key: ":C42:1793610840.000100",
        address: expect.objectContaining({
          channel: "C42",
          thread_ts: "1793610840.000100",
          channel_name: "legal-requests",
          permalink: "https://acme.slack.com/archives/C42/p1793610840000100",
        }),
      }),
    ]);
    // The acknowledgement waits in the outbox until intake.deliver sends it.
    expect(memory.rows("intake_outbound")).toEqual([
      expect.objectContaining({ kind: "acknowledgement", status: "pending", message_id: null }),
    ]);
    expect(slackCalls.some((c) => c.method === "chat.postMessage")).toBe(false);
    expect(row()).toMatchObject({ status: "done", payload: null });
    expect(await deliverQueued()).toBe(1);
    expect(slackReplies).toMatchObject({
      channel: "C42",
      thread_ts: "1793610840.000100",
      // No link: the request's page is for the organization's members only.
      text: "Thanks, I've passed this to Legal. Someone from the team will pick it up soon.",
    });
    // Marked, so a retry can find it; MikeGC's own name, not a member's.
    expect(JSON.parse(String(slackReplies.metadata))).toEqual({
      event_type: "mikegc_intake",
      event_payload: { outbound_id: memory.rows("intake_outbound")[0]!.id },
    });
    expect(slackReplies.username).toBeUndefined();
    expect(memory.rows("intake_outbound")[0]).toMatchObject({ status: "sent", external_id: "1793610999.000900" });
  });
  it("counts dates from the mention, not from when a days-old thread began", async () => {
    // The thread began ten days before MikeGC was mentioned in it.
    setup({ payload: slackPayload({ thread_ts: "1792746840.000100" }), source: "slack" });
    stubSlack({
      "conversations.replies": () => ({
        ok: true,
        messages: [
          { ts: "1792746840.000100", user: "U1", text: "Need the Supplier Co NDA signed off by Friday" },
          { ts: "1793610900.000300", user: "U2", text: "<@UBOT> can Legal look at this?" },
        ],
      }),
    });
    await handleIntakeAgent(memory.db, job());
    expect(model.requests[0]!.messages[0]!.content).toContain("TODAY: 2026-11-02 (UTC)");
  });
  it("names the reviewer who will pick the request up", async () => {
    setup({ payload: slackPayload({ thread_ts: null, ts: "1793610840.000100", user: "U1", text: "<@UBOT> NDA please" }), source: "slack", kind: "personal" });
    await handleIntakeAgent(memory.db, job());
    expect(slackCalls.some((c) => c.method === "conversations.replies")).toBe(false);
    await deliverQueued();
    expect(slackReplies.thread_ts).toBe("1793610840.000100");
    expect(slackReplies.text).toBe(
      "Thanks, I've passed this to Legal. Sam Lawyer will pick it up.",
    );
  });
  it("answers a greeting in the chat without recording a request", async () => {
    setup({ payload: slackPayload({ thread_ts: null, ts: "1793610840.000100", user: "U1", text: "<@UBOT> hi there" }), source: "slack" });
    modelCalls([replyCall("Hi! Tell me what you need from Legal & I'll pass it on."), recordCall()]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: null, replied: true });
    // A reply ends the run: nothing after it is done.
    expect(model.results).toEqual([["(the run ended)"]]);
    expect(memory.rows("intake_requests")).toEqual([]);
    expect(memory.rows("intake_outbound")).toEqual([]);
    expect(slackReplies).toMatchObject({
      channel: "C42",
      thread_ts: "1793610840.000100",
      text: "Hi! Tell me what you need from Legal &amp; I'll pass it on.",
    });
    expect(row()).toMatchObject({ status: "done", payload: null });
    // Remembered with what MikeGC said, so a reply there without a mention
    // reaches MikeGC and is read with it.
    expect(memory.rows("intake_conversations")).toEqual([
      expect.objectContaining({
        org_id: org,
        source: "slack",
        thread_key: ":C42:1793610840.000100",
        rounds: 1,
        replies: [{ at: expect.stringMatching(/UTC$/), text: "Hi! Tell me what you need from Legal & I'll pass it on." }],
      }),
    ]);
  });
  it("never answers twice when a retry follows an answer Slack took", async () => {
    setup({ payload: slackPayload({ thread_ts: null, ts: "1793610840.000100", user: "U1", text: "<@UBOT> hi there" }), source: "slack" });
    modelCalls([replyCall("Hi! What do you need from Legal?")]);
    // Slack posts the answer, but its response is lost on the way back.
    let posted: Record<string, string> | null = null;
    stubSlack({
      "conversations.replies": () => ({
        ok: true,
        messages: posted ? [{ ts: "1793610999.000900", bot_id: "B1", metadata: JSON.parse(posted.metadata!) }] : [],
      }),
    });
    const fetchMock = vi.mocked(globalThis.fetch);
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("chat.postMessage")) {
        posted = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
        throw new TypeError("fetch failed");
      }
      return inner(url, init);
    });
    await expect(handleIntakeAgent(memory.db, job())).rejects.toBeTruthy();
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ replied: true });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("chat.postMessage"))).toHaveLength(1);
    expect(memory.rows("intake_conversations")).toEqual([expect.objectContaining({ rounds: 1 })]);
  });
  it("reads the next message in the thread with MikeGC's earlier answer, and records it once it's clear", async () => {
    setup({ payload: slackPayload({ thread_ts: "1793610840.000100", ts: "1793610900.000300", user: "U1", text: "It's a supplier NDA" }), source: "slack" });
    memory.rows("intake_conversations").push({
      org_id: org,
      source: "slack",
      thread_key: ":C42:1793610840.000100",
      rounds: 1,
      replies: [{ at: "2 Nov 2026, 09:14 UTC", text: "Is Acme a customer or a supplier?" }],
    });
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: inboundId });
    const prompt = model.requests[0]!.messages[0]!.content;
    expect(prompt).toContain("--- MikeGC's earlier replies in this thread ---\nMikeGC, 2 Nov 2026, 09:14 UTC:\nIs Acme a customer or a supplier?");
    expect(memory.rows("intake_requests")[0]).toMatchObject({ assignee_id: sam });
  });
  it("tells the agent about the organization from its name and profile", async () => {
    setup({ payload: slackPayload({ user: "U1", text: "Can Legal review the Supplier Co NDA?" }), source: "slack" });
    memory.rows("organizations")[0]!.name = "Acme Ltd";
    memory.rows("org_profiles").push({ org_id: org, about: "Makes accounting software.", industry: null });
    modelCalls([recordCall({ attachments: [] }), ruleCall(1)]);
    await handleIntakeAgent(memory.db, job());
    expect(model.requests[0]!.messages[0]!.content).toContain(
      'ORGANIZATION: {"name":"Acme Ltd","about":"Makes accounting software."}',
    );
  });
  it("records the message once MikeGC has answered in its thread a few times", async () => {
    setup({ payload: slackPayload({ thread_ts: null, ts: "1793610840.000100", user: "U1", text: "<@UBOT> wassup" }), source: "slack" });
    memory.rows("intake_conversations").push({ org_id: org, source: "slack", thread_key: ":C42:1793610840.000100", rounds: 3 });
    modelCalls([replyCall("Hi again!")], [recordCall({ subject: "Wassup", attachments: [] }), ruleCall(0)]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: inboundId });
    expect(model.results[0]).toEqual(["refused: you have answered in this thread 3 times: call record_request"]);
    expect(memory.rows("intake_requests")).toHaveLength(1);
  });
  it("records a message with attachments rather than answering it without a request", async () => {
    setup({ payload: slackPayload(), source: "slack" });
    modelCalls([replyCall("Is Acme a customer or a supplier?")], [recordCall(), ruleCall(1)]);
    await handleIntakeAgent(memory.db, job());
    expect(model.results[0]).toEqual(["refused: the message has attachments: call record_request first, then reply"]);
    expect(memory.rows("intake_requests")[0]).toMatchObject({ assignee_id: sam });
  });
  it("answers an email that isn't a request in its thread, as in a chat, recording nothing", async () => {
    setup({ payload: gmailPayload(), source: "gmail" });
    mocks.gmailDeliver.mockResolvedValue({ externalId: "sent-1@mail.gmail.com", documents: [] });
    modelCalls([replyCall("Hi! Tell me what you need from Legal and I'll pass it on.")]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: null, replied: true });
    expect(memory.rows("intake_requests")).toEqual([]);
    expect(memory.rows("intake_outbound")).toEqual([]);
    expect(memory.rows("intake_channel_links")).toEqual([]);
    // A reply to the sender's own message, in its thread, with no link behind it.
    const [, link, message] = mocks.gmailDeliver.mock.calls[0]!;
    expect(link).toMatchObject({
      id: "",
      source: "gmail",
      thread_key: "gmail:t-9",
      address: expect.objectContaining({
        to: ["pat@firm.test"],
        thread: "t-9",
        reply_to_message_id: "gm-9",
        subject: "How are you",
        references: ["<hello@firm.test>"],
      }),
    });
    expect(message).toMatchObject({
      kind: "answer",
      author: { kind: "mikegc" },
      text: "Hi! Tell me what you need from Legal and I'll pass it on.",
    });
    expect(row()).toMatchObject({ status: "done", payload: null });
    // Counted, so after a few answers the thread's next email is recorded.
    expect(memory.rows("intake_conversations")).toEqual([
      expect.objectContaining({ org_id: org, source: "gmail", thread_key: "gmail:t-9", rounds: 1 }),
    ]);
  });
  it("answers an email once when counting the answer fails and the job retries", async () => {
    setup({ payload: gmailPayload(), source: "gmail" });
    mocks.gmailDeliver.mockResolvedValue({ externalId: "sent-1@mail.gmail.com", documents: [] });
    modelCalls([replyCall("Hi!")]);
    let outage = true;
    memory.intercept = ({ table }) =>
      table === "intake_conversations" && outage ? { message: "connection reset" } : null;
    await expect(handleIntakeAgent(memory.db, job())).rejects.toBeTruthy();
    outage = false;
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: null, replied: true });
    expect(mocks.gmailDeliver).toHaveBeenCalledTimes(1);
    expect(memory.rows("intake_conversations")).toEqual([
      expect.objectContaining({ source: "gmail", thread_key: "gmail:t-9", rounds: 1 }),
    ]);
  });
  it("answers and records in Teams the same way, in the message's own thread", async () => {
    const teams = (activity: string, text: string) => ({
      kind: "teams",
      tenant_id: "tenant-1",
      service_url: "https://smba.trafficmanager.net/emea/",
      conversation_id: "19:abc@thread.tacv2;messageid=1700000000001",
      team_id: "team-1",
      // Without a group, the thread isn't read from Graph: the message alone.
      aad_group_id: null,
      channel_id: "19:abc@thread.tacv2",
      root_message_id: "1700000000001",
      team_name: "Legal",
      channel_name: "Requests",
      activity_id: activity,
      from: { id: "29:jane", aad_object_id: "aad-jane", name: "Jane Business" },
      date: "2026-11-02T09:14:00.000Z",
      text,
      files: [],
    });
    setup({ payload: teams("1700000000001", "Hi MikeGC"), source: "slack" });
    mocks.teamsDeliver.mockResolvedValue({ externalId: "1700000000009", documents: [] });
    modelCalls([replyCall("Hi! What do you need from Legal?")]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ replied: true });
    expect(mocks.teamsDeliver.mock.calls[0]![2]).toMatchObject({ kind: "answer", text: "Hi! What do you need from Legal?" });
    const key = "tenant-1:19:abc@thread.tacv2;messageid=1700000000001";
    expect(memory.rows("intake_conversations")).toEqual([
      expect.objectContaining({ source: "teams", thread_key: key, rounds: 1 }),
    ]);
    // The next message in the thread is read with that answer, and recorded.
    setup({ payload: teams("1700000000002", "I need the Acme NDA reviewed"), source: "slack" });
    memory.rows("intake_conversations").push({
      org_id: org,
      source: "teams",
      thread_key: key,
      rounds: 1,
      replies: [{ at: "2 Nov 2026, 09:14 UTC", text: "Hi! What do you need from Legal?" }],
    });
    modelCalls([recordCall({ attachments: [] }), ruleCall(1)]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: inboundId });
    expect(model.requests[0]!.messages[0]!.content).toContain("CHANNEL: Teams");
    expect(model.requests[0]!.messages[0]!.content).toContain("MikeGC, 2 Nov 2026, 09:14 UTC:\nHi! What do you need from Legal?");
    expect(memory.rows("intake_requests")[0]).toMatchObject({ assignee_id: sam });
    expect(memory.rows("intake_channel_links")).toEqual([expect.objectContaining({ source: "teams", thread_key: key })]);
    expect(memory.rows("intake_outbound")).toEqual([expect.objectContaining({ kind: "acknowledgement" })]);
  });
  it("answers an Outlook email in its thread, as in Gmail", async () => {
    setup({ payload: { ...gmailPayload(), provider: "graph", provider_id: "AAMk-9", thread: "conv-9" }, source: "gmail" });
    mocks.outlookDeliver.mockResolvedValue({ externalId: "sent-1", documents: [] });
    modelCalls([replyCall("Hi! What do you need from Legal?")]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ replied: true });
    expect(model.requests[0]!.messages[0]!.content).toContain("CHANNEL: Outlook");
    expect(mocks.outlookDeliver.mock.calls[0]![1]).toMatchObject({ source: "outlook", address: expect.objectContaining({ reply_to_message_id: "AAMk-9" }) });
    expect(memory.rows("intake_conversations")).toEqual([expect.objectContaining({ source: "outlook", rounds: 1 })]);
  });
  it("records an email once MikeGC has answered in its thread a few times", async () => {
    setup({ payload: gmailPayload(), source: "gmail" });
    memory.rows("intake_conversations").push({ org_id: org, source: "gmail", thread_key: "gmail:t-9", rounds: 3 });
    modelCalls([replyCall("Hi again!")]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: inboundId });
    expect(memory.rows("intake_requests")).toHaveLength(1);
    expect(mocks.gmailDeliver).not.toHaveBeenCalled();
  });
  it("acknowledges once when the job is retried", async () => {
    setup({ payload: slackPayload(), source: "slack", model: false });
    let failDone = true;
    memory.intercept = ({ table, values }) => {
      if (table === "intake_inbound" && (values as { status?: string })?.status === "done" && failDone) {
        failDone = false;
        return { code: "08006", message: "connection lost" };
      }
      return undefined;
    };
    await expect(handleIntakeAgent(memory.db, job())).rejects.toMatchObject({ code: "08006" });
    await handleIntakeAgent(memory.db, job());
    expect(memory.rows("intake_outbound")).toHaveLength(1);
    expect(memory.rows("documents")).toHaveLength(1);
    expect(row()).toMatchObject({ status: "done" });
  });
  it("never posts twice when a delivery is retried after Slack took it", async () => {
    setup({ payload: slackPayload(), source: "slack", model: false });
    await handleIntakeAgent(memory.db, job());
    const outbound = memory.rows("intake_outbound")[0]!;
    // Slack posts the message, but the answer is lost on the way back.
    let posted: Record<string, string> | null = null;
    stubSlack({
      "chat.postMessage": (p) => {
        posted = p;
        throw new Error("connection reset");
      },
      "conversations.replies": () => ({
        ok: true,
        messages: posted
          ? [{ ts: "1793610999.000900", bot_id: "B1", metadata: JSON.parse(posted.metadata!) }]
          : [],
      }),
    });
    const fetchMock = vi.mocked(globalThis.fetch);
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("chat.postMessage")) {
        posted = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
        throw new TypeError("fetch failed");
      }
      return inner(url, init);
    });
    await expect(deliverQueued(1)).rejects.toBeTruthy();
    expect(outbound.status).toBe("pending");
    expect(outbound.attempted_at).toBeTruthy();
    // The retry finds the post by its metadata and doesn't post again.
    await deliverQueued(2);
    expect(slackCalls.find((c) => c.method === "conversations.replies")?.params).toMatchObject({
      include_all_metadata: "true",
    });
    expect(outbound).toMatchObject({ status: "sent", external_id: "1793610999.000900" });
  });
  it("asks the requester in the acknowledgement when it can't yet choose a rule", async () => {
    setup({ payload: slackPayload(), source: "slack" });
    modelCalls([
      recordCall({ subject: "Review Acme NDA", summary: "An NDA with Acme.", due_date: "" }),
      replyCall("Is Acme a customer or a supplier?\nSee https://evil.test for details"),
    ]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ asked: true });
    // The reply ended the run in its step.
    expect(model.results).toEqual([["(the run ended)"]]);
    expect(memory.rows("intake_requests")[0]).toMatchObject({
      assignee_id: null,
      state: "needs_information",
      clarify_stage: "rule",
      clarify_rounds: 1,
    });
    // A question with a link is dropped; MikeGC frames the rest itself.
    expect(memory.rows("intake_messages")).toEqual([
      expect.objectContaining({
        kind: "question",
        automated: true,
        body: "One quick question so it gets to the right person:\nIs Acme a customer or a supplier?",
      }),
    ]);
    expect(memory.rows("intake_outbound")).toEqual([
      expect.objectContaining({ kind: "acknowledgement", message_id: memory.rows("intake_messages")[0]!.id }),
    ]);
    expect(mocks.enqueueDbJob.mock.calls.some(([, input]) => input.kind === "intake.preprocess")).toBe(false);
    await deliverQueued();
    expect(slackReplies.text).toBe(
      // Asking before choosing who gets it, MikeGC promises no one yet.
      "Thanks, I've passed this to Legal. One quick question so it gets to the right person:\n" +
        "Is Acme a customer or a supplier?",
    );
  });
  it("keeps the rule's reviewer for mail from another request's thread, where it can't ask", async () => {
    // The thread stays the other request's, so this one is never linked to
    // it: questions planned for it could never be sent.
    setup({
      payload: {
        kind: "mail",
        provider: "gmail",
        mailbox: "intake@firm.test",
        provider_id: "gm-3",
        message_id: "<other@partner.test>",
        thread: "t-1",
        from: { name: "Pat", email: "pat@partner.test" },
        to: ["intake@firm.test"],
        cc: [],
        subject: "Re: NDA",
        date: "2026-11-02T09:14:00.000Z",
        text: "Please look at our NDA too.",
        attachments: [],
        skipped: [],
        related_request_id: "request-0",
      },
    });
    memory.rows("intake_channel_links").push({
      id: "link-0",
      org_id: org,
      request_id: "request-0",
      source: "gmail",
      thread_key: "gmail:t-1",
      address: {},
    });
    modelCalls([recordCall({ attachments: [] }), replyCall("Is the contract over $250k?")], [ruleCall(1)]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ asked: false });
    expect(model.results[0]![1]).toBe("refused: this message can't be answered in its thread: call choose_rule");
    expect(memory.rows("intake_requests")[0]).toMatchObject({ assignee_id: sam });
    expect(memory.rows("intake_messages").filter((m) => m.kind === "question")).toEqual([]);
  });
  it("records mail from another request's thread instead of answering it there", async () => {
    setup({
      payload: {
        ...gmailPayload(),
        thread: "t-1",
        from: { name: "Pat", email: "pat@partner.test" },
        subject: "Re: NDA",
        text: "How are you?",
        related_request_id: "request-0",
      },
      source: "gmail",
    });
    memory.rows("intake_channel_links").push({
      id: "link-0",
      org_id: org,
      request_id: "request-0",
      source: "gmail",
      thread_key: "gmail:t-1",
      address: {},
    });
    modelCalls([replyCall("Hi!")]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: inboundId });
    expect(model.results).toEqual([["refused: this message can't be answered in its thread: record it"]]);
    expect(memory.rows("intake_requests")).toHaveLength(1);
    expect(mocks.gmailDeliver).not.toHaveBeenCalled();
    expect(memory.rows("intake_conversations")).toEqual([]);
  });
  it("leaves the acknowledgement to preprocessing's readiness check, which may ask too", async () => {
    setup({ payload: slackPayload(), source: "slack" });
    Object.assign(memory.rows("intake_assignment_rules")[0]!, { preprocess: true });
    await handleIntakeAgent(memory.db, job());
    expect(memory.rows("intake_outbound")).toEqual([]);
    expect(
      mocks.enqueueDbJob.mock.calls.find(([, input]) => input.kind === "intake.preprocess")?.[1].payload,
    ).toMatchObject({ round: 0, acknowledge: true, condition: "The request is about an NDA" });
  });
  it("names on the request a Teams file it couldn't fetch, rather than dropping it unseen", async () => {
    setup({
      payload: {
        kind: "teams",
        tenant_id: "tenant-1",
        service_url: "https://smba.trafficmanager.net/emea/",
        conversation_id: "19:abc@thread.tacv2;messageid=1700000000001",
        team_id: "team-1",
        aad_group_id: null,
        channel_id: "19:abc@thread.tacv2",
        root_message_id: "1700000000001",
        activity_id: "1700000000001",
        from: { id: "29:jane", aad_object_id: "aad-jane", name: "Jane Business" },
        date: "2026-11-02T09:14:00.000Z",
        text: "Please review the attached NDA",
        files: [{ name: "NDA.docx", size: null, url: "https://acme.sharepoint.com/sites/legal/NDA.docx" }],
      },
      source: "slack",
      model: false,
    });
    // Document access is an optional Teams setup step.
    Object.assign(memory.rows("intake_automation")[0]!, { teams_files_access: false });
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: inboundId });
    expect(memory.rows("documents")).toEqual([]);
    expect(memory.rows("intake_messages").filter((m) => m.kind === "note")).toEqual([
      expect.objectContaining({
        request_id: inboundId,
        automated: true,
        body: "Not attached: MikeGC couldn't add these files, so ask the requester for a copy.\n- NDA.docx: could not be read",
      }),
    ]);
  });
  it("fails at once, with a reason an admin can act on, when MikeGC can't read the channel", async () => {
    setup({ payload: slackPayload(), source: "slack" });
    stubSlack({ "conversations.replies": () => ({ ok: false, error: "not_in_channel" }) });
    await expect(handleIntakeAgent(memory.db, job())).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(row()).toMatchObject({
      status: "pending",
      error: "MikeGC can't read that Slack channel. Invite @MikeGC to it.",
    });
  });
});

describe("several mentions in one chat thread", () => {
  const secondId = "00000000-0000-4000-8000-0000000000e2";
  const jobFor = (id: string): DbJob => ({
    ...job(),
    payload: { inboundId: id, orgId: org },
    dedupe_key: `intake.agent:${id}`,
  });
  const second = () => memory.rows("intake_inbound").find((r) => r.id === secondId)!;
  /** A second mention in the thread, stored as a new request before the first was recorded. */
  function queueSecond(payload: Record<string, unknown>, externalId: string) {
    memory.rows("intake_inbound").push({
      id: secondId,
      org_id: org,
      source: "slack",
      kind: "request",
      status: "pending",
      external_id: externalId,
      payload,
      request_id: null,
      error: null,
      created_at: new Date().toISOString(),
    });
  }
  const slackSecond = () =>
    slackPayload({ ts: "1793610950.000400", user: "U1", text: "<@UBOT> they need it back by Friday" });
  function stubThreadWithSecond() {
    stubSlack({
      "conversations.replies": () => ({
        ok: true,
        messages: [
          { ts: "1793610840.000100", user: "U1", text: "Need the Supplier Co NDA signed off" },
          { ts: "1793610900.000300", user: "U2", text: "<@UBOT> can Legal look at this?" },
          { ts: "1793610950.000400", user: "U1", text: "<@UBOT> they need it back by Friday" },
        ],
      }),
    });
  }
  /** One request, one link, and the second mention recorded as its reply. */
  function expectOneRequestWithReply(source: "slack" | "teams") {
    expect(memory.rows("intake_requests")).toEqual([expect.objectContaining({ id: inboundId })]);
    expect(memory.rows("intake_channel_links")).toEqual([
      expect.objectContaining({ request_id: inboundId, source }),
    ]);
    expect(memory.rows("intake_messages").filter((m) => m.kind === "reply")).toEqual([
      expect.objectContaining({ request_id: inboundId, external_author: expect.objectContaining({ source }) }),
    ]);
    expect(second()).toMatchObject({ kind: "reply", request_id: inboundId, status: "done", payload: null });
  }
  const readAsReply = (requests: { messages: { content: unknown }[] }[]) =>
    requests.map((r) => String(r.messages[0]!.content).includes("REQUEST: none"));

  it("records a mention whose thread was recorded since as that request's reply, without planning it as a request", async () => {
    setup({ payload: slackPayload(), source: "slack" });
    queueSecond(slackSecond(), "C42:1793610950.000400");
    stubThreadWithSecond();
    modelCalls([recordCall({ attachments: [] }), ruleCall(1)]);
    await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: inboundId });
    modelCalls([replyCall("Thanks, I noted the Friday deadline.")]);
    await expect(handleIntakeAgent(memory.db, jobFor(secondId))).resolves.toMatchObject({
      request_id: inboundId,
    });
    expectOneRequestWithReply("slack");
    // Read once, as a reply on the request: never as a new request.
    expect(readAsReply(model.requests)).toEqual([false]);
    expect(memory.rpcCalls.filter((c) => c.name === "intake_submit_automated")).toHaveLength(1);
    expect(memory.rows("intake_messages").find((m) => m.kind === "reply")!.body).toBe(
      "they need it back by Friday",
    );
  });
  it("records a mention planned while the thread was free as the reply of the request that linked it first", async () => {
    setup({ payload: slackPayload(), source: "slack" });
    queueSecond(slackSecond(), "C42:1793610950.000400");
    stubThreadWithSecond();
    const asSecond = scripted([[recordCall({ subject: "Friday deadline", attachments: [] }), ruleCall(1)]]);
    const asFirst = scripted([[recordCall({ attachments: [] }), ruleCall(1)]]);
    const asReply = scripted([[replyCall("Thanks, I noted the Friday deadline.")]]);
    let calls = 0;
    mocks.stream.mockImplementation(async (params) => {
      calls += 1;
      if (calls === 1) {
        // The second mention is planned as a request; meanwhile the first
        // is recorded and links the thread.
        const planned = await asSecond.stream(params);
        await expect(handleIntakeAgent(memory.db, job())).resolves.toMatchObject({ request_id: inboundId });
        return planned;
      }
      return (calls === 2 ? asFirst : asReply).stream(params);
    });
    await expect(handleIntakeAgent(memory.db, jobFor(secondId))).resolves.toMatchObject({
      request_id: inboundId,
    });
    expectOneRequestWithReply("slack");
    expect(readAsReply(asReply.requests)).toEqual([false]);
    // Recording the second found the thread claimed, in the same call.
    expect(
      memory.rpcCalls
        .filter((c) => c.name === "intake_submit_automated")
        .map((c) => [c.args.p_inbound, c.args.p_thread_key]),
    ).toEqual([
      [inboundId, ":C42:1793610840.000100"],
      [secondId, ":C42:1793610840.000100"],
    ]);
  });
  it("records a second Teams mention in the thread as the first one's reply", async () => {
    const teams = (activity: string, text: string) => ({
      kind: "teams",
      tenant_id: "tenant-1",
      // Not Bot Framework's: the reply's author isn't looked up.
      service_url: "https://teams.example.test/",
      conversation_id: "19:abc@thread.tacv2;messageid=1700000000001",
      team_id: "team-1",
      aad_group_id: null,
      channel_id: "19:abc@thread.tacv2",
      root_message_id: "1700000000001",
      team_name: "Legal",
      channel_name: "Requests",
      activity_id: activity,
      from: { id: "29:jane", aad_object_id: "aad-jane", name: "Jane Business" },
      date: "2026-11-02T09:14:00.000Z",
      text,
      files: [],
    });
    setup({ payload: teams("1700000000001", "I need the Acme NDA reviewed"), source: "slack" });
    queueSecond(teams("1700000000002", "By Friday, please"), "1700000000002");
    modelCalls([recordCall({ attachments: [] }), ruleCall(1)]);
    await handleIntakeAgent(memory.db, job());
    modelCalls([replyCall("Thanks, I noted the Friday deadline.")]);
    await expect(handleIntakeAgent(memory.db, jobFor(secondId))).resolves.toMatchObject({
      request_id: inboundId,
    });
    expectOneRequestWithReply("teams");
    expect(readAsReply(model.requests)).toEqual([false]);
    expect(memory.rows("intake_messages").find((m) => m.kind === "reply")!.body).toBe("By Friday, please");
  });
});

describe("when a message fails for good", () => {
  it("marks it failed with its reason, drops its content and says so in Slack", async () => {
    setup({ payload: slackPayload(), source: "slack" });
    memory.rows("intake_inbound")[0]!.error = "MikeGC can't read that Slack channel. Invite @MikeGC to it.";
    await markIntakeAgentFailed(memory.db, job());
    expect(row()).toMatchObject({
      status: "failed",
      payload: null,
      error: "MikeGC can't read that Slack channel. Invite @MikeGC to it.",
    });
    expect(slackReplies).toMatchObject({
      thread_ts: "1793610840.000100",
      text: "Sorry, I couldn't log this for Legal. Please try again, or contact the Legal team directly.",
    });
    // Already settled: a second call changes nothing.
    await markIntakeAgentFailed(memory.db, job());
    expect(slackCalls.filter((c) => c.method === "chat.postMessage")).toHaveLength(1);
  });
  it("says so in Teams too", async () => {
    setup({
      payload: {
        kind: "teams",
        tenant_id: "tenant-1",
        service_url: "https://smba.trafficmanager.net/emea/",
        conversation_id: "19:abc@thread.tacv2;messageid=1700000000001",
        team_id: "team-1",
        aad_group_id: null,
        channel_id: "19:abc@thread.tacv2",
        root_message_id: "1700000000001",
        activity_id: "1700000000001",
        from: { id: "29:jane", aad_object_id: "aad-jane", name: "Jane Business" },
        date: "2026-11-02T09:14:00.000Z",
        text: "Hi MikeGC",
        files: [],
      },
      source: "slack",
    });
    mocks.teamsDeliver.mockResolvedValue({ externalId: "1700000000009", documents: [] });
    await markIntakeAgentFailed(memory.db, job());
    expect(row()).toMatchObject({ status: "failed", payload: null });
    expect(mocks.teamsDeliver).toHaveBeenCalledTimes(1);
    expect(mocks.teamsDeliver.mock.calls[0]![1]).toMatchObject({
      source: "teams",
      thread_key: "tenant-1:19:abc@thread.tacv2;messageid=1700000000001",
    });
    expect(mocks.teamsDeliver.mock.calls[0]![2]).toMatchObject({
      id: inboundId,
      text: "Sorry, I couldn't log this for Legal. Please try again, or contact the Legal team directly.",
    });
    await markIntakeAgentFailed(memory.db, job());
    expect(mocks.teamsDeliver).toHaveBeenCalledTimes(1);
  });
  it("points the thread at a request that was recorded", async () => {
    setup({ payload: slackPayload(), source: "slack", model: false });
    // The request is recorded, then its file can't be downloaded.
    const fetchMock = vi.mocked(globalThis.fetch);
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string | URL | Request, init?: RequestInit) =>
      String(url).startsWith("https://files.slack.com/")
        ? new Response("busy", { status: 503 })
        : inner(url, init),
    );
    await expect(handleIntakeAgent(memory.db, job())).rejects.toBeTruthy();
    stubSlack();
    await markIntakeAgentFailed(memory.db, job());
    expect(row()).toMatchObject({
      status: "failed",
      request_id: inboundId,
      error: "The request was recorded, but MikeGC couldn't add all of its documents or reply in its thread.",
    });
    await deliverQueued();
    expect(String(slackReplies.text)).toMatch(/^Thanks, I.ve passed this to Legal\./);
  });
  it("records nothing when Slack refuses the thread's details, which are read before recording", async () => {
    setup({ payload: slackPayload(), source: "slack", model: false });
    stubSlack({ "chat.getPermalink": () => ({ ok: false, error: "invalid_auth" }) });
    await expect(handleIntakeAgent(memory.db, job())).rejects.toBeTruthy();
    expect(row()).toMatchObject({ request_id: null, status: "pending" });
    expect(memory.rows("intake_requests")).toEqual([]);
    expect(memory.rows("intake_channel_links")).toEqual([]);
  });
  it("links the thread before acknowledging, when the job failed before it could", async () => {
    setup({ payload: { ...slackPayload(), recorded: true }, source: "slack", model: false });
    // Recorded without its thread, as a build that linked it in a later
    // step could leave it.
    memory.rows("intake_requests").push({ id: inboundId, org_id: org, source: "slack", subject: "NDA", state: "submitted", assignee_id: null });
    row().request_id = inboundId;
    await markIntakeAgentFailed(memory.db, job());
    expect(memory.rows("intake_channel_links")).toHaveLength(1);
    await deliverQueued();
    expect(String(slackReplies.text)).toMatch(/^Thanks, I.ve passed this to Legal\./);
  });
  it("releases an email's staged attachments before it settles, so settling can't leave them behind", async () => {
    setup({ payload: emailPayload() });
    mocks.enqueueDbJob.mockImplementationOnce(async () => {
      expect(row().status).toBe("pending");
    });
    await markIntakeAgentFailed(memory.db, job());
    expect(row()).toMatchObject({
      status: "failed",
      error: "MikeGC couldn't record this message. Try sending it again.",
    });
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, expect.objectContaining({
      kind: "storage.cleanup",
      payload: {
        keys: [`intake-inbound/${org}/${inboundId}/0`, `intake-inbound/${org}/${inboundId}/1`],
        prefixes: [],
      },
    }));
  });
  it("keeps the message and its staged keys when their cleanup can't be queued", async () => {
    setup({ payload: emailPayload(), model: false });
    mocks.enqueueDbJob.mockImplementation(async (_db, input: { kind: string }) => {
      if (input.kind === "storage.cleanup") throw new Error("database unavailable");
    });
    await expect(handleIntakeAgent(memory.db, job())).rejects.toThrow("database unavailable");
    expect(row()).toMatchObject({ status: "pending" });
    expect(row().payload).toMatchObject({ kind: "mail", attachments: [{}, {}] });
  });
  it("deletes them at once when the job runner is off", async () => {
    process.env.DB_JOBS_ENABLED = "false";
    setup({ payload: emailPayload() });
    await markIntakeAgentFailed(memory.db, job());
    expect(mocks.deleteFile.mock.calls.map(([key]) => key)).toEqual([
      `intake-inbound/${org}/${inboundId}/0`,
      `intake-inbound/${org}/${inboundId}/1`,
    ]);
    expect(mocks.enqueueDbJob).not.toHaveBeenCalled();
    expect(row()).toMatchObject({ status: "failed" });
  });
});

describe("queueing", () => {
  it("queues one live job per message", async () => {
    setup({ payload: emailPayload() });
    await dispatchIntakeAgent(memory.db, org, inboundId);
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, {
      kind: "intake.agent",
      payload: { inboundId, orgId: org },
      dedupeKey: `intake.agent:${inboundId}`,
      maxAttempts: 4,
    });
  });
  it("runs it in-process when the job runner is off", async () => {
    process.env.DB_JOBS_ENABLED = "false";
    setup({ payload: emailPayload(), model: false });
    await dispatchIntakeAgent(memory.db, org, inboundId);
    expect(mocks.enqueueDbJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(row().status).toBe("done"));
  });
});

describe("purging intake", () => {
  // The intake_inbound delete trigger hands staged files to the storage
  // worker (see intake.postgres.test.ts), so the purge itself is one call.
  it("purges through the owner-authorized transaction alone", async () => {
    setup({ payload: emailPayload() });
    const purge = vi.fn(() => ({ data: null, error: null }));
    const db = memoryDb(memory.tables, { intake_purge: purge });
    await purgeIntake(db.db, org, owner);
    expect(purge).toHaveBeenCalledWith({ p_org: org, p_actor: owner }, expect.anything());
    expect(mocks.enqueueDbJob).not.toHaveBeenCalled();
  });
  it("fails when the owner check refuses the purge", async () => {
    setup({ payload: emailPayload() });
    const db = memoryDb(memory.tables, {
      intake_purge: () => ({ data: null, error: { code: "42501" } }),
    });
    await expect(purgeIntake(db.db, org, sam)).rejects.toThrow();
  });
});
