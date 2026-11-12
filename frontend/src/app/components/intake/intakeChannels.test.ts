import { describe, expect, it, vi } from "vitest";
import type { IntakeAutomationSettings } from "@mike/contracts";

vi.mock("@/app/contexts/WorkspaceContext", () => ({
  PERSONAL_WORKSPACE: "personal",
}));

import { intakeAutomationDraft } from "./intakeAutomation";
import {
  intakeServiceAccountClientId,
  intakeChannelMailProvider,
  intakeChannelSummary,
  intakeMailboxConnection,
  intakeMailboxForm,
  intakeMailboxFormProblem,
  intakeOutlookApp,
} from "./intakeChannels";
import { intakeChannelChanges } from "./IntakeChannelSettings";

const saved = (): IntakeAutomationSettings => ({
  email: {
    enabled: true,
    provider: "gmail",
    mailbox: "intake@firm.test",
    allowed_domains: ["firm.test"],
    from_name: "Legal",
    graph: { tenant_id: null, client_id: null, secret_set: false },
    notification_url: "https://api.example.test/webhooks/intake/graph/1",
    gmail: { client_id: "1122", key_set: true, deployment_key: false },
    status: { subscription_expires_at: null, last_read_at: null, error: null },
  },
  slack: {
    enabled: false,
    events_url: "https://api.example.test/webhooks/intake/slack/1",
    configured: true,
    team_id: "T1",
    team_name: null,
    bot_user_id: "U1",
    missing_scopes: [],
    message_events_seen: false,
  },
  teams: {
    enabled: true,
    events_url: "https://api.example.test/webhooks/intake/teams/1",
    configured: true,
    app_id: "app",
    tenant_id: "tenant",
    files_access: true,
  },
  models: {
    available: [],
    triage: null,
    triage_available: false,
    preprocessing: null,
    preprocessing_available: false,
  },
  rules: [],
  recent: [],
});

describe("intakeChannelSummary", () => {
  it("says whether each channel is set up, and whether it is on", () => {
    const settings = saved();
    expect(intakeChannelSummary(settings, "gmail")).toEqual({
      configured: true,
      enabled: true,
    });
    expect(intakeChannelSummary(settings, "slack")).toEqual({
      configured: true,
      enabled: false,
    });
    expect(intakeChannelSummary(settings, "teams")).toEqual({
      configured: true,
      enabled: true,
    });
  });

  it("sets up only the mail channel whose provider has the mailbox", () => {
    const settings = saved();
    // Gmail has it, so Outlook is not set up, and never reads as on.
    expect(intakeChannelSummary(settings, "outlook")).toEqual({
      configured: false,
      enabled: false,
    });
    settings.email = { ...settings.email, provider: null, mailbox: null };
    settings.slack = { ...settings.slack, enabled: true, configured: false };
    settings.teams = { ...settings.teams, configured: false };
    for (const channel of ["outlook", "gmail", "slack", "teams"] as const)
      expect(intakeChannelSummary(settings, channel)).toEqual({
        configured: false,
        enabled: false,
      });
  });

  it("maps each mail channel to its provider, and the chat channels to none", () => {
    expect(intakeChannelMailProvider("outlook")).toBe("graph");
    expect(intakeChannelMailProvider("gmail")).toBe("gmail");
    expect(intakeChannelMailProvider("slack")).toBeNull();
    expect(intakeChannelMailProvider("teams")).toBeNull();
  });
});

