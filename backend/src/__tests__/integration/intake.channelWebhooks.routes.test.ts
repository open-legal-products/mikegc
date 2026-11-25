import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "../../modules/intake/__tests__/memoryDb";

// ---------------------------------------------------------------------------
// The channel webhooks the requester loop adds, through the real app: a
// Teams activity must carry a Bot Connector token signed by Bot Framework's
// keys, for the organization's bot and tenant, and is then a new request or a
// thread reply; Graph's notifications must echo the client state MikeGC set;
// and each organization's webhook URL has its own rate limit, so one busy
// Slack channel can't spend another organization's.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  process.env.RATE_LIMIT_SLACK_WEBHOOK_MAX = "3";
  // Every request in this file counts against the shared per-address ceiling.
  process.env.RATE_LIMIT_CHANNEL_WEBHOOK_IP_MAX = "40";
  process.env.RATE_LIMIT_GENERAL_MAX = "500";
  return { memory: null as unknown as { db: unknown }, enqueueDbJob: vi.fn() };
});
vi.mock("../../lib/supabase", () => ({
  createServerSupabase: () => mocks.memory.db,
}));
vi.mock("../../lib/dbq/enqueue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dbq/enqueue")>()),
  enqueueDbJob: mocks.enqueueDbJob,
}));
import { app } from "../../app";
import { setBotKeysForTests } from "../../modules/intake/intake.teams";

const org = "00000000-0000-4000-8000-000000000001";
const teamsWebhook = "00000000-0000-4000-8000-0000000000bb";
const graphWebhook = "00000000-0000-4000-8000-0000000000cc";
const appId = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
const serviceUrl = "https://smba.trafficmanager.net/emea/";
const conversation = "19:abc@thread.tacv2;messageid=1793610840000";
let memory: MemoryDb;
let jose: typeof import("jose", { with: { "resolution-mode": "import" } });
let signer: CryptoKey;
let stranger: CryptoKey;

beforeAll(async () => {
  jose = await import("jose");
  const keys = await jose.generateKeyPair("RS256", { extractable: true });
  signer = keys.privateKey as CryptoKey;
  stranger = (await jose.generateKeyPair("RS256")).privateKey as CryptoKey;
  const jwk = { ...(await jose.exportJWK(keys.publicKey)), kid: "bot-key", alg: "RS256" };
  setBotKeysForTests(jose.createLocalJWKSet({ keys: [jwk] }));
});
afterAll(() => setBotKeysForTests(null));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueueDbJob.mockResolvedValue({ id: "job-1", deduped: false });
  memory = memoryDb({
    intake_automation: [
      {
        org_id: org,
        teams_enabled: true,
        teams_webhook_id: teamsWebhook,
        teams_app_id: appId,
        teams_tenant_id: tenant,
        email_enabled: true,
        email_provider: "graph",
        email_webhook_id: graphWebhook,
        graph_client_state_hash: createHash("sha256").update("state-1").digest("hex"),
      },
    ],
    intake_inbound: [],
    intake_channel_links: [],
  });
  mocks.memory = memory;
});

