import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeAssignmentRule } from "@mike/contracts";
import { intakeRulesRpc, memoryDb, type MemoryDb } from "./memoryDb";

const mocks = vi.hoisted(() => ({
  memory: null as unknown as { db: unknown },
  gmailProfile: vi.fn(),
  gmailSendTest: vi.fn(),
  enqueueDbJob: vi.fn(),
  getEffectiveApiKeys: vi.fn(),
  envApiKeys: vi.fn(),
  getPlaybook: vi.fn(),
  getWorkflowDetail: vi.fn(),
  PlaybookRequestError: class extends Error {},
  userId: "",
}));
vi.mock("../../playbooks/playbooks.service", () => ({
  getPlaybook: mocks.getPlaybook,
  PlaybookRequestError: mocks.PlaybookRequestError,
  playbookFindingEdits: vi.fn(),
  reviewWithPlaybook: vi.fn(),
}));
vi.mock("../../workflows/workflows.service", () => ({
  getWorkflowDetail: mocks.getWorkflowDetail,
}));
vi.mock("../../user/user.service", () => ({
  getEffectiveApiKeys: mocks.getEffectiveApiKeys,
  envApiKeys: mocks.envApiKeys,
}));
vi.mock("../intake.gmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../intake.gmail")>()),
  gmailProfile: mocks.gmailProfile,
  gmailSendTest: mocks.gmailSendTest,
}));
vi.mock("../../../lib/dbq/enqueue", () => ({ enqueueDbJob: mocks.enqueueDbJob }));
vi.mock("../../../lib/supabase", () => ({
  createServerSupabase: () => mocks.memory.db,
}));
vi.mock("../../../middleware/auth", () => ({
  requireAuth: (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.locals.userId = mocks.userId;
    res.locals.userEmail = "olive@firm.test";
    next();
  },
}));
import { encryptString } from "../../../lib/mcp/client";
import { clearMicrosoftTokens } from "../intake.microsoft";
import {
  connectIntakeMailbox,
  disconnectIntakeMailbox,
  sendIntakeMailboxTest,
  getIntakeAutomation,
  normalizeDomains,
  slackBotToken,
  slackSigningSecret,
  updateIntakeAutomation,
  type AutomationRow,
} from "../intake.automation";
import { intakeRouter } from "../intake.routes";

const org = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const admin = "00000000-0000-4000-8000-000000000003";
const member = "00000000-0000-4000-8000-000000000004";
const outsider = "00000000-0000-4000-8000-000000000005";
const env = { ...process.env };
let memory: MemoryDb;
const scope = (actorId: string) => ({ orgId: org, actorId });
/** A rule without preprocessing, unless `extra` adds it. */
const rule = (
  condition: string,
  assignee_id: string,
  extra: Partial<IntakeAssignmentRule> = {},
): IntakeAssignmentRule => ({
  condition,
  assignee_id,
  preprocess: false,
  preprocess_with: null,
  ...extra,
});
const row = () => memory.rows("intake_automation")[0] as AutomationRow;
const app = express();
app.use(express.json());
app.use("/intake", intakeRouter);

beforeEach(() => {
  vi.clearAllMocks();
  clearMicrosoftTokens();
  delete process.env.INTAKE_GMAIL_SERVICE_ACCOUNT_KEY;
  mocks.enqueueDbJob.mockResolvedValue({ id: "job-1", deduped: false });
  process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-encryption-secret-for-intake";
  process.env.API_PUBLIC_URL = "https://app.example.com/api/";
  mocks.envApiKeys.mockReturnValue({});
  mocks.getEffectiveApiKeys.mockResolvedValue({ claude: "sk-org" });
  memory = memoryDb(
    {
      org_members: [
        { org_id: org, user_id: owner, role: "owner" },
        { org_id: org, user_id: admin, role: "admin" },
        { org_id: org, user_id: member, role: "member" },
      ],
    },
    intakeRulesRpc,
  );
  mocks.memory = memory;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ ok: true, team_id: "T1", team: "Acme", user_id: "UBOT" }),
    ),
  );
});
afterAll(() => {
  process.env = env;
  vi.unstubAllGlobals();
});