describe("the mailbox connect form", () => {
  it("starts from what is saved for the same provider, never the secret", () => {
    const email = {
      ...saved().email,
      provider: "graph" as const,
      mailbox: "intake@firm.test",
      graph: { tenant_id: "t", client_id: "c", secret_set: true },
    };
    expect(intakeMailboxForm("graph", email)).toEqual({
      provider: "graph",
      mailbox: "intake@firm.test",
      tenantId: "t",
      clientId: "c",
      clientSecret: "",
      useTeamsApp: false,
      serviceAccountKey: "",
    });
    // Reconnecting keeps the saved details, even with Teams set up.
    expect(intakeMailboxForm("graph", email, true).useTeamsApp).toBe(false);
    expect(intakeMailboxForm("gmail", email).mailbox).toBe("");
  });

  it("starts a first Outlook connection with the Teams app when Teams is set up", () => {
    const email = saved().email;
    expect(intakeMailboxForm("graph", email, true).useTeamsApp).toBe(true);
    expect(intakeMailboxForm("graph", email, false).useTeamsApp).toBe(false);
    expect(intakeMailboxForm("gmail", email, true).useTeamsApp).toBe(false);
    const form = intakeMailboxForm("graph", email, true);
    // Only the address is needed, and the app's details aren't sent.
    expect(intakeMailboxFormProblem(form, false)).toMatch(/intake address/);
    const filled = { ...form, mailbox: " intake@firm.test ", tenantId: "t", clientSecret: "typed" };
    expect(intakeMailboxFormProblem(filled, false)).toBeNull();
    expect(intakeMailboxConnection(filled)).toEqual({
      provider: "graph",
      mailbox: "intake@firm.test",
      use_teams_app: true,
    });
  });

  it("offers the Outlook app to Teams only once Outlook is connected with all of it", () => {
    const graph = { tenant_id: "t", client_id: "c", secret_set: true };
    expect(intakeOutlookApp({ ...saved().email, provider: "graph", graph })).toEqual({
      tenantId: "t",
      clientId: "c",
    });
    expect(intakeOutlookApp({ ...saved().email, provider: "gmail", graph })).toBeNull();
    expect(
      intakeOutlookApp({ ...saved().email, provider: "graph", graph: { ...graph, secret_set: false } }),
    ).toBeNull();
  });

  it("says what is missing, and keeps a saved secret when left empty", () => {
    const form = {
      provider: "graph" as const,
      mailbox: "intake@firm.test",
      tenantId: " t ",
      clientId: "c",
      clientSecret: "",
      useTeamsApp: false,
      serviceAccountKey: "",
    };
    expect(intakeMailboxFormProblem({ ...form, mailbox: "intake" }, true)).toMatch(
      /intake address/,
    );
    expect(intakeMailboxFormProblem(form, false)).toMatch(/client secret/);
    expect(intakeMailboxFormProblem(form, true)).toBeNull();
    expect(intakeMailboxConnection(form)).toEqual({
      provider: "graph",
      mailbox: "intake@firm.test",
      tenant_id: "t",
      client_id: "c",
    });
    expect(
      intakeMailboxConnection({ ...form, provider: "gmail" }),
    ).toEqual({ provider: "gmail", mailbox: "intake@firm.test" });
  });
});

describe("the Gmail service account key", () => {
  const key = (fields: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "service_account",
      client_email: "intake@project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
      client_id: "1234",
      ...fields,
    });
  const form = {
    provider: "gmail" as const,
    mailbox: "intake@firm.test",
    tenantId: "",
    clientId: "",
    clientSecret: "",
    useTeamsApp: false,
    serviceAccountKey: "",
  };

  it("reads the client ID to delegate to from a pasted key", () => {
    expect(intakeServiceAccountClientId("")).toBeNull();
    expect(intakeServiceAccountClientId(key())).toBe("1234");
    // Google Admin takes the numeric client ID, never the account's email.
    expect(intakeServiceAccountClientId(key({ client_id: undefined }))).toBe(false);
    expect(intakeServiceAccountClientId(key({ client_id: "abc" }))).toBe(false);
    expect(intakeServiceAccountClientId("{not json")).toBe(false);
    expect(intakeServiceAccountClientId(key({ type: "authorized_user" }))).toBe(false);
    expect(intakeServiceAccountClientId(key({ private_key: "x" }))).toBe(false);
  });

  it("needs a key unless one is saved or the deployment has one, and sends it trimmed", () => {
    expect(intakeMailboxFormProblem(form, false)).toBe(
      "Paste the service account's JSON key.",
    );
    expect(intakeMailboxFormProblem(form, true)).toBeNull();
    expect(
      intakeMailboxFormProblem({ ...form, serviceAccountKey: "{}" }, true),
    ).toMatch(/as Google Cloud downloads it/);
    const pasted = { ...form, serviceAccountKey: ` ${key()} ` };
    expect(intakeMailboxFormProblem(pasted, false)).toBeNull();
    expect(intakeMailboxConnection(pasted)).toEqual({
      provider: "gmail",
      mailbox: "intake@firm.test",
      service_account_key: key(),
    });
    expect(intakeMailboxConnection(form)).toEqual({
      provider: "gmail",
      mailbox: "intake@firm.test",
    });
  });
});

