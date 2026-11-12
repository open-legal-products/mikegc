import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, requesterLoopRpc, type MemoryDb } from "./memoryDb";

const mocks = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  downloadFile: mocks.downloadFile,
}));
import { NonRetryableJobError } from "../../../lib/dbq/runner";
import { encryptString } from "../../../lib/mcp/client";
import { sendChatReply } from "../intake.automationJob";
import { handleIntakeDeliver } from "../intake.deliver";
import { clearMicrosoftTokens } from "../intake.microsoft";
import {
  shareId,
  teamsActivity,
  teamsActivityText,
  teamsEscape,
  teamsInboundMessage,
} from "../intake.teams";
import type { AutomationRow } from "../intake.settingsRow";

const org = "00000000-0000-4000-8000-000000000001";
const emma = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000021";
const outboundId = "00000000-0000-4000-8000-0000000000f1";
const appId = "11111111-1111-4111-8111-111111111111";
const env = { ...process.env };
let memory: MemoryDb;
let calls: { url: string; method: string; body: unknown }[];

type Route = (url: string) => Response | undefined;

function setup(filesAccess: boolean, route: Route = () => undefined, outbound: Record<string, unknown>[] = []) {
  const secret = encryptString("teams-secret");
  memory = memoryDb(
    {
      user_profiles: [{ user_id: emma, display_name: "Emma Chen", email: "emma@firm.test" }],
      intake_automation: [
        {
          org_id: org,
          teams_enabled: true,
          teams_app_id: appId,
          teams_tenant_id: "tenant-1",
          teams_client_secret_encrypted: secret.encrypted,
          teams_client_secret_iv: secret.iv,
          teams_client_secret_tag: secret.tag,
          teams_files_access: filesAccess,
        },
      ],
      intake_requests: [{ id: requestId, org_id: org, subject: "Review: Acme NDA", assignee_id: emma }],
      intake_channel_links: [
        {
          id: "link-1",
          org_id: org,
          request_id: requestId,
          source: "teams",
          thread_key: "tenant-1:19:abc@thread.tacv2;messageid=1",
          address: {
            service_url: "https://smba.trafficmanager.net/emea/",
            tenant_id: "tenant-1",
            aad_group_id: "group-1",
            channel_id: "19:abc@thread.tacv2",
            conversation_id: "19:abc@thread.tacv2;messageid=1",
            root_message_id: "1",
            channel_name: "Legal requests",
          },
        },
      ],
      intake_messages: [{ id: "m1", org_id: org, request_id: requestId, kind: "resolution", body: "Approved *with* edits." }],
      document_versions: [{ id: "v0", filename: "nda.docx", file_type: "docx", size_bytes: 3, storage_path: "documents/x/nda.docx", deleted_at: null }],
      intake_outbound: [
        { id: outboundId, org_id: org, request_id: requestId, link_id: "link-1", message_id: "m1", author_id: emma, kind: "answer", documents: [{ document_id: "d0", version_id: "v0" }], status: "pending", external_id: null, attempted_at: null },
        ...outbound,
      ],
    },
    requesterLoopRpc(),
  );
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const json = typeof init?.body === "string" && init.body.startsWith("{");
      calls.push({ url: target, method: init?.method ?? "GET", body: json ? JSON.parse(String(init!.body)) : null });
      const routed = route(target);
      if (routed) return routed;
      if (target.startsWith("https://login.microsoftonline.com/"))
        return Response.json({ access_token: "h.e30.s", expires_in: 3600 });
      if (target.endsWith("/filesFolder"))
        return Response.json({ id: "folder-1", parentReference: { driveId: "drive-1" } });
      if (target.includes("/drives/drive-1/items/folder-1:/"))
        return Response.json({ id: "item-1", webUrl: "https://acme.sharepoint.com/sites/Sales/nda.docx" });
      if (target.endsWith("/activities")) return Response.json({ id: "1793611111000" });
      return Response.json({}, { status: 404 });
    }),
  );
}

const deliver = () =>
  handleIntakeDeliver(memory.db, {
    id: "job",
    kind: "intake.deliver",
    payload: { orgId: org, outboundId },
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_at: "",
    claimed_at: "",
    finished_at: null,
    last_error: null,
    dedupe_key: null,
    result: null,
    created_at: "",
  });

beforeEach(() => {
  vi.clearAllMocks();
  clearMicrosoftTokens();
  process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-encryption-secret-for-intake";
  mocks.downloadFile.mockResolvedValue(new Uint8Array([80, 75]).buffer);
});
afterAll(() => {
  process.env = env;
  vi.unstubAllGlobals();
});