describe("who manages automated intake", () => {
  it.each([member, outsider])("refuses %s, who isn't an owner or admin", async (actor) => {
    for (const result of [
      await getIntakeAutomation(memory.db, scope(actor)),
      await updateIntakeAutomation(memory.db, scope(actor), { email_enabled: false }),
      await connectIntakeMailbox(memory.db, scope(actor), { provider: "gmail", mailbox: "intake@firm.test" }),
      await disconnectIntakeMailbox(memory.db, scope(actor)),
      await sendIntakeMailboxTest(memory.db, scope(actor)),
    ])
      expect(result).toMatchObject({ ok: false, kind: "forbidden" });
    expect(memory.rows("intake_automation")).toEqual([]);
  });
  it("shows an admin the settings, made on first read with the Slack events URL", async () => {
    const result = await getIntakeAutomation(memory.db, scope(admin));
    expect(result).toEqual({
      ok: true,
      data: {
        email: {
          enabled: false,
          provider: null,
          mailbox: null,
          allowed_domains: [],
          from_name: "Legal",
          graph: { tenant_id: null, client_id: null, secret_set: false },
          notification_url: `https://app.example.com/api/webhooks/intake/graph/${row().email_webhook_id}`,
          gmail: { client_id: null, key_set: false, deployment_key: false },
          status: { subscription_expires_at: null, last_read_at: null, error: null },
        },
        slack: {
          enabled: false,
          events_url: `https://app.example.com/api/webhooks/intake/slack/${row().slack_webhook_id}`,
          configured: false,
          team_id: null,
          team_name: null,
          bot_user_id: null,
          missing_scopes: [],
          message_events_seen: false,
        },
        teams: {
          enabled: false,
          events_url: `https://app.example.com/api/webhooks/intake/teams/${row().teams_webhook_id}`,
          configured: false,
          app_id: null,
          tenant_id: null,
          files_access: null,
        },
        models: {
          available: expect.arrayContaining(["claude-haiku-4-5", "claude-sonnet-5-5"]),
          triage: "claude-haiku-4-5",
          triage_available: true,
          preprocessing: "claude-sonnet-5-5",
          preprocessing_available: true,
        },
        rules: [],
        recent: [],
      },
    });
    // New settings start triage on a low-cost model and preprocessing on a
    // stronger one, each with a key, run as their maker.
    expect(row()).toMatchObject({
      triage_model: "claude-haiku-4-5",
      preprocessing_model: "claude-sonnet-5-5",
      configured_by: admin,
    });
    expect(mocks.getEffectiveApiKeys).toHaveBeenCalledWith(admin, org, memory.db);
  });
  it("starts without a model when none has a key, and says so", async () => {
    mocks.getEffectiveApiKeys.mockResolvedValue({});
    const result = await getIntakeAutomation(memory.db, scope(owner));
    expect(result.ok && result.data.models).toEqual({
      available: [],
      triage: null,
      triage_available: false,
      preprocessing: null,
      preprocessing_available: false,
    });
  });
  it("saves each model with a key, or none, and refuses one without", async () => {
    const chosen = await updateIntakeAutomation(memory.db, scope(owner), {
      triage_model: "claude-sonnet-5-5",
      preprocessing_model: "claude-opus-5-5",
    });
    expect(chosen).toMatchObject({
      ok: true,
      data: {
        models: {
          triage: "claude-sonnet-5-5",
          triage_available: true,
          preprocessing: "claude-opus-5-5",
          preprocessing_available: true,
        },
      },
    });
    for (const field of ["triage_model", "preprocessing_model"] as const)
      expect(
        await updateIntakeAutomation(memory.db, scope(owner), { [field]: "gpt-6.1-sol" }),
      ).toMatchObject({
        ok: false,
        kind: "validation",
        detail: "Choose a model your organization has a key for.",
      });
    expect(row()).toMatchObject({
      triage_model: "claude-sonnet-5-5",
      preprocessing_model: "claude-opus-5-5",
    });
    const cleared = await updateIntakeAutomation(memory.db, scope(owner), {
      preprocessing_model: null,
    });
    expect(cleared).toMatchObject({
      ok: true,
      data: {
        models: {
          triage: "claude-sonnet-5-5",
          preprocessing: null,
          preprocessing_available: false,
        },
      },
    });
  });
  it("offers the viewer's models, while the chosen ones run as whoever saved last", async () => {
    // The admin made the settings with an Anthropic key; the owner has only OpenAI's.
    mocks.getEffectiveApiKeys.mockImplementation(async (user: string) =>
      user === owner ? { openai: "sk-owner" } : { claude: "sk-org" },
    );
    await getIntakeAutomation(memory.db, scope(admin));
    const seen = await getIntakeAutomation(memory.db, scope(owner));
    expect(seen.ok && seen.data.models.available).not.toContain("claude-haiku-4-5");
    expect(seen.ok && seen.data.models.available.length).toBeGreaterThan(0);
    expect(seen).toMatchObject({
      ok: true,
      data: { models: { triage: "claude-haiku-4-5", triage_available: true } },
    });
    // Saving makes intake run as the owner, so a model they keep needs their
    // key too: changing triage alone leaves preprocessing on the admin's model.
    const pick = seen.ok ? seen.data.models.available[0]! : "";
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { triage_model: pick }),
    ).toMatchObject({
      ok: false,
      kind: "validation",
      detail:
        "AI preprocessing uses a model you don't have a key for, and saving makes intake run as you. Choose another model in Model Preferences first.",
    });
    // So does an unrelated save, which would otherwise quietly stop triage.
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { email_allowed_domains: ["acme.test"] }),
    ).toMatchObject({ ok: false, detail: expect.stringMatching(/^Triage uses a model/) });
    expect(row()).toMatchObject({ configured_by: admin, triage_model: "claude-haiku-4-5" });
    // What the owner is offered, they can save.
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { triage_model: pick, preprocessing_model: null }),
    ).toMatchObject({ ok: true, data: { models: { triage: pick, triage_available: true } } });
    expect(row()).toMatchObject({ configured_by: owner });
  });
  it("lists the 20 most recent messages without their content", async () => {
    memory.tables.intake_inbound = Array.from({ length: 22 }, (_, i) => ({
      id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
      org_id: org,
      source: i % 2 ? "slack" : "email",
      external_id: `m-${i}`,
      status: "done",
      payload: { text: "the message's own words" },
      request_id: null,
      error: null,
      created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
    }));
    const result = await getIntakeAutomation(memory.db, scope(owner));
    if (!result.ok) throw new Error("expected settings");
    expect(result.data.recent).toHaveLength(20);
    expect(result.data.recent[0]).toEqual({
      id: "00000000-0000-4000-8000-000000000121",
      source: "slack",
      kind: "request",
      status: "done",
      error: null,
      request_id: null,
      created_at: new Date(Date.UTC(2026, 10, 1, 0, 21)).toISOString(),
    });
    expect(JSON.stringify(result.data)).not.toContain("the message's own words");
  });
});

