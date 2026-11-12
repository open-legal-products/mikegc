import {
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
import type {
  IntakeAutomationSettings,
  IntakeAutomationUpdate,
  IntakeMailboxConnection,
  IntakeMember,
} from "@mike/contracts";
import { IntakeModelSettings } from "./IntakeModelSettings";
import { IntakeSettings } from "./IntakeSettings";
import { IntakePageHeader } from "./IntakePageHeader";
import { IntakeSettingsRedirect } from "./IntakeSettingsRedirect";
import { SAVED_KEY_MASK } from "@/app/components/settings/savedKeyMask";

const mocks = vi.hoisted(() => ({
  automation: vi.fn(),
  update: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  test: vi.fn(),
  members: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  notify: vi.fn(),
  success: vi.fn(),
  workspace: {
    accountId: "account-a",
    workspaceId: "org-a",
    activeOrganization: { id: "org-a", role: "admin" } as {
      id: string;
      role: string;
    } | null,
  },
}));
vi.mock("@/app/lib/mikeApi", () => ({
  getIntakeAutomation: mocks.automation,
  updateIntakeAutomation: mocks.update,
  connectIntakeMailbox: mocks.connect,
  disconnectIntakeMailbox: mocks.disconnect,
  sendIntakeMailboxTest: mocks.test,
  getIntakeMembers: mocks.members,
}));
vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: mocks.notify,
  notifySuccess: mocks.success,
}));
vi.mock("@/shared/lib/errorNotifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/errorNotifier")>()),
  notifySuccess: mocks.success,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
  PERSONAL_WORKSPACE: "personal",
  useWorkspace: () => mocks.workspace,
}));

const LONG_EMAIL =
  "alexandra.montgomery-fitzwilliam.legal-operations@subsidiary.example.com";
const members: IntakeMember[] = [
  {
    user_id: "lawyer-a",
    display_name: "Lawyer A",
    email: "a@example.test",
    profile_photo: null,
  },
  {
    user_id: "lawyer-b",
    display_name: "Lawyer B",
    email: LONG_EMAIL,
    profile_photo: null,
  },
];

/** The email block with an Outlook mailbox connected, switched off. */
const connectedEmail = (): IntakeAutomationSettings["email"] => ({
  enabled: false,
  provider: "graph",
  mailbox: "intake@example.com",
  allowed_domains: ["example.com"],
  from_name: "Legal",
  graph: { tenant_id: "tenant-1", client_id: "client-1", secret_set: true },
  notification_url: "https://api.example.test/webhooks/intake/graph/7c1d",
  gmail: { client_id: "1122334455", key_set: false, deployment_key: true },
  status: {
    subscription_expires_at: "2026-11-06T10:00:00Z",
    last_read_at: "2026-11-03T09:30:00Z",
    error: null,
  },
});
/** The email block before any mailbox is connected. */
const unconnectedEmail = (
  overrides: Partial<IntakeAutomationSettings["email"]> = {},
): IntakeAutomationSettings["email"] => ({
  ...connectedEmail(),
  provider: null,
  mailbox: null,
  allowed_domains: [],
  graph: { tenant_id: null, client_id: null, secret_set: false },
  status: { subscription_expires_at: null, last_read_at: null, error: null },
  ...overrides,
});

const settings = (
  overrides: Partial<IntakeAutomationSettings> = {},
): IntakeAutomationSettings => ({
  email: connectedEmail(),
  slack: {
    enabled: true,
    events_url: "https://api.example.test/webhooks/intake/slack/0b6f",
    configured: true,
    team_id: "T0123",
    team_name: "Acme Legal",
    bot_user_id: "U0BOT",
    missing_scopes: [],
    message_events_seen: true,
  },
  teams: {
    enabled: false,
    events_url: "https://api.example.test/webhooks/intake/teams/5e2a",
    configured: false,
    app_id: null,
    tenant_id: null,
    files_access: null,
  },
  models: {
    available: ["claude-haiku-4-5", "claude-sonnet-5-5", "gpt-6-luna"],
    triage: "claude-haiku-4-5",
    triage_available: true,
    preprocessing: "claude-sonnet-5-5",
    preprocessing_available: true,
  },
  rules: [
    {
      condition: "The request is about an NDA or procurement contract",
      assignee_id: "lawyer-a",
      preprocess: false,
      preprocess_with: null,
    },
  ],
  recent: [],
  ...overrides,
});

/** The page once loaded: its Channels section. */
const loaded = () => screen.findByRole("region", { name: "Channels" });
const section = (name: string) => screen.getByRole("region", { name });