async function token(claims: Record<string, unknown> = {}, key: CryptoKey = signer) {
  return new jose.SignJWT({ serviceUrl, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "bot-key" })
    .setIssuer("https://api.botframework.com")
    .setAudience((claims.aud as string) ?? appId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}
const activity = (overrides: Record<string, unknown> = {}) => ({
  type: "message",
  id: "1793610900000",
  timestamp: "2026-11-02T09:15:00.000Z",
  serviceUrl,
  channelId: "msteams",
  from: { id: "29:jane", name: "Jane Business", aadObjectId: "aad-jane" },
  conversation: { id: conversation, conversationType: "channel", tenantId: tenant },
  text: "<at>MikeGC</at> please review the Acme NDA",
  entities: [{ type: "mention", text: "<at>MikeGC</at>", mentioned: { id: `28:${appId}`, name: "MikeGC" } }],
  channelData: {
    tenant: { id: tenant },
    team: { id: "19:team@thread.tacv2", name: "Sales", aadGroupId: "group-1" },
    channel: { id: "19:abc@thread.tacv2", name: "Legal requests" },
  },
  ...overrides,
});
const post = async (body: unknown, auth?: string) =>
  request(app)
    .post(`/webhooks/intake/teams/${teamsWebhook}`)
    .set("Authorization", auth ?? `Bearer ${await token()}`)
    .send(body as object);

describe("the Teams webhook", () => {
  it("refuses a token not signed by Bot Framework, for another bot, or from another tenant", async () => {
    expect((await post(activity(), "")).status).toBe(403);
    expect((await post(activity(), `Bearer ${await token({}, stranger)}`)).status).toBe(403);
    expect((await post(activity(), `Bearer ${await token({ aud: "someone-else" })}`)).status).toBe(403);
    // A token for another service URL can't vouch for this one.
    expect(
      (await post(activity(), `Bearer ${await token({ serviceUrl: "https://evil.test/" })}`)).status,
    ).toBe(403);
    expect(
      (await post(activity({ channelData: { tenant: { id: "other-tenant" } } }))).status,
    ).toBe(403);
    expect(memory.rows("intake_inbound")).toEqual([]);
  });
  it("records a mention in a thread with no request as a new request", async () => {
    expect((await post(activity())).status).toBe(200);
    expect(memory.rows("intake_inbound")).toEqual([
      expect.objectContaining({
        source: "teams",
        kind: "request",
        external_id: "1793610900000",
        payload: expect.objectContaining({
          kind: "teams",
          tenant_id: tenant,
          conversation_id: conversation,
          root_message_id: "1793610840000",
          aad_group_id: "group-1",
          channel_name: "Legal requests",
          text: "please review the Acme NDA",
          from: { id: "29:jane", aad_object_id: "aad-jane", name: "Jane Business" },
        }),
      }),
    ]);
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, expect.objectContaining({ kind: "intake.agent" }));
  });
  it("records any person's message in a request's thread as its reply, once, and drops the rest", async () => {
    memory.rows("intake_channel_links").push({
      id: "link-1",
      org_id: org,
      request_id: "00000000-0000-4000-8000-000000000021",
      source: "teams",
      thread_key: `${tenant}:${conversation}`,
      address: {},
    });
    const reply = activity({ id: "1793610950000", text: "Acme is a customer.", entities: [] });
    expect((await post(reply)).status).toBe(200);
    expect((await post(reply)).status).toBe(200);
    for (const ignored of [
      activity({ id: "1", from: { id: `28:${appId}`, name: "MikeGC" } }),
      activity({ id: "2", type: "messageUpdate" }),
      activity({ id: "3", type: "conversationUpdate" }),
      activity({ id: "4", conversation: { id: "a:personal-chat", conversationType: "personal" } }),
    ])
      expect((await post(ignored)).status).toBe(200);
    expect(memory.rows("intake_inbound")).toEqual([
      expect.objectContaining({
        kind: "reply",
        source: "teams",
        external_id: "1793610950000",
        request_id: "00000000-0000-4000-8000-000000000021",
        payload: expect.objectContaining({ kind: "teams_reply", text: "Acme is a customer.", service_url: serviceUrl }),
      }),
    ]);
    // Chatter in a thread with no request, without a mention, is dropped.
    memory.tables.intake_channel_links = [];
    expect((await post(activity({ id: "5", entities: [] }))).status).toBe(200);
    expect(memory.rows("intake_inbound")).toHaveLength(1);
  });
});

describe("the Graph notification webhook", () => {
  const graph = () => request(app).post(`/webhooks/intake/graph/${graphWebhook}`);
  it("echoes the validation token as plain text when a subscription is made", async () => {
    const res = await graph().query({ validationToken: "Validation: token 1" }).send();
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/plain");
    expect(res.text).toBe("Validation: token 1");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("reads the mailbox for a notification with MikeGC's client state, and refuses the rest", async () => {
    expect((await graph().send({ value: [{ clientState: "guess", changeType: "created" }] })).status).toBe(403);
    expect(mocks.enqueueDbJob).not.toHaveBeenCalled();
    expect((await graph().send({ value: [{ clientState: "state-1", changeType: "created" }] })).status).toBe(202);
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, expect.objectContaining({
      kind: "intake.mailbox.poll",
      payload: { orgId: org, once: true, renew: false },
    }));
    // A lifecycle notification renews the subscription.
    await graph().send({ value: [{ clientState: "state-1", lifecycleEvent: "reauthorizationRequired" }] });
    expect(mocks.enqueueDbJob.mock.calls.at(-1)![1].payload).toMatchObject({ renew: true });
    expect((await request(app).post("/webhooks/intake/graph/00000000-0000-4000-8000-000000000099").send({ value: [] })).status).toBe(404);
  });
});

describe("webhook rate limits", () => {
  it("gives each organization's Slack URL its own budget", async () => {
    const slack = (id: string) => request(app).post(`/webhooks/intake/slack/${id}`).send("{}");
    const busy = "00000000-0000-4000-8000-0000000000d1";
    for (let i = 0; i < 3; i++) expect((await slack(busy)).status).not.toBe(429);
    expect((await slack(busy)).status).toBe(429);
    // Another organization's URL, from the same sending address, still gets through.
    expect((await slack("00000000-0000-4000-8000-0000000000d2")).status).not.toBe(429);
  });
  it("still caps one address that rotates webhook URLs", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) {
      const id = `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`;
      statuses.push((await request(app).post(`/webhooks/intake/teams/${id}`).send({})).status);
    }
    // Each URL is new, so only the per-address ceiling can refuse them.
    expect(statuses).toContain(429);
  });
});