describe("saving Slack's credentials", () => {
  it("encrypts both secrets, checks the token with Slack and never returns them", async () => {
    const result = await updateIntakeAutomation(memory.db, scope(admin), {
      slack_signing_secret: " signing-secret-1 ",
      slack_bot_token: "xoxb-123-abc",
      slack_enabled: true,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        slack: {
          enabled: true,
          configured: true,
          team_id: "T1",
          team_name: "Acme",
          bot_user_id: "UBOT",
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/signing-secret-1|xoxb-123-abc/);
    expect(JSON.stringify(memory.tables)).not.toMatch(/signing-secret-1|xoxb-123-abc/);
    expect(slackSigningSecret(row())).toBe("signing-secret-1");
    expect(slackBotToken(row())).toBe("xoxb-123-abc");
    expect(row().configured_by).toBe(admin);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/auth.test");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-123-abc");
  });
  it("turns Slack on with the save that completes its setup, also across saves", async () => {
    // The page shows Slack's switch only once it is set up, so the save that
    // stores the last secret turns it on, whichever came first.
    await updateIntakeAutomation(memory.db, scope(admin), { slack_signing_secret: "signing-secret-1" });
    expect(row().slack_enabled).toBe(false);
    const result = await updateIntakeAutomation(memory.db, scope(admin), { slack_bot_token: "xoxb-123-abc" });
    expect(result).toMatchObject({ ok: true, data: { slack: { enabled: true, configured: true } } });
    // Once set up, a later save leaves the switch to the person.
    await updateIntakeAutomation(memory.db, scope(admin), { slack_enabled: false });
    await updateIntakeAutomation(memory.db, scope(admin), { slack_bot_token: "xoxb-456-def" });
    expect(row().slack_enabled).toBe(false);
  });
  it("rejects a token Slack refuses, saving nothing", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ok: false, error: "invalid_auth" }));
    const result = await updateIntakeAutomation(memory.db, scope(owner), {
      slack_bot_token: "xoxb-revoked",
      email_allowed_domains: ["acme.test"],
    });
    expect(result).toMatchObject({ ok: false, kind: "validation", code: "slack_token_invalid" });
    expect(row()).toMatchObject({ email_allowed_domains: [], slack_bot_token_encrypted: null });
  });
  it("says so when Slack can't be reached", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { slack_bot_token: "xoxb-1" }),
    ).toMatchObject({ ok: false, kind: "unavailable" });
  });
  it("won't turn a channel on before it is set up", async () => {
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { slack_enabled: true }),
    ).toMatchObject({ ok: false, kind: "validation" });
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { email_enabled: true }),
    ).toMatchObject({ ok: false, kind: "validation" });
    expect(row()).toMatchObject({ slack_enabled: false, email_enabled: false });
  });
  it("can't save secrets without the server's encryption secret", async () => {
    delete process.env.MCP_CONNECTORS_ENCRYPTION_SECRET;
    delete process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { slack_signing_secret: "s" }),
    ).toMatchObject({ ok: false, kind: "unavailable" });
  });
});

/** A Microsoft token whose payload grants `roles`, as Entra issues one. */
const msToken = (roles: string[] = []) =>
  `h.${Buffer.from(JSON.stringify({ roles })).toString("base64url")}.s`;