/** The API: applies each update to what it keeps and returns the result. */
let server: IntakeAutomationSettings;
function applyUpdate(
  current: IntakeAutomationSettings,
  update: IntakeAutomationUpdate,
): IntakeAutomationSettings {
  return {
    ...current,
    email: {
      ...current.email,
      enabled: update.email_enabled ?? current.email.enabled,
      allowed_domains:
        update.email_allowed_domains ?? current.email.allowed_domains,
      from_name: update.email_from_name ?? current.email.from_name,
    },
    teams: {
      ...current.teams,
      enabled: update.teams_enabled ?? current.teams.enabled,
      app_id: update.teams_app_id ?? current.teams.app_id,
      tenant_id: update.teams_tenant_id ?? current.teams.tenant_id,
      configured:
        current.teams.configured ||
        (!!(update.teams_app_id ?? current.teams.app_id) &&
          !!(update.teams_tenant_id ?? current.teams.tenant_id) &&
          !!update.teams_client_secret),
    },
    slack: {
      ...current.slack,
      enabled: update.slack_enabled ?? current.slack.enabled,
      configured:
        current.slack.configured ||
        (!!update.slack_signing_secret && !!update.slack_bot_token),
    },
    models: {
      ...current.models,
      ...(update.triage_model !== undefined && {
        triage: update.triage_model,
        triage_available: update.triage_model !== null,
      }),
      ...(update.preprocessing_model !== undefined && {
        preprocessing: update.preprocessing_model,
        preprocessing_available: update.preprocessing_model !== null,
      }),
    },
    rules: update.rules ?? current.rules,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace = {
    accountId: "account-a",
    workspaceId: "org-a",
    activeOrganization: { id: "org-a", role: "admin" },
  };
  // The page header measures its breadcrumbs against the viewport.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  server = settings();
  mocks.automation.mockImplementation(async () => server);
  mocks.members.mockResolvedValue(members);
  mocks.update.mockImplementation(
    async (_orgId: string, update: IntakeAutomationUpdate) => {
      server = applyUpdate(server, update);
      return server;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntakeSettings", () => {
  /** A channel's tile, named like a connector's. */
  const tile = (name: string) =>
    screen.getByRole("region", { name: `${name} channel` });
  /** Opens a channel's modal from its tile or its Set up button. */
  async function openModal(
    user: ReturnType<typeof userEvent.setup>,
    button: string,
    name: string,
  ) {
    await user.click(screen.getByRole("button", { name: button }));
    return screen.findByRole("dialog", { name });
  }

  it("shows each channel as a connector tile with its logo, then Triage rules", async () => {
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    expect(mocks.automation).toHaveBeenCalledWith("org-a");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Channels", "Triage rules"]);

    // Outlook and Gmail are separate channels, each with its own logo.
    const logos = {
      Outlook: "/icons/integrations/outlook.svg",
      Gmail: "/icons/integrations/gmail.png",
      Teams: "/icons/integrations/teams.svg",
    };
    for (const [name, src] of Object.entries(logos))
      expect(tile(name).querySelector("img")).toHaveAttribute("src", src);
    expect(tile("Slack").querySelector("svg")).not.toBeNull();

    // Just the name: no status or warnings on the tiles.
    for (const name of ["Outlook", "Gmail", "Slack", "Teams"])
      expect(tile(name)).toHaveTextContent(new RegExp(`^${name}(Set up)?$`));
    // Set up shows its switch, saved as it is; the rest offer Set up.
    expect(
      within(tile("Outlook")).getByRole("switch", { name: "Outlook channel" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      within(tile("Slack")).getByRole("switch", { name: "Slack channel" }),
    ).toHaveAttribute("aria-checked", "true");
    for (const name of ["Gmail", "Teams"]) {
      const button = within(tile(name)).getByRole("button", {
        name: `Set up ${name}`,
      });
      expect(button).toHaveTextContent(/^Set up$/);
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("aria-haspopup", "dialog");
    }
    expect(screen.getByRole("button", { name: "Manage Outlook" })).toBeInTheDocument();
    // No fields, secrets or steps on the tiles themselves.
    expect(section("Channels").querySelector("input:not([role=switch])")).toBeNull();
    expect(screen.queryByLabelText("Signing Secret")).toBeNull();
    expect(screen.queryByText("How to set it up")).toBeNull();

    // The rules have a page of their own in the organization's settings,
    // and asking requesters for missing details is always on.
    const triage = section("Triage rules");
    expect(within(triage).queryByRole("switch")).toBeNull();
    const edit = within(triage).getByRole("link", { name: "Edit rules" });
    expect(edit).toHaveAttribute(
      "href",
      "/organizations/org-a/settings/intake/rules",
    );
    expect(edit).toHaveTextContent(/^Edit$/);
    expect(
      within(triage).getByRole("link", { name: "Model Preferences" }),
    ).toHaveAttribute("href", "/organizations/org-a/settings/models");
    // Nothing has changed, so nothing was sent.
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("switches a channel from its tile at once, and turns it back when that fails", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const slack = screen.getByRole("switch", { name: "Slack channel" });
    await user.click(slack);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("org-a", {
        slack_enabled: false,
      }),
    );
    await waitFor(() => expect(slack).toHaveAttribute("aria-checked", "false"));
    // The switch is its own target: it doesn't open the modal.
    expect(screen.queryByRole("dialog")).toBeNull();

    mocks.update.mockRejectedValueOnce(
      Object.assign(new Error("Bad gateway"), { status: 502 }),
    );
    const outlook = screen.getByRole("switch", { name: "Outlook channel" });
    await user.click(outlook);
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
    expect(outlook).toHaveAttribute("aria-checked", "false");
    const [, options] = mocks.notify.mock.calls[0]!;
    expect(options.action).toBe("turn Outlook on");
    options.onRetry();
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        email_enabled: true,
      }),
    );
    await waitFor(() => expect(outlook).toHaveAttribute("aria-checked", "true"));
  });

  it("opens a channel's modal named for it, with just its fields, and gives focus back on close", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const manage = screen.getByRole("button", { name: "Manage Slack" });
    const dialog = await openModal(user, "Manage Slack", "Slack");
    // Focus moves into the modal.
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    expect(
      within(dialog).getByRole("switch", { name: "Record requests from Slack" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(dialog).toHaveTextContent(
      "https://api.example.test/webhooks/intake/slack/0b6f",
    );
    expect(
      within(dialog).getByRole("button", { name: "Copy Events Request URL" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Acme Legal");
    expect(dialog).toHaveTextContent("MikeGC bot user U0BOT");
    // What the channel does and how to set it up are on the help screen.
    expect(dialog).not.toHaveTextContent("How to set it up");
    expect(dialog).not.toHaveTextContent("People write @MikeGC");
    // Nothing changed: there is nothing to save.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(manage).toHaveFocus();
  });

  it("says when Slack hasn't sent a thread message, so replies may not be arriving", async () => {
    server = settings({
      slack: { ...settings().slack, message_events_seen: false },
    });
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Slack", "Slack");
    expect(dialog).toHaveTextContent(
      "MikeGC hasn't received a thread message yet. Subscribe the app to the message.channels and message.groups bot events",
    );
  });

  it("keeps a channel's help on a screen of its own, opened from the content, keeping what was typed", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Slack", "Slack");
    await user.type(within(dialog).getByLabelText("Signing Secret"), "half");
    const help = within(dialog).getByRole("button", { name: "Slack help" });
    expect(help).toHaveTextContent(/^Setup help$/);
    // At the bottom of the content, before Cancel and Save.
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(
      help.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(help);

    const screenHelp = await screen.findByRole("dialog", { name: "Help" });
    // An introduction under its own heading, then the steps and settings.
    expect(
      within(screenHelp).getByRole("region", { name: "What it does" }),
    ).toHaveTextContent("People write @MikeGC in Slack");
    const steps = within(screenHelp).getByRole("region", {
      name: "How to set it up",
    });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(steps).toHaveTextContent(
      "app_mention, message.channels and message.groups",
    );
    const reference = within(screenHelp).getByRole("region", {
      name: "What each setting means",
    });
    expect(reference).toHaveTextContent("Events Request URL");
    // The fields wait behind it, and focus moves onto it.
    expect(within(screenHelp).queryByLabelText("Signing Secret")).toBeNull();
    expect(within(screenHelp).queryByRole("button", { name: "Save" })).toBeNull();
    await waitFor(() =>
      expect(screenHelp).toContainElement(document.activeElement as HTMLElement),
    );

    await user.click(within(screenHelp).getByRole("button", { name: "Back" }));
    const back = await screen.findByRole("dialog", { name: "Slack" });
    expect(within(back).getByLabelText("Signing Secret")).toHaveValue("half");
    await waitFor(() =>
      expect(within(back).getByRole("button", { name: "Slack help" })).toHaveFocus(),
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("shows Slack's app manifest, with the events URL, from its help's setup step", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Slack", "Slack");
    await user.click(within(dialog).getByRole("button", { name: "Slack help" }));
    const help = await screen.findByRole("dialog", { name: "Help" });
    const link = within(help).getByRole("button", { name: "the manifest" });
    await user.click(link);

    const manifest = await screen.findByRole("dialog", { name: "Manifest" });
    // Copying shows a tick in the button, not a toast.
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await user.click(
      within(manifest).getByRole("button", { name: "Copy Slack app manifest" }),
    );
    expect(
      await within(manifest).findByRole("button", {
        name: "Copied Slack app manifest",
      }),
    ).toHaveTextContent(/^Copied$/);
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('"bot_events"'),
    );
    writeText.mockRestore();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(manifest).toHaveTextContent('"chat:write.customize"');
    expect(manifest).toHaveTextContent(
      '"request_url": "https://api.example.test/webhooks/intake/slack/0b6f"',
    );
    await waitFor(() =>
      expect(manifest).toContainElement(document.activeElement as HTMLElement),
    );
    // Back to the help screen, onto the link that opened it.
    await user.click(within(manifest).getByRole("button", { name: "Back" }));
    const again = await screen.findByRole("dialog", { name: "Help" });
    await waitFor(() =>
      expect(
        within(again).getByRole("button", { name: "the manifest" }),
      ).toHaveFocus(),
    );
  });

  it("masks a saved secret as BYOK does, never fills it in, and saves a typed one only with Save", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Slack", "Slack");
    const secret = within(dialog).getByLabelText("Signing Secret");
    const token = within(dialog).getByLabelText("Bot User OAuth Token");
    // Saved, each shows the same fixed mask, not the secret, read-only.
    for (const field of [secret, token]) {
      expect(field).toHaveAttribute("type", "password");
      expect(field).toHaveValue(SAVED_KEY_MASK);
      expect(field).toHaveAttribute("readonly");
    }
    // Focused, it empties for a replacement; left empty, the mask is back.
    await user.click(secret);
    expect(secret).toHaveValue("");
    expect(secret).not.toHaveAttribute("readonly");
    expect(secret).toHaveAttribute("placeholder", "Paste a new one to replace it");
    await user.tab();
    expect(secret).toHaveValue(SAVED_KEY_MASK);
    // The mask is never sent: nothing changed.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(secret, " s3cret ");
    expect(secret).toHaveValue(" s3cret ");
    expect(token).toHaveValue(SAVED_KEY_MASK);
    // Typed, it isn't sent until saved, however long the pause.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(mocks.update).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("org-a", {
        slack_signing_secret: "s3cret",
      }),
    );
    // Saved, the modal closes and says so.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mocks.success).toHaveBeenCalledWith("Slack settings saved");
    // Enter in a secret saves it too.
    const again = await openModal(user, "Manage Slack", "Slack");
    await user.type(
      within(again).getByLabelText("Bot User OAuth Token"),
      "xoxb-new{Enter}",
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        slack_bot_token: "xoxb-new",
      }),
    );
  });

  it("discards what wasn't saved when the modal is closed", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    let dialog = await openModal(user, "Manage Slack", "Slack");
    await user.type(within(dialog).getByLabelText("Signing Secret"), "half");
    await user.click(
      within(dialog).getByRole("switch", { name: "Record requests from Slack" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    dialog = await openModal(user, "Manage Slack", "Slack");
    // What was typed is gone: the saved secret's mask is back.
    expect(within(dialog).getByLabelText("Signing Secret")).toHaveValue(
      SAVED_KEY_MASK,
    );
    expect(
      within(dialog).getByRole("switch", { name: "Record requests from Slack" }),
    ).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("sets up Teams in one save that turns it on, with its switch only once saved", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Set up Teams", "Teams");
    // No switch until its details are saved.
    expect(
      within(dialog).queryByRole("switch", { name: "Record requests from Teams" }),
    ).toBeNull();
    expect(dialog).toHaveTextContent(
      "https://api.example.test/webhooks/intake/teams/5e2a",
    );
    // Outlook is connected, so its app is offered first; this setup types a
    // different one.
    await user.click(
      within(dialog).getByRole("switch", { name: "Use the same app as Outlook" }),
    );
    await user.type(within(dialog).getByLabelText("App ID"), "app-1");
    await user.type(within(dialog).getByLabelText("Tenant ID"), "tenant-1");
    const secret = within(dialog).getByLabelText("Client secret");
    expect(secret).toHaveAttribute("type", "password");
    await user.type(secret, "s3cret");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("org-a", {
        teams_enabled: true,
        teams_app_id: "app-1",
        teams_tenant_id: "tenant-1",
        teams_client_secret: "s3cret",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // Set up now, its tile shows its switch and opens its modal.
    expect(
      screen.getByRole("switch", { name: "Teams channel" }),
    ).toHaveAttribute("aria-checked", "true");
    const managing = await openModal(user, "Manage Teams", "Teams");
    expect(
      within(managing).getByRole("switch", { name: "Record requests from Teams" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(managing).toHaveTextContent("Document access");
    expect(managing).toHaveTextContent("Not checked yet");
    expect(within(managing).getByLabelText("App ID")).toHaveValue("app-1");
  });

  it("sets up Teams with the connected Outlook app, without typing it again", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Set up Teams", "Teams");
    expect(
      within(dialog).getByRole("switch", { name: "Use the same app as Outlook" }),
    ).toHaveAttribute("aria-checked", "true");
    // Outlook's app fills the fields, which can't be edited; the secret stays masked.
    expect(within(dialog).getByLabelText("App ID")).toHaveValue("client-1");
    expect(within(dialog).getByLabelText("App ID")).toBeDisabled();
    expect(within(dialog).getByLabelText("Tenant ID")).toHaveValue("tenant-1");
    expect(within(dialog).getByLabelText("Tenant ID")).toBeDisabled();
    const secret = within(dialog).getByLabelText("Client secret");
    expect(secret).toBeDisabled();
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).toHaveValue(SAVED_KEY_MASK);
    expect(dialog).toHaveTextContent(
      "MikeGC copies the client secret from Outlook. Changing it in Outlook later doesn't change it here.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("org-a", {
        teams_use_outlook_app: true,
        teams_enabled: true,
      }),
    );
  });

  it("connects Outlook with the Teams app, without typing it again", async () => {
    const user = userEvent.setup();
    server = settings({
      email: unconnectedEmail(),
      teams: {
        ...settings().teams,
        enabled: true,
        configured: true,
        app_id: "teams-app",
        tenant_id: "teams-tenant",
      },
    });
    mocks.connect.mockImplementation(async () => server);
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Set up Outlook", "Outlook");
    expect(
      within(dialog).getByRole("switch", { name: "Use the same app as Teams" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText("Client ID")).toHaveValue("teams-app");
    expect(within(dialog).getByLabelText("Client ID")).toBeDisabled();
    expect(within(dialog).getByLabelText("Client secret")).toBeDisabled();
    // Turned off, the app's details are typed as before; back on to reuse it.
    const same = within(dialog).getByRole("switch", { name: "Use the same app as Teams" });
    await user.click(same);
    expect(within(dialog).getByLabelText("Client ID")).toBeEnabled();
    expect(within(dialog).getByLabelText("Client ID")).toHaveValue("");
    expect(within(dialog).getByLabelText("Client secret")).toBeEnabled();
    await user.click(same);
    await user.type(within(dialog).getByLabelText("Intake address"), "intake@company.com");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith("org-a", {
        provider: "graph",
        mailbox: "intake@company.com",
        use_teams_app: true,
      }),
    );
  });

  it("shows a refused save as a notice, never in the footer, and keeps what was typed", async () => {
    const user = userEvent.setup();
    const detail = "Slack didn't accept this Signing Secret.";
    server = settings({
      slack: {
        ...settings().slack,
        enabled: false,
        configured: false,
        team_id: null,
        team_name: null,
        bot_user_id: null,
      },
    });
    mocks.update.mockRejectedValueOnce(
      Object.assign(new Error(detail), { status: 400, detail }),
    );
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Set up Slack", "Slack");
    // Nothing saved yet: empty, with what to paste.
    expect(within(dialog).getByLabelText("Signing Secret")).toHaveValue("");
    expect(within(dialog).getByLabelText("Signing Secret")).toHaveAttribute(
      "placeholder",
      "Paste the app's Signing Secret",
    );
    // No switch until its keys are saved.
    expect(within(dialog).queryByRole("switch")).toBeNull();
    await user.type(within(dialog).getByLabelText("Signing Secret"), "s3cret");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    // What Slack said goes to the warning popup, never the modal's footer.
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({ detail }),
        expect.objectContaining({ action: "save the Slack settings" }),
      ),
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(dialog).not.toHaveTextContent(detail);
    // The modal stays open with what was typed, to fix it.
    expect(within(dialog).getByLabelText("Signing Secret")).toHaveValue(
      "s3cret",
    );
    // One key of two: saved without turning Slack on.
    expect(mocks.update).toHaveBeenCalledWith("org-a", {
      slack_signing_secret: "s3cret",
    });
  });

  it("connects an Outlook mailbox from its own modal, which then manages it", async () => {
    const user = userEvent.setup();
    server = settings({ email: unconnectedEmail() });
    mocks.connect.mockImplementation(
      async (_orgId: string, connection: IntakeMailboxConnection) => {
        server = {
          ...server,
          email: {
            ...connectedEmail(),
            enabled: true,
            mailbox: connection.mailbox,
            // The address's own domain is accepted from the start.
            allowed_domains: ["company.com"],
          },
        };
        return server;
      },
    );
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Set up Outlook", "Outlook");
    // Straight to Outlook's connect form: no switch until it is connected,
    // and no choice of provider.
    expect(
      within(dialog).queryByRole("switch", { name: "Record requests from email" }),
    ).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Gmail/ })).toBeNull();
    const connect = within(dialog).getByRole("button", { name: "Connect" });
    // Each field is needed before it can connect.
    expect(connect).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Intake address"),
      "intake@company.com",
    );
    await user.type(within(dialog).getByLabelText("Tenant ID"), "tenant-9");
    await user.type(within(dialog).getByLabelText("Client ID"), "client-9");
    const secret = within(dialog).getByLabelText("Client secret");
    expect(secret).toHaveAttribute("type", "password");
    expect(connect).toBeDisabled();
    await user.type(secret, "s3cret");
    expect(connect).toBeEnabled();
    await user.click(connect);
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith("org-a", {
        provider: "graph",
        mailbox: "intake@company.com",
        tenant_id: "tenant-9",
        client_id: "client-9",
        client_secret: "s3cret",
      }),
    );
    expect(mocks.success).toHaveBeenCalledWith("Connected intake@company.com");
    // The modal stays open to finish: the switch, domains, a test.
    expect(
      await within(dialog).findByRole("switch", {
        name: "Record requests from email",
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Connection settings")).toBeInTheDocument();
    expect(within(dialog).getByText("company.com")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Client secret")).toBeNull();
    // And the tile behind it shows its switch, on.
    expect(
      screen.getByRole("switch", { name: "Outlook channel" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Set up Gmail" })).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("says that connecting Outlook replaces a Gmail mailbox", async () => {
    const user = userEvent.setup();
    server = settings({
      email: { ...connectedEmail(), provider: "gmail", graph: unconnectedEmail().graph },
    });
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    expect(screen.getByRole("switch", { name: "Gmail channel" })).toBeInTheDocument();
    const dialog = await openModal(user, "Set up Outlook", "Outlook");
    expect(dialog).toHaveTextContent(
      "intake@example.com is connected through Gmail. MikeGC reads one intake mailbox, so connecting Outlook replaces it.",
    );
    // Its own connection starts empty.
    expect(within(dialog).getByLabelText("Intake address")).toHaveValue("");
  });

  it("says why a mailbox couldn't connect in a notice, keeping the form", async () => {
    const user = userEvent.setup();
    server = settings({ email: unconnectedEmail() });
    const detail =
      "Microsoft 365 didn't accept these credentials. Check the tenant ID, client ID and client secret.";
    mocks.connect.mockRejectedValue(
      Object.assign(new Error(detail), { status: 400, detail }),
    );
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Set up Outlook", "Outlook");
    await user.type(
      within(dialog).getByLabelText("Intake address"),
      "intake@company.com",
    );
    await user.type(within(dialog).getByLabelText("Tenant ID"), "t");
    await user.type(within(dialog).getByLabelText("Client ID"), "c");
    await user.type(within(dialog).getByLabelText("Client secret"), "s");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({ detail }),
        expect.objectContaining({ action: "connect the mailbox" }),
      ),
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
    // The form stays, with what was typed, to correct.
    expect(within(dialog).getByLabelText("Tenant ID")).toHaveValue("t");
  });

  it("connects Gmail with the deployment's service account, its key optional", async () => {
    const user = userEvent.setup();
    server = settings({ email: unconnectedEmail() });
    mocks.connect.mockImplementation(async () => server);
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    let dialog = await openModal(user, "Set up Gmail", "Gmail");
    expect(dialog).toHaveTextContent("1122334455");
    expect(within(dialog).queryByLabelText("Client secret")).toBeNull();
    const key = within(dialog).getByLabelText("Service account JSON key");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute(
      "placeholder",
      "Optional: empty uses this deployment's service account",
    );
    // How to delegate to it is on the help screen.
    expect(dialog).not.toHaveTextContent("gmail.modify");
    await user.click(within(dialog).getByRole("button", { name: "Gmail help" }));
    expect(await screen.findByRole("dialog", { name: "Help" })).toHaveTextContent(
      "https://www.googleapis.com/auth/gmail.modify",
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    dialog = await screen.findByRole("dialog", { name: "Gmail" });
    await user.type(
      within(dialog).getByLabelText("Intake address"),
      "intake@company.com",
    );
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith("org-a", {
        provider: "gmail",
        mailbox: "intake@company.com",
      }),
    );
  });

  it("connects Gmail with the organization's own service account key", async () => {
    const user = userEvent.setup();
    server = settings({
      email: unconnectedEmail({
        gmail: { client_id: null, key_set: false, deployment_key: false },
      }),
    });
    mocks.connect.mockImplementation(async () => server);
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Set up Gmail", "Gmail");
    // No deployment-wide account to fall back on: the key is needed.
    expect(dialog).not.toHaveTextContent("INTAKE_GMAIL_SERVICE_ACCOUNT_KEY");
    expect(
      within(dialog).queryByRole("button", { name: "Copy service account client ID" }),
    ).toBeNull();
    await user.type(
      within(dialog).getByLabelText("Intake address"),
      "intake@company.com",
    );
    const connect = within(dialog).getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
    const field = within(dialog).getByLabelText("Service account JSON key");
    await user.click(field);
    await user.paste("{not a key");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "This isn't a service account's JSON key.",
    );
    expect(connect).toBeDisabled();
    const key = JSON.stringify({
      type: "service_account",
      client_email: "intake@acme-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
      client_id: "5566778899",
    });
    await user.clear(field);
    await user.paste(key);
    // The client ID to delegate to, read from the key before connecting.
    expect(dialog).toHaveTextContent("5566778899");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(connect).toBeEnabled();
    await user.click(connect);
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith("org-a", {
        provider: "gmail",
        mailbox: "intake@company.com",
        service_account_key: key,
      }),
    );
  });

  it("sends a test email and disconnects only after confirming", async () => {
    const user = userEvent.setup();
    mocks.test.mockResolvedValue({ sent_to: "admin@example.com" });
    mocks.disconnect.mockImplementation(async () => {
      server = settings({ email: unconnectedEmail() });
      return server;
    });
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Outlook", "Outlook");
    const openActions = () =>
      user.click(
        within(dialog).getByRole("button", { name: "Connection settings actions" }),
      );
    await openActions();
    await user.click(
      await screen.findByRole("menuitem", { name: "Send test email" }),
    );
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        "Test email sent to admin@example.com",
      ),
    );
    expect(mocks.test).toHaveBeenCalledWith("org-a");

    await openActions();
    await user.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    const confirm = within(dialog).getByRole("group", {
      name: "Disconnect the intake mailbox?",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "Keep connected" }),
    );
    expect(mocks.disconnect).not.toHaveBeenCalled();
    await openActions();
    await user.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    await user.click(
      within(
        within(dialog).getByRole("group", {
          name: "Disconnect the intake mailbox?",
        }),
      ).getByRole("button", { name: "Disconnect" }),
    );
    await waitFor(() =>
      expect(mocks.disconnect).toHaveBeenCalledWith("org-a"),
    );
    // The modal goes back to Outlook's connect form, and the tile to Set up.
    expect(
      await within(dialog).findByLabelText("Intake address"),
    ).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(
      within(tile("Outlook")).getByRole("button", { name: "Set up Outlook" }),
    ).toBeInTheDocument();
  });

  it("saves the mailbox's switch, sender name and domains together with Save", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Outlook", "Outlook");
    await user.click(
      within(dialog).getByRole("switch", { name: "Record requests from email" }),
    );
    const name = within(dialog).getByLabelText("Sender name");
    expect(name).toHaveValue("Legal");
    await user.clear(name);
    await user.type(name, "Legal team");
    const domain = within(dialog).getByLabelText("Allowed sender domains");
    await user.type(domain, "Partner.Example.org");
    // Add is a text button inside the field.
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(domain.parentElement).toContainElement(add);
    await user.click(add);
    await user.click(
      within(dialog).getByRole("button", { name: "Remove example.com" }),
    );
    // A domain typed but not yet added goes with the save too.
    await user.type(domain, "eu.example.com");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(mocks.update).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("org-a", {
        email_enabled: true,
        email_allowed_domains: ["partner.example.org", "eu.example.com"],
        email_from_name: "Legal team",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("switch", { name: "Outlook channel" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("refuses an invalid domain inline, and doesn't save it", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Outlook", "Outlook");
    const domain = within(dialog).getByLabelText("Allowed sender domains");
    await user.type(domain, "not a domain{Enter}");
    expect(
      within(dialog).getByText("Enter a domain like example.com."),
    ).toBeInTheDocument();
    expect(domain).toHaveAccessibleDescription("Enter a domain like example.com.");
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    // Nothing else changed, so there is nothing to save.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("won't save other changes while a typed domain is invalid", async () => {
    const user = userEvent.setup();
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Outlook", "Outlook");
    const name = within(dialog).getByLabelText("Sender name");
    expect(name).toHaveAttribute("maxLength", "80");
    await user.clear(name);
    await user.type(name, "Legal Ops");
    await user.type(
      within(dialog).getByLabelText("Allowed sender domains"),
      "not a domain",
    );
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    // Enter in another field doesn't send the change without the domain.
    await user.type(name, "{Enter}");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("raises a save that failed for another reason as a notice with Retry", async () => {
    const user = userEvent.setup();
    mocks.update.mockRejectedValueOnce(
      Object.assign(new Error("Bad gateway"), { status: 502 }),
    );
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Slack", "Slack");
    await user.type(within(dialog).getByLabelText("Signing Secret"), "s3cret");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
    const [, options] = mocks.notify.mock.calls[0] as [
      unknown,
      { action: string; onRetry: () => void },
    ];
    expect(options.action).toBe("save the Slack settings");
    // Nothing on screen is wrong, so nothing is shown beside the fields.
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBe(dialog);
    options.onRetry();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
      slack_signing_secret: "s3cret",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("sends only what failed when Retry comes after the modal closed", async () => {
    const user = userEvent.setup();
    mocks.update.mockRejectedValueOnce(
      Object.assign(new Error("Bad gateway"), { status: 502 }),
    );
    render(<IntakeSettings orgId="org-a" />);
    await loaded();
    const dialog = await openModal(user, "Manage Slack", "Slack");
    await user.type(within(dialog).getByLabelText("Signing Secret"), "s3cret");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const [, options] = mocks.notify.mock.calls[0] as [
      unknown,
      { onRetry: () => void },
    ];
    options.onRetry();
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("Slack settings saved"),
    );
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
      slack_signing_secret: "s3cret",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tells a member who isn't an owner or admin that they cannot change it", async () => {
    mocks.automation.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    render(<IntakeSettings orgId="org-a" />);
    expect(
      await screen.findByText(
        "Only owners and admins can change automated intake.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Channels" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed load as an error with Try again", async () => {
    const user = userEvent.setup();
    mocks.automation.mockRejectedValueOnce(
      Object.assign(new Error("Unavailable"), { status: 503 }),
    );
    render(<IntakeSettings orgId="org-a" />);
    expect(
      await screen.findByText("Unable to load the settings"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await loaded()).toBeInTheDocument();
    expect(mocks.automation).toHaveBeenCalledTimes(2);
  });

  it("shows the page's layout while it loads: the channel tiles", () => {
    mocks.automation.mockReturnValue(new Promise(() => {}));
    render(<IntakeSettings orgId="org-a" />);
    const skeleton = screen.getByLabelText("Loading the intake settings");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    // The Channels heading and its four tiles, each with its switch's shape.
    expect(skeleton.querySelectorAll(".h-5.w-9.rounded-full")).toHaveLength(4);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("points Personal to the person's own rules and Model Preferences", async () => {
    server = settings({ rules: [] });
    render(<IntakeSettings orgId="personal" />);
    await loaded();
    expect(mocks.automation).toHaveBeenCalledWith("personal");
    const triage = section("Triage rules");
    expect(
      within(triage).getByRole("link", { name: "Edit rules" }),
    ).toHaveAttribute("href", "/settings/intake/rules");
    expect(
      within(triage).getByRole("link", { name: "Model Preferences" }),
    ).toHaveAttribute("href", "/settings/models");
  });
});

describe("IntakeModelSettings", () => {
  const models = () => screen.findByRole("region", { name: "Intake" });

  it("shows the models triage and preprocessing run with", async () => {
    render(<IntakeModelSettings orgId="org-a" />);
    const section = await models();
    expect(mocks.automation).toHaveBeenCalledWith("org-a");
    // Triage can't be switched off; it runs with the model chosen here, and
    // preprocessing with its own.
    expect(within(section).queryByRole("switch")).toBeNull();
    expect(
      within(section).getByRole("button", { name: "Triage" }),
    ).toHaveTextContent("Claude Haiku 4.5");
    expect(
      within(section).getByRole("button", { name: "AI preprocessing" }),
    ).toHaveTextContent("Claude Sonnet 5.5");
    expect(section).not.toHaveTextContent("API key");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("shows its layout while it loads", () => {
    mocks.automation.mockReturnValue(new Promise(() => {}));
    render(<IntakeModelSettings orgId="org-a" />);
    expect(screen.getByLabelText("Loading intake's models")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("tells a member they can't change it", async () => {
    mocks.automation.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    render(<IntakeModelSettings orgId="org-a" />);
    expect(
      await screen.findByText(
        "Only owners and admins can change intake's models.",
      ),
    ).toBeInTheDocument();
  });

  it("points Personal to the person's own keys", async () => {
    server = settings({
      models: {
        available: [],
        triage: null,
        triage_available: false,
        preprocessing: null,
        preprocessing_available: false,
      },
    });
    render(<IntakeModelSettings orgId="personal" />);
    const section = await models();
    expect(mocks.automation).toHaveBeenCalledWith("personal");
    expect(
      within(section).getAllByRole("link", {
        name: "Add one in Bring Your Own Keys",
      })[0],
    ).toHaveAttribute("href", "/settings/byok");
  });

  it("saves the model chosen, and can stop triage by choosing none", async () => {
    const user = userEvent.setup();
    render(<IntakeModelSettings orgId="org-a" />);
    await models();
    const model = screen.getByRole("button", { name: "Triage" });
    await user.click(model);
    // Grouped by provider, as other model pickers are.
    expect(await screen.findByText("OpenAI")).toBeInTheDocument();
    await user.click(
      screen.getByRole("menuitemradio", { name: "Claude Sonnet 5.5" }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        triage_model: "claude-sonnet-5-5",
      }),
    );
    expect(model).toHaveTextContent("Claude Sonnet 5.5");
    await user.click(model);
    await user.click(
      await screen.findByRole("menuitemradio", {
        name: /^No model\s*Triage doesn.t run/,
      }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        triage_model: null,
      }),
    );
    expect(model).toHaveTextContent("No model");
    expect(section("Intake")).toHaveTextContent(
      "Choose a model for triage to run.",
    );
  });

  it("saves preprocessing's model on its own", async () => {
    const user = userEvent.setup();
    render(<IntakeModelSettings orgId="org-a" />);
    await models();
    const model = screen.getByRole("button", { name: "AI preprocessing" });
    await user.click(model);
    await user.click(
      await screen.findByRole("menuitemradio", { name: "GPT-6 Luna" }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        preprocessing_model: "gpt-6-luna",
      }),
    );
    expect(model).toHaveTextContent("GPT-6 Luna");
    await user.click(model);
    await user.click(
      await screen.findByRole("menuitemradio", {
        name: /^No model\s*Preprocessing doesn.t run/,
      }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        preprocessing_model: null,
      }),
    );
    expect(section("Intake")).toHaveTextContent(
      "Choose a model for preprocessing to run.",
    );
  });

  it("says when the chosen model has lost its key", async () => {
    server = settings({
      models: {
        available: ["claude-haiku-4-5"],
        triage: "gpt-6-luna",
        triage_available: false,
        preprocessing: "claude-haiku-4-5",
        preprocessing_available: true,
      },
    });
    render(<IntakeModelSettings orgId="org-a" />);
    await models();
    const triage = section("Intake");
    expect(
      within(triage).getByRole("button", { name: "Triage" }),
    ).toHaveTextContent("GPT-6 Luna");
    expect(triage).toHaveTextContent("This model has no API key.");
    // Other models have keys, so another can be chosen.
    expect(
      within(triage).getByRole("button", { name: "Triage" }),
    ).toBeEnabled();
    expect(
      within(triage).getByRole("link", {
        name: "Add one in Bring Your Own Keys",
      }),
    ).toBeInTheDocument();
  });

  it("says when triage has no model, linking to the organization's keys", async () => {
    server = settings({
      models: {
        available: [],
        triage: null,
        triage_available: false,
        preprocessing: null,
        preprocessing_available: false,
      },
    });
    render(<IntakeModelSettings orgId="org-a" />);
    await models();
    const triage = section("Intake");
    // With no key at all there is nothing to choose.
    expect(
      within(triage).getAllByText("No model has an API key."),
    ).toHaveLength(2);
    for (const name of ["Triage", "AI preprocessing"])
      expect(within(triage).getByRole("button", { name })).toBeDisabled();
    expect(triage).not.toHaveTextContent("without AI");
    expect(
      within(triage).getAllByRole("link", {
        name: "Add one in Bring Your Own Keys",
      })[0],
    ).toHaveAttribute("href", "/organizations/org-a/settings/providers");
  });
});

describe("IntakeSettingsRedirect", () => {
  it.each([
    ["org-a", "settings", "/organizations/org-a/settings/intake"],
    ["org-a", "rules", "/organizations/org-a/settings/intake/rules"],
    ["personal", "settings", "/settings/intake"],
    ["personal", "rules", "/settings/intake/rules"],
  ] as const)(
    "sends an old link in %s to its %s in the workspace's settings",
    (workspaceId, to, href) => {
      mocks.workspace = { ...mocks.workspace, workspaceId };
      render(<IntakeSettingsRedirect to={to} />);
      expect(mocks.replace).toHaveBeenCalledWith(href);
    },
  );
});

describe("IntakePageHeader", () => {
  it.each([
    ["an owner", { id: "org-a", role: "owner" }, "org-a", true],
    ["an admin", { id: "org-a", role: "admin" }, "org-a", true],
    ["a member", { id: "org-a", role: "member" }, "org-a", false],
    ["Personal's owner", null, "personal", true],
  ])(
    "offers the intake settings to %s: %s",
    (_who, organization, workspaceId, shown) => {
      mocks.workspace = {
        accountId: "account-a",
        workspaceId: workspaceId as string,
        activeOrganization: organization,
      };
      render(<IntakePageHeader page="requests" />);
      expect(
        screen.getByRole("button", { name: "Dashboard" }),
      ).toBeInTheDocument();
      expect(!!screen.queryByRole("button", { name: "Intake settings" })).toBe(
        shown,
      );
      // The rules are reached from the settings, not from Intake's header.
      expect(screen.queryByRole("button", { name: "Rules" })).toBeNull();
    },
  );

  it("leaves Settings out while the organization's role is unknown", () => {
    mocks.workspace = {
      accountId: "account-a",
      workspaceId: "org-a",
      activeOrganization: null,
    };
    render(<IntakePageHeader page="dashboard" />);
    expect(
      screen.queryByRole("button", { name: "Intake settings" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["org-a", "/organizations/org-a/settings/intake"],
    ["personal", "/settings/intake"],
  ])("opens the settings in %s's own settings", async (workspaceId, href) => {
    const user = userEvent.setup();
    mocks.workspace = { ...mocks.workspace, workspaceId };
    render(<IntakePageHeader page="dashboard" />);
    const settings = screen.getByRole("button", { name: "Intake settings" });
    // A settings icon, with no text beside it.
    expect(settings).toHaveTextContent(/^$/);
    await user.click(settings);
    expect(mocks.push).toHaveBeenCalledWith(href);
  });
});