describe("replying in Teams", () => {
  it("uploads the documents to the channel's files, then posts in the thread, signed by the member", async () => {
    setup(true);
    await deliver();
    expect(calls.find((c) => c.url.includes("/drives/"))!.url).toBe(
      "https://graph.microsoft.com/v1.0/drives/drive-1/items/folder-1:/MikeGC/Review%20Acme%20NDA/nda.docx:/content?@microsoft.graph.conflictBehavior=rename",
    );
    const post = calls.find((c) => c.url.endsWith("/activities"))!;
    expect(post.url).toBe(
      "https://smba.trafficmanager.net/emea/v3/conversations/19%3Aabc%40thread.tacv2%3Bmessageid%3D1/activities",
    );
    expect(post.body).toEqual({
      type: "message",
      textFormat: "markdown",
      text:
        "Emma Chen \\(Legal\\):  \nApproved \\*with\\* edits.  \n  \n" +
        "Documents: [nda.docx](https://acme.sharepoint.com/sites/Sales/nda.docx)",
    });
    expect(memory.rows("intake_outbound")[0]).toMatchObject({
      status: "sent",
      external_id: "1793611111000",
      documents: [{ document_id: "d0", external_id: "https://acme.sharepoint.com/sites/Sales/nda.docx" }],
    });
  });
  it("names the documents instead when it has no document access", async () => {
    setup(false);
    await deliver();
    expect(calls.some((c) => c.url.includes("/drives/"))).toBe(false);
    const post = calls.find((c) => c.url.endsWith("/activities"))!;
    expect((post.body as { text: string }).text).toContain(
      "I couldn't share nda.docx here, so ask Legal for a copy.",
    );
    expect(memory.rows("intake_outbound")[0]).toMatchObject({ status: "sent", documents: [{ left_out: true }] });
  });
});

describe("when Microsoft refuses a document or a retry finds a message", () => {
  const graphThread = "https://graph.microsoft.com/v1.0/teams/group-1/channels/19%3Aabc%40thread.tacv2/messages/1";
  it("names a document Microsoft refuses in the reply, which still posts", async () => {
    setup(true, (url) =>
      url.includes(":/content") ? Response.json({ error: { code: "accessDenied" } }, { status: 403 }) : undefined,
    );
    await deliver();
    const post = calls.find((c) => c.url.endsWith("/activities"))!;
    expect((post.body as { text: string }).text).toContain(
      "I couldn't share nda.docx here, so ask Legal for a copy.",
    );
    expect(memory.rows("intake_outbound")[0]).toMatchObject({ status: "sent", documents: [{ left_out: true }] });
  });
  it("retries a document upload that may pass later, before posting anything", async () => {
    setup(true, (url) => (url.includes(":/content") ? new Response("", { status: 503 }) : undefined));
    await expect(deliver()).rejects.toThrow();
    expect(calls.some((c) => c.url.endsWith("/activities"))).toBe(false);
    expect(memory.rows("intake_outbound")[0]).toMatchObject({ status: "pending", external_id: null });
  });
  it("doesn't take a message another reply in the thread already owns as this one's", async () => {
    const earlier = new Date(Date.now() - 30_000).toISOString();
    setup(
      false,
      (url) => {
        if (url === graphThread) return Response.json({ id: "1", createdDateTime: earlier, body: { content: "Help with the NDA" } });
        if (url.startsWith(`${graphThread}/replies`))
          return Response.json({
            value: [
              {
                id: "owned-1",
                createdDateTime: earlier,
                from: { application: { id: appId } },
                body: { content: "Emma Chen (Legal):<br>Approved *with* edits." },
              },
            ],
          });
        return undefined;
      },
      [{ id: "00000000-0000-4000-8000-0000000000f2", org_id: org, request_id: requestId, link_id: "link-1", message_id: "m0", author_id: emma, kind: "answer", documents: [], status: "sent", external_id: "owned-1", attempted_at: earlier }],
    );
    memory.rows("intake_outbound")[0]!.attempted_at = earlier;
    await deliver();
    // The earlier answer's message is left to it, so this one is posted.
    expect(calls.some((c) => c.url.startsWith(`${graphThread}/replies`))).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/activities"))).toBe(true);
    expect(memory.rows("intake_outbound")[0]).toMatchObject({ status: "sent", external_id: "1793611111000" });
  });
});