describe("the intake mailbox", () => {
  it("connects Microsoft 365: checks the mailbox, starts at now, subscribes and starts reading", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        const body = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null;
        calls.push({ url: target, method: init?.method ?? "GET", body });
        if (target.startsWith("https://login.microsoftonline.com/"))
          return Response.json({ access_token: msToken(), expires_in: 3600 });
        if (target.includes("/mailFolders/inbox")) return Response.json({ id: "inbox" });
        if (target.includes("/messages/delta"))
          return Response.json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=1" });
        if (target.endsWith("/subscriptions"))
          return Response.json({ id: "sub-1", expirationDateTime: "2026-11-06T10:00:00Z" });
        if (target.endsWith("/sendMail")) return new Response(null, { status: 202 });
        return Response.json({}, { status: 404 });
      }),
    );
    const result = await connectIntakeMailbox(
      memory.db,
      { ...scope(owner), userEmail: "olive@firm.test" },
      {
        provider: "graph",
        mailbox: "Intake@Firm.test",
        tenant_id: "tenant-1",
        client_id: "client-1",
        client_secret: "graph-secret",
      },
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        email: {
          enabled: true,
          provider: "graph",
          mailbox: "intake@firm.test",
          // The sender domains start with the address's own.
          allowed_domains: ["firm.test"],
          graph: { tenant_id: "tenant-1", client_id: "client-1", secret_set: true },
          status: { subscription_expires_at: "2026-11-06T10:00:00Z", error: null },
        },
      },
    });
    // Mail already there isn't recorded: the first read starts now.
    expect(calls.find((c) => c.url.includes("/messages/delta"))?.url).toMatch(/receivedDateTime%20ge%20/);
    const subscription = JSON.parse(String(calls.find((c) => c.url.endsWith("/subscriptions"))!.body));
    expect(subscription).toMatchObject({
      changeType: "created",
      resource: "users/intake@firm.test/mailFolders('Inbox')/messages",
      notificationUrl: `https://app.example.com/api/webhooks/intake/graph/${row().email_webhook_id}`,
    });
    // Only the client state's hash is kept; the secret is encrypted.
    expect(row().graph_client_state_hash).toBe(
      createHash("sha256").update(subscription.clientState).digest("hex"),
    );
    expect(JSON.stringify(memory.tables)).not.toContain("graph-secret");
    expect(row().graph_delta_link).toBe("https://graph.microsoft.com/v1.0/delta?token=1");
    // Reading starts, and the admin gets a test email.
    expect(mocks.enqueueDbJob).toHaveBeenCalledWith(memory.db, expect.objectContaining({
      kind: "intake.mailbox.poll",
      dedupeKey: `intake.mailbox.poll:${org}`,
    }));
    expect(calls.some((c) => c.url.endsWith("/users/intake%40firm.test/sendMail"))).toBe(true);
  });
  it("says what to fix when Microsoft refuses the app", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).startsWith("https://login.microsoftonline.com/")
          ? Response.json({ error: "invalid_client" }, { status: 401 })
          : Response.json({}),
      ),
    );
    const result = await connectIntakeMailbox(memory.db, scope(owner), {
      provider: "graph",
      mailbox: "intake@firm.test",
      tenant_id: "tenant-1",
      client_id: "client-1",
      client_secret: "wrong",
    });
    expect(result).toMatchObject({ ok: false, kind: "validation", detail: expect.stringMatching(/tenant ID, client ID and secret/) });
    expect(row().email_provider).toBeNull();
  });
  it("connects Google Workspace from the mailbox's current history, with the deployment's service account", async () => {
    // Neither the organization nor the deployment has a service account.
    expect(
      await connectIntakeMailbox(memory.db, scope(owner), { provider: "gmail", mailbox: "intake@firm.test" }),
    ).toMatchObject({ ok: false, kind: "validation", detail: "Paste the service account's JSON key." });
    process.env.INTAKE_GMAIL_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "mikegc@project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----",
      client_id: "1234567890",
    });
    mocks.gmailProfile.mockResolvedValue({ emailAddress: "intake@firm.test", historyId: "9001" });
    const result = await connectIntakeMailbox(
      memory.db,
      { ...scope(owner), userEmail: "olive@firm.test" },
      { provider: "gmail", mailbox: "intake@firm.test" },
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        email: {
          provider: "gmail",
          enabled: true,
          gmail: { client_id: "1234567890", key_set: false, deployment_key: true },
        },
      },
    });
    expect(row().gmail_history_id).toBe("9001");
    expect(row().gmail_service_account_key_encrypted).toBeNull();
    const deployment = expect.objectContaining({
      address: "intake@firm.test",
      account: expect.objectContaining({ client_email: "mikegc@project.iam.gserviceaccount.com" }),
    });
    expect(mocks.gmailProfile).toHaveBeenCalledWith(deployment);
    expect(mocks.gmailSendTest).toHaveBeenCalledWith(deployment, "olive@firm.test", "Legal");
    // A test email on request, then disconnecting stops email.
    expect(await sendIntakeMailboxTest(memory.db, { ...scope(owner), userEmail: "olive@firm.test" })).toEqual({
      ok: true,
      data: { sent_to: "olive@firm.test" },
    });
    expect(await disconnectIntakeMailbox(memory.db, scope(owner))).toMatchObject({
      ok: true,
      data: { email: { enabled: false, provider: null } },
    });
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { email_enabled: true }),
    ).toMatchObject({ ok: false, kind: "validation" });
  });
  it("ends the Outlook subscription when the mailbox moves to Google Workspace", async () => {
    await getIntakeAutomation(memory.db, scope(owner));
    const secret = encryptString("graph-secret");
    Object.assign(row(), {
      email_provider: "graph",
      email_mailbox: "intake@firm.test",
      graph_tenant_id: "tenant-1",
      graph_client_id: "client-1",
      graph_client_secret_encrypted: secret.encrypted,
      graph_client_secret_iv: secret.iv,
      graph_client_secret_tag: secret.tag,
      graph_subscription_id: "sub-1",
      graph_client_state_hash: "hash",
      graph_delta_link: "https://graph.microsoft.com/v1.0/delta?token=1",
    });
    process.env.INTAKE_GMAIL_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "mikegc@project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----",
    });
    mocks.gmailProfile.mockResolvedValue({ emailAddress: "intake@firm.test", historyId: "9001" });
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? "GET" });
        return String(url).startsWith("https://login.microsoftonline.com/")
          ? Response.json({ access_token: "h.e30.s", expires_in: 3600 })
          : new Response(null, { status: 204 });
      }),
    );
    // A switch that isn't saved leaves the Outlook subscription running.
    memory.intercept = ({ table, op }) =>
      table === "intake_automation" && op === "update" ? { code: "08006", message: "connection lost" } : null;
    expect(
      await connectIntakeMailbox(memory.db, scope(owner), { provider: "gmail", mailbox: "intake@firm.test" }),
    ).toMatchObject({ ok: false });
    memory.intercept = undefined;
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const result = await connectIntakeMailbox(memory.db, scope(owner), { provider: "gmail", mailbox: "intake@firm.test" });
    expect(result).toMatchObject({ ok: true, data: { email: { provider: "gmail" } } });
    expect(calls).toContainEqual({ url: "https://graph.microsoft.com/v1.0/subscriptions/sub-1", method: "DELETE" });
    expect(row()).toMatchObject({
      graph_subscription_id: null,
      graph_client_state_hash: null,
      graph_delta_link: null,
      gmail_history_id: "9001",
    });
  });
  it("won't turn email on over a disconnect that lands during the save", async () => {
    await getIntakeAutomation(memory.db, scope(owner));
    Object.assign(row(), { email_provider: "gmail", email_mailbox: "intake@firm.test", email_enabled: false });
    // The disconnect commits after the save read the row, before it writes.
    memory.intercept = ({ table, op }) => {
      if (table === "intake_automation" && op === "update") row().email_provider = null;
      return null;
    };
    const result = await updateIntakeAutomation(memory.db, scope(owner), { email_enabled: true });
    memory.intercept = undefined;
    expect(result).toMatchObject({ ok: false, kind: "validation", detail: "Connect the intake mailbox before turning email on." });
    expect(row().email_enabled).toBe(false);
  });
  it("connects Gmail with the organization's own service account, kept encrypted and never shown", async () => {
    const key = {
      type: "service_account",
      client_email: "intake@firm-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----\n",
      client_id: "987654321",
    };
    // What isn't a service account's key is refused before Google is asked.
    expect(
      await connectIntakeMailbox(memory.db, scope(owner), {
        provider: "gmail",
        mailbox: "intake@firm.test",
        service_account_key: '{"client_email": "x"}',
      }),
    ).toMatchObject({ ok: false, kind: "validation", detail: expect.stringMatching(/JSON key/) });
    // Nor is a key without the numeric client ID Google Admin delegates to:
    // the account's email would be shown in its place, and the console
    // doesn't take it.
    expect(
      await connectIntakeMailbox(memory.db, scope(owner), {
        provider: "gmail",
        mailbox: "intake@firm.test",
        service_account_key: JSON.stringify({ ...key, client_id: undefined }),
      }),
    ).toMatchObject({ ok: false, kind: "validation", detail: expect.stringMatching(/JSON key/) });
    expect(mocks.gmailProfile).not.toHaveBeenCalled();

    mocks.gmailProfile.mockResolvedValue({ emailAddress: "intake@firm.test", historyId: "42" });
    const result = await connectIntakeMailbox(memory.db, scope(owner), {
      provider: "gmail",
      mailbox: "intake@firm.test",
      service_account_key: JSON.stringify(key, null, 2),
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        email: {
          provider: "gmail",
          gmail: { client_id: "987654321", key_set: true, deployment_key: false },
        },
      },
    });
    // Encrypted at rest, and never sent back.
    expect(row().gmail_service_account_key_encrypted).toEqual(expect.any(String));
    expect(row().gmail_service_account_key_encrypted).not.toContain("PRIVATE KEY");
    expect(row().gmail_service_account_id).toBe("987654321");
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    const own = expect.objectContaining({
      address: "intake@firm.test",
      account: expect.objectContaining({ client_email: key.client_email }),
    });
    expect(mocks.gmailProfile).toHaveBeenLastCalledWith(own);

    // Reconnecting without a key keeps the saved one, even with a deployment key.
    process.env.INTAKE_GMAIL_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "mikegc@project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----",
    });
    expect(
      await connectIntakeMailbox(memory.db, scope(owner), { provider: "gmail", mailbox: "intake@firm.test" }),
    ).toMatchObject({ ok: true, data: { email: { gmail: { client_id: "987654321", key_set: true } } } });
    expect(mocks.gmailProfile).toHaveBeenLastCalledWith(own);

    // A saved key that can no longer be read isn't stood in for by the
    // deployment's account: the organization chose its own.
    row().gmail_service_account_key_tag = Buffer.from("not the tag").toString("base64");
    mocks.gmailProfile.mockClear();
    expect(
      await connectIntakeMailbox(memory.db, scope(owner), { provider: "gmail", mailbox: "intake@firm.test" }),
    ).toMatchObject({ ok: false, kind: "validation", detail: "Paste the service account's JSON key." });
    expect(mocks.gmailProfile).not.toHaveBeenCalled();
  });
});