describe("intakeChannelChanges", () => {
  it("turns Slack or Teams on with the save that completes its setup", () => {
    const settings = saved();
    settings.slack = { ...settings.slack, configured: false };
    settings.teams = {
      ...settings.teams,
      enabled: false,
      configured: false,
      app_id: null,
      tenant_id: null,
    };
    const draft = intakeAutomationDraft(settings);
    // One secret of two saves on its own, and leaves Slack off.
    expect(
      intakeChannelChanges("slack", settings, { ...draft, signingSecret: "s" }),
    ).toEqual({ slack_signing_secret: "s" });
    expect(
      intakeChannelChanges("slack", settings, {
        ...draft,
        signingSecret: "s",
        botToken: "xoxb-1",
      }),
    ).toEqual({
      slack_signing_secret: "s",
      slack_bot_token: "xoxb-1",
      slack_enabled: true,
    });
    expect(
      intakeChannelChanges("teams", settings, {
        ...draft,
        teamsAppId: "app",
        teamsTenantId: "tenant",
        teamsSecret: "secret",
      }),
    ).toEqual({
      teams_app_id: "app",
      teams_tenant_id: "tenant",
      teams_client_secret: "secret",
      teams_enabled: true,
    });
  });

  it("sets Teams up with the Outlook app instead of anything typed", () => {
    const settings = saved();
    settings.teams = { ...settings.teams, enabled: false, configured: false, app_id: null, tenant_id: null };
    const draft = { ...intakeAutomationDraft(settings), teamsAppId: "typed", teamsSecret: "typed" };
    // A first setup turns Teams on; typed details are never sent with it.
    expect(intakeChannelChanges("teams", settings, draft, { useOutlookApp: true })).toEqual({
      teams_use_outlook_app: true,
      teams_enabled: true,
    });
    // Once set up, it keeps the switch as it is, unless it was changed.
    settings.teams = { ...settings.teams, configured: true, enabled: true };
    const setUp = intakeAutomationDraft(settings);
    expect(intakeChannelChanges("teams", settings, setUp, { useOutlookApp: true })).toEqual({
      teams_use_outlook_app: true,
    });
    expect(
      intakeChannelChanges("teams", settings, { ...setUp, teamsEnabled: false }, { useOutlookApp: true }),
    ).toEqual({ teams_use_outlook_app: true, teams_enabled: false });
    // Other channels ignore it.
    expect(intakeChannelChanges("slack", settings, setUp, { useOutlookApp: true })).toEqual({});
  });

  it("sends only the channel's own changed fields, with a typed domain", () => {
    const settings = saved();
    const draft = {
      ...intakeAutomationDraft(settings),
      emailEnabled: false,
      domainInput: "Partner.example.org",
      slackEnabled: true,
    };
    // Outlook and Gmail share the one mailbox's fields.
    for (const channel of ["outlook", "gmail"] as const)
      expect(intakeChannelChanges(channel, settings, draft)).toEqual({
        email_enabled: false,
        email_allowed_domains: ["firm.test", "partner.example.org"],
      });
    expect(intakeChannelChanges("slack", settings, draft)).toEqual({
      slack_enabled: true,
    });
    expect(intakeChannelChanges("teams", settings, draft)).toEqual({});
  });
});