describe("answering in a Teams chat without a request", () => {
  const settings = () => memory.rows("intake_automation")[0] as unknown as AutomationRow;
  const inbound = { id: "00000000-0000-4000-8000-0000000000e1", org_id: org, source: "teams" as const, kind: "request" as const, status: "pending" as const, payload: null, request_id: null, error: null };
  const payload = {
    kind: "teams" as const,
    tenant_id: "tenant-1",
    service_url: "https://smba.trafficmanager.net/emea/",
    conversation_id: "19:abc@thread.tacv2;messageid=1",
    team_id: "team-1",
    aad_group_id: "group-1",
    channel_id: "19:abc@thread.tacv2",
    root_message_id: "1",
    team_name: null,
    channel_name: null,
    activity_id: "3",
    from: { id: "29:jane", aad_object_id: null, name: "Jane Business" },
    date: "2026-11-03T10:05:00Z",
    text: "hi there",
    files: [],
  };
  it("posts MikeGC's reply in the message's thread, escaped, as MikeGC", async () => {
    setup(false);
    await sendChatReply(memory.db, inbound, settings(), payload as never, "Hi! What can *Legal* help with?");
    const posts = calls.filter((c) => c.url.endsWith("/activities"));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(
      "https://smba.trafficmanager.net/emea/v3/conversations/19%3Aabc%40thread.tacv2%3Bmessageid%3D1/activities",
    );
    expect(posts[0]!.body).toEqual({
      type: "message",
      textFormat: "markdown",
      text: "Hi! What can \\*Legal\\* help with?",
    });
    // Nothing is recorded or uploaded for a chat reply.
    expect(calls.some((c) => c.url.includes("/drives/"))).toBe(false);
  });
  it("fails without retrying when Teams is turned off", async () => {
    setup(false);
    const off = { ...settings(), teams_enabled: false };
    await expect(
      sendChatReply(memory.db, inbound, off, payload as never, "Hi!"),
    ).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(calls.some((c) => c.url.endsWith("/activities"))).toBe(false);
  });
});

describe("reading a Teams thread for a new request", () => {
  const graph = "https://graph.microsoft.com/v1.0/teams/group-1/channels/19%3Aabc%40thread.tacv2/messages/1";
  const settings = () => memory.rows("intake_automation")[0] as unknown as AutomationRow;
  const payload = {
    kind: "teams" as const,
    tenant_id: "tenant-1",
    service_url: "https://smba.trafficmanager.net/emea/",
    conversation_id: "19:abc@thread.tacv2;messageid=1",
    team_id: "team-1",
    aad_group_id: "group-1",
    channel_id: "19:abc@thread.tacv2",
    root_message_id: "1",
    team_name: null,
    channel_name: null,
    activity_id: "3",
    from: { id: "29:jane", aad_object_id: null, name: "Jane Business" },
    date: "2026-11-03T10:05:00Z",
    text: "please review it",
    files: [],
  };
  const root = {
    id: "1",
    createdDateTime: "2026-11-03T10:00:00Z",
    from: { user: { displayName: "Ana Sales" } },
    body: { content: "<p>Can someone check the <b>Acme NDA</b>?</p>" },
  };
  it("takes out only MikeGC's own mention, as Graph lists it", async () => {
    setup(false, (url) => {
      if (url === graph) return Response.json(root);
      if (url.startsWith(`${graph}/replies`))
        return Response.json({
          value: [
            {
              id: "3",
              createdDateTime: payload.date,
              from: { user: { displayName: "Jane Business" } },
              body: { content: '<at id="0">MikeGC</at> please ask <at id="1">Ben Ops</at> too' },
              mentions: [
                { id: 0, mentionText: "MikeGC", mentioned: { application: { id: appId } } },
                { id: 1, mentionText: "Ben Ops", mentioned: { user: { id: "u-ben" } } },
              ],
            },
          ],
        });
      return undefined;
    });
    const message = await teamsInboundMessage(settings(), { ...payload, completed: [] } as never);
    expect(message.text).toContain("Can someone check the Acme NDA?");
    expect(message.text).toContain("please ask Ben Ops too");
    expect(message.text).not.toContain("MikeGC");
  });
  it("ends with the signed mention when Graph's copy of the thread stops short of it", async () => {
    setup(false, (url) => {
      if (url === graph) return Response.json(root);
      if (url.startsWith(`${graph}/replies`)) return Response.json({ value: [] });
      return undefined;
    });
    const message = await teamsInboundMessage(settings(), { ...payload, completed: [] } as never);
    expect(message.text).toMatch(/Can someone check the Acme NDA\?[\s\S]*Jane Business, .*:\nplease review it$/);
  });
});

describe("reading Teams activities", () => {
  it("takes out the bot's own mention and reads the HTML as text", () => {
    const activity = teamsActivity.parse({
      type: "message",
      id: "1",
      serviceUrl: "https://smba.trafficmanager.net/emea/",
      from: { id: "29:jane" },
      conversation: { id: "19:abc;messageid=1" },
      text: "<at>MikeGC</at> please <b>review</b> the NDA<br>by Friday",
      entities: [{ type: "mention", text: "<at>MikeGC</at>", mentioned: { id: `28:${appId}` } }],
    });
    expect(teamsActivityText(activity, appId)).toBe("please review the NDA\nby Friday");
  });
  it("names a sharing URL the way Graph's shares API does", () => {
    expect(shareId("https://acme.sharepoint.com/a b")).toBe(
      `u!${Buffer.from("https://acme.sharepoint.com/a b").toString("base64url")}`,
    );
    expect(teamsEscape("a_b <c> [d](e)")).toBe("a\\_b &lt;c&gt; \\[d\\]\\(e\\)");
  });
});