describe("Teams", () => {
  const teams = {
    teams_app_id: "11111111-1111-4111-8111-111111111111",
    teams_tenant_id: "22222222-2222-4222-8222-222222222222",
    teams_client_secret: "teams-secret",
  };
  it("checks the app's credentials with Microsoft and detects document access", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const scope = new URLSearchParams(String(init?.body)).get("scope");
      return Response.json({
        access_token: msToken(scope === "https://graph.microsoft.com/.default" ? ["Sites.Selected"] : []),
        expires_in: 3600,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await updateIntakeAutomation(memory.db, scope(owner), { ...teams, teams_enabled: true });
    expect(result).toMatchObject({
      ok: true,
      data: {
        teams: {
          enabled: true,
          configured: true,
          app_id: teams.teams_app_id,
          tenant_id: teams.teams_tenant_id,
          files_access: true,
          events_url: `https://app.example.com/api/webhooks/intake/teams/${row().teams_webhook_id}`,
        },
      },
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://login.microsoftonline.com/${teams.teams_tenant_id}/oauth2/v2.0/token`,
    );
    expect(JSON.stringify(memory.tables)).not.toContain("teams-secret");
  });
  it("turns Teams on with the save that completes its setup, after the secret was saved first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ access_token: msToken([]), expires_in: 3600 })),
    );
    await updateIntakeAutomation(memory.db, scope(owner), { teams_client_secret: teams.teams_client_secret });
    expect(row().teams_enabled).toBe(false);
    const result = await updateIntakeAutomation(memory.db, scope(owner), {
      teams_app_id: teams.teams_app_id,
      teams_tenant_id: teams.teams_tenant_id,
    });
    expect(result).toMatchObject({ ok: true, data: { teams: { enabled: true, configured: true } } });
  });
  it("refuses credentials Microsoft refuses, and won't turn Teams on without them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_client" }, { status: 401 })));
    expect(await updateIntakeAutomation(memory.db, scope(owner), teams)).toMatchObject({
      ok: false,
      kind: "validation",
      code: "teams_credentials_invalid",
    });
    expect(await updateIntakeAutomation(memory.db, scope(owner), { teams_enabled: true })).toMatchObject({
      ok: false,
      kind: "validation",
    });
    expect(row().teams_enabled).toBe(false);
  });
});

describe("one Entra app for Outlook and Teams", () => {
  const app = {
    tenant: "22222222-2222-4222-8222-222222222222",
    client: "11111111-1111-4111-8111-111111111111",
    secret: "shared-secret",
  };
  /** Microsoft: tokens for anyone, and an Outlook mailbox that opens. */
  const tokenRequests: URLSearchParams[] = [];
  const stubMicrosoft = () => {
    tokenRequests.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        if (target.startsWith("https://login.microsoftonline.com/")) {
          tokenRequests.push(new URLSearchParams(String(init?.body)));
          return Response.json({ access_token: msToken(), expires_in: 3600 });
        }
        if (target.includes("/mailFolders/inbox")) return Response.json({ id: "inbox" });
        if (target.includes("/messages/delta"))
          return Response.json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=1" });
        if (target.endsWith("/subscriptions"))
          return Response.json({ id: "sub-1", expirationDateTime: "2026-11-06T10:00:00Z" });
        if (target.endsWith("/sendMail")) return new Response(null, { status: 202 });
        return Response.json({}, { status: 404 });
      }),
    );
  };

  it("connects Outlook with the Teams app, keeping its own encrypted copy of the secret", async () => {
    stubMicrosoft();
    await updateIntakeAutomation(memory.db, scope(owner), {
      teams_app_id: app.client,
      teams_tenant_id: app.tenant,
      teams_client_secret: app.secret,
    });
    tokenRequests.length = 0;
    const result = await connectIntakeMailbox(memory.db, scope(owner), {
      provider: "graph",
      mailbox: "intake@firm.test",
      use_teams_app: true,
    });
    expect(result).toMatchObject({
      ok: true,
      data: { email: { provider: "graph", graph: { tenant_id: app.tenant, client_id: app.client, secret_set: true } } },
    });
    // Checked with the Teams app's own credentials.
    expect(tokenRequests[0]!.get("client_id")).toBe(app.client);
    expect(tokenRequests[0]!.get("client_secret")).toBe(app.secret);
    // Its own ciphertext, so changing Teams later doesn't change Outlook.
    expect(row().graph_client_secret_encrypted).toBeTruthy();
    expect(row().graph_client_secret_encrypted).not.toBe(row().teams_client_secret_encrypted);
    expect(JSON.stringify(memory.tables)).not.toContain(app.secret);
  });

  it("won't reuse a Teams app that isn't set up, or mix it with typed details", async () => {
    stubMicrosoft();
    expect(
      await connectIntakeMailbox(memory.db, scope(owner), { provider: "graph", mailbox: "intake@firm.test", use_teams_app: true }),
    ).toMatchObject({ ok: false, kind: "validation", detail: "Set up Teams first, or enter the Entra app's details." });
    expect(
      await connectIntakeMailbox(memory.db, scope(owner), {
        provider: "graph",
        mailbox: "intake@firm.test",
        use_teams_app: true,
        client_secret: "typed",
      }),
    ).toMatchObject({ ok: false, kind: "validation", detail: expect.stringMatching(/not both/) });
    expect(row().email_provider).toBeNull();
  });

  it("sets Teams up with the connected Outlook app, checked and turned on", async () => {
    stubMicrosoft();
    await connectIntakeMailbox(memory.db, scope(owner), {
      provider: "graph",
      mailbox: "intake@firm.test",
      tenant_id: app.tenant,
      client_id: app.client,
      client_secret: app.secret,
    });
    tokenRequests.length = 0;
    const result = await updateIntakeAutomation(memory.db, scope(owner), { teams_use_outlook_app: true });
    expect(result).toMatchObject({
      ok: true,
      data: { teams: { configured: true, enabled: true, app_id: app.client, tenant_id: app.tenant } },
    });
    // Checked with Microsoft as typed credentials are.
    expect(tokenRequests.some((r) => r.get("client_id") === app.client && r.get("client_secret") === app.secret)).toBe(true);
    expect(row().teams_client_secret_encrypted).not.toBe(row().graph_client_secret_encrypted);
    expect(JSON.stringify(memory.tables)).not.toContain(app.secret);
  });

  it("won't copy an Outlook app that isn't connected, or mix it with typed details", async () => {
    stubMicrosoft();
    expect(await updateIntakeAutomation(memory.db, scope(owner), { teams_use_outlook_app: true })).toMatchObject({
      ok: false,
      kind: "validation",
      detail: "Connect Outlook first, or enter the Teams app's details.",
    });
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), { teams_use_outlook_app: true, teams_app_id: app.client }),
    ).toMatchObject({ ok: false, kind: "validation", detail: expect.stringMatching(/not both/) });
    expect(row().teams_app_id).toBeNull();
  });
});

describe("asking requesters", () => {
  it("names the Slack scopes the requester loop still needs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: true, team_id: "T1", team: "Acme", user_id: "UBOT" },
          { headers: { "x-oauth-scopes": "app_mentions:read,chat:write,channels:history" } },
        ),
      ),
    );
    const saved = await updateIntakeAutomation(memory.db, scope(owner), {
      slack_signing_secret: "s",
      slack_bot_token: "xoxb-1",
      slack_enabled: true,
    });
    expect(saved.ok && saved.data.slack.missing_scopes).toEqual(["files:write", "chat:write.customize"]);
  });
});

describe("other settings", () => {
  it("normalizes sender domains", () => {
    expect(normalizeDomains(["@Example.COM", "example.com", " sub.acme.test ", ""])).toEqual({
      ok: true,
      data: ["example.com", "sub.acme.test"],
    });
    for (const bad of ["not a domain", "localhost", "a@b.com", "-x.com"])
      expect(normalizeDomains([bad]), bad).toMatchObject({ ok: false, kind: "validation" });
  });
  it("saves domains", async () => {
    const saved = await updateIntakeAutomation(memory.db, scope(owner), {
      email_allowed_domains: ["Acme.test"],
    });
    expect(saved).toMatchObject({
      ok: true,
      data: { email: { allowed_domains: ["acme.test"] } },
    });
  });
  it("replaces the rules in order, assigning to members only", async () => {
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), {
        rules: [rule("NDAs", outsider)],
      }),
    ).toMatchObject({ ok: false, kind: "validation" });
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), {
        rules: [rule(" \u0000 ", member)],
      }),
    ).toMatchObject({ ok: false, kind: "validation" });
    await updateIntakeAutomation(memory.db, scope(owner), {
      rules: [
        rule(" The request is about an NDA ", member),
        rule("Employment questions", admin),
      ],
    });
    // A member can have several rules, and a later save replaces them all.
    const result = await updateIntakeAutomation(memory.db, scope(owner), {
      rules: [
        rule("Disputes", admin),
        rule("The request is about an NDA", member),
        rule("Anything about hiring", admin),
      ],
    });
    expect(result.ok && result.data.rules).toEqual([
      rule("Disputes", admin),
      rule("The request is about an NDA", member),
      rule("Anything about hiring", admin),
    ]);
    expect(memory.rows("intake_assignment_rules")).toHaveLength(3);
    await updateIntakeAutomation(memory.db, scope(owner), { rules: [] });
    expect(memory.rows("intake_assignment_rules")).toEqual([]);
  });
  it("saves each rule's preprocessing, if the admin saving can open its workflow or playbook", async () => {
    mocks.getPlaybook.mockImplementation(async (userId: string, id: string) => {
      if (id === "pb-1" && userId === owner) return { name: "NDA playbook" };
      throw new mocks.PlaybookRequestError("Playbook not found.");
    });
    mocks.getWorkflowDetail.mockImplementation(
      async (_db: unknown, { workflowId }: { workflowId: string }) =>
        workflowId === "wf-1"
          ? { ok: true, body: { metadata: { title: "Answer questions", type: "assistant" }, skill_md: "Answer." } }
          : workflowId === "wf-table"
            ? { ok: true, body: { metadata: { title: "Extract", type: "tabular" } } }
            : { ok: false },
    );
    const withRef = (kind: "workflow" | "playbook", id: string) =>
      rule("NDAs", member, { preprocess: true, preprocess_with: { kind, id } });
    for (const [bad, message] of [
      [withRef("playbook", "pb-hidden"), /playbook you can open/],
      [withRef("workflow", "wf-missing"), /assistant workflow you can open/],
      // A tabular workflow has no instructions to follow.
      [withRef("workflow", "wf-table"), /assistant workflow you can open/],
    ] as const)
      expect(
        await updateIntakeAutomation(memory.db, scope(owner), { rules: [bad] }),
      ).toMatchObject({ ok: false, kind: "validation", detail: expect.stringMatching(message) });
    expect(memory.rows("intake_assignment_rules")).toEqual([]);

    const saved = await updateIntakeAutomation(memory.db, scope(owner), {
      rules: [
        withRef("playbook", "pb-1"),
        rule("Employment", admin, {
          preprocess: true,
          preprocess_with: { kind: "workflow", id: "wf-1", name: "ignored" },
        }),
        // Preprocessing on with nothing to follow answers in general terms.
        rule("Anything else", admin, { preprocess: true }),
      ],
    });
    expect(saved.ok && saved.data.rules).toEqual([
      rule("NDAs", member, {
        preprocess: true,
        preprocess_with: { kind: "playbook", id: "pb-1", name: "NDA playbook" },
      }),
      rule("Employment", admin, {
        preprocess: true,
        preprocess_with: { kind: "workflow", id: "wf-1", name: "Answer questions" },
      }),
      rule("Anything else", admin, { preprocess: true }),
    ]);
    expect(memory.rows("intake_assignment_rules")[0]).toMatchObject({
      preprocess: true,
      preprocess_kind: "playbook",
      preprocess_ref: "pb-1",
    });

    // Another admin who can't open the playbook still changes the rest, and
    // sees it unnamed.
    const other = await updateIntakeAutomation(memory.db, scope(admin), {
      rules: [withRef("playbook", "pb-1"), rule("Leases", member)],
    });
    expect(other.ok && other.data.rules[0]?.preprocess_with).toEqual({
      kind: "playbook",
      id: "pb-1",
      name: null,
    });
  });
  it("keeps the saved rules when the new ones can't be written", async () => {
    await updateIntakeAutomation(memory.db, scope(owner), {
      rules: [rule("NDAs", member)],
    });
    // The rules are replaced in one database transaction, which rolls back.
    vi.spyOn(memory.db, "rpc").mockResolvedValueOnce({
      data: null,
      error: { message: "database unavailable" },
    } as never);
    expect(
      await updateIntakeAutomation(memory.db, scope(owner), {
        email_allowed_domains: ["acme.test"],
        rules: [rule("Disputes", admin)],
      }),
    ).toMatchObject({ ok: false });
    // Nothing in the save took: not the setting sent with the rules either.
    expect(row().email_allowed_domains ?? []).toEqual([]);
    expect(memory.rows("intake_assignment_rules")).toMatchObject([
      { condition: "NDAs", assignee_id: member, position: 0 },
    ]);
  });
});

describe("automation routes", () => {
  const path = `/intake/${org}/automation`;
  it("validates the body before the service and names what to fix", async () => {
    mocks.userId = owner;
    for (const [body, detail] of [
      [{ slack_bot_token: "xoxp-user-token" }, /xoxb-/],
      [{ slack_signing_secret: "x".repeat(301) }, /signing secret/],
      // Intake keeps no timezone, so there is none to set.
      [{ default_timezone: "Europe/London" }, /Check the automation settings/],
      [{ rules: [rule("", member)] }, /1 to 500/],
      [{ rules: [{ condition: "NDAs", assignee_id: "someone" }] }, /a member/],
      [{ email_allowed_domains: Array(51).fill("a.test") }, /50/],
      [{ unexpected: true }, /Check the automation settings/],
    ] as const) {
      const res = await request(app).patch(path).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.detail).toMatch(detail);
    }
    expect(memory.rows("intake_automation")).toEqual([]);
  });
  it("answers a member with 403 and an admin with the settings", async () => {
    mocks.userId = member;
    expect((await request(app).get(path)).status).toBe(403);
    expect((await request(app).post(`${path}/mailbox/test`)).status).toBe(403);
    expect((await request(app).delete(`${path}/mailbox`)).status).toBe(403);
    mocks.userId = admin;
    const res = await request(app).patch(path).send({ email_allowed_domains: ["acme.test"] });
    expect(res.status).toBe(200);
    expect(res.body.email.allowed_domains).toEqual(["acme.test"]);
    // Triage can't be switched off: it runs whenever a model is available.
    const off = await request(app).patch(path).send({ triage_enabled: false });
    expect(off.status).toBe(400);
    const bad = await request(app).post(`${path}/mailbox`).send({ provider: "imap", mailbox: "x@y.test" });
    expect(bad.status).toBe(400);
  });
});
