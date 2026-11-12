import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IntakeAssignmentRule,
  IntakeAutomationSettings,
  IntakeAutomationUpdate,
  IntakeMember,
} from "@mike/contracts";
import { IntakeRules, IntakeRulesPage } from "./IntakeRules";

const mocks = vi.hoisted(() => ({
  automation: vi.fn(),
  update: vi.fn(),
  members: vi.fn(),
  workflows: vi.fn(),
  playbooks: vi.fn(),
  push: vi.fn(),
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
  getIntakeMembers: mocks.members,
  listWorkflows: mocks.workflows,
  listPlaybooks: mocks.playbooks,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
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
const settings = (rules: IntakeAssignmentRule[]): IntakeAutomationSettings => ({
  email: {
    enabled: false,
    provider: null,
    mailbox: null,
    allowed_domains: [],
    from_name: "Legal",
    graph: { tenant_id: null, client_id: null, secret_set: false },
    notification_url: "https://api.example.test/webhooks/intake/graph/1",
    gmail: { client_id: null, key_set: false, deployment_key: false },
    status: { subscription_expires_at: null, last_read_at: null, error: null },
  },
  slack: {
    enabled: false,
    events_url: "https://api.example.test/webhooks/intake/slack/1",
    configured: false,
    team_id: null,
    team_name: null,
    bot_user_id: null,
    missing_scopes: [],
    message_events_seen: false,
  },
  teams: {
    enabled: false,
    events_url: "https://api.example.test/webhooks/intake/teams/1",
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
  rules,
  recent: [],
});
/** Longer than the autosave's pause after typing. */
const SAVE_WAIT = { timeout: 2500 };

/** The API: keeps each update's rules, naming what it can open. */
let server: IntakeAutomationSettings;
const NAMES: Record<string, string> = {
  "workflow:wf-1": "NDA first pass",
  "playbook:pb-1": "Supplier NDA playbook",
};
function applyUpdate(update: IntakeAutomationUpdate) {
  server = {
    ...server,
    rules: (update.rules ?? server.rules).map((r) => ({
      ...r,
      preprocess_with: r.preprocess_with
        ? {
            kind: r.preprocess_with.kind,
            id: r.preprocess_with.id,
            name:
              NAMES[`${r.preprocess_with.kind}:${r.preprocess_with.id}`] ??
              null,
          }
        : null,
    })),
  };
  return server;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const table = () => screen.findByRole("textbox", { name: "Rule 1 condition" });

async function rowAction(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
  action: string,
) {
  await user.click(
    screen.getByRole("button", { name: `Actions for rule ${n}` }),
  );
  await user.click(await screen.findByRole("menuitem", { name: action }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  server = settings([rule("The request is about an NDA", "lawyer-a")]);
  mocks.automation.mockImplementation(async () => server);
  mocks.members.mockResolvedValue(members);
  mocks.workflows.mockResolvedValue([
    {
      id: "wf-1",
      is_system: false,
      metadata: { title: "NDA first pass", type: "assistant" },
    },
    // A catalog workflow isn't the organization's to run.
    {
      id: "catalog",
      is_system: true,
      metadata: { title: "Catalog", type: "assistant" },
    },
  ]);
  mocks.playbooks.mockResolvedValue([
    { id: "pb-1", name: "Supplier NDA playbook" },
  ]);
  mocks.update.mockImplementation(
    async (_org: string, update: IntakeAutomationUpdate) => applyUpdate(update),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntakeRules", () => {
  it("lays the rules out as a table, with every member to choose from", async () => {
    render(<IntakeRules orgId="org-a" />);
    expect(await table()).toHaveValue("The request is about an NDA");
    for (const column of [
      "Condition",
      "Assign to",
      "AI preprocessing",
      "Preprocessing rule",
    ])
      expect(screen.getByText(column)).toBeInTheDocument();
    expect(mocks.workflows).toHaveBeenCalledWith("assistant", "org-a");
    expect(mocks.playbooks).toHaveBeenCalledWith("org-a");
    expect(
      screen.getByRole("button", { name: "Rule 1 AI preprocessing: No" }),
    ).toBeInTheDocument();
    // Without preprocessing there is no rule to follow.
    expect(
      screen.getByRole("button", {
        name: "Rule 1 preprocessing rule: not used",
      }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Rule 1 assigns to Lawyer A" }),
    );
    expect(
      screen.getByRole("menuitemradio", { name: /^Lawyer A/ }),
    ).toHaveAttribute("aria-checked", "true");
    // Emails are shown whole.
    expect(screen.getByText(LONG_EMAIL)).toHaveClass("block");
    expect(screen.getByText(LONG_EMAIL).parentElement).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("turns preprocessing on and attaches a workflow or playbook, saving each change", async () => {
    const user = userEvent.setup();
    render(<IntakeRules orgId="org-a" />);
    await table();
    await user.click(
      screen.getByRole("button", { name: "Rule 1 AI preprocessing: No" }),
    );
    await user.click(await screen.findByRole("menuitemradio", { name: "Yes" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        rules: [
          rule("The request is about an NDA", "lawyer-a", { preprocess: true }),
        ],
      }),
    );
    const picker = screen.getByRole("button", {
      name: "Rule 1 preprocessing rule: None",
    });
    await user.click(picker);
    // The organization's assistant workflows and playbooks, not the catalog's.
    expect(screen.queryByRole("menuitemradio", { name: "Catalog" })).toBeNull();
    expect(
      screen.getByRole("menuitemradio", { name: "NDA first pass" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("menuitemradio", { name: "Supplier NDA playbook" }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        rules: [
          rule("The request is about an NDA", "lawyer-a", {
            preprocess: true,
            // Saved by kind and id; the name is only shown.
            preprocess_with: { kind: "playbook", id: "pb-1" },
          }),
        ],
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Rule 1 preprocessing rule: Supplier NDA playbook",
      }),
    ).toBeEnabled();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    // Yes shows as a green pill.
    expect(screen.getByText("Yes")).toHaveClass(
      "bg-emerald-50",
      "rounded-full",
    );

    // Turned back to No, the preprocessing rule can't be chosen.
    await user.click(
      screen.getByRole("button", { name: "Rule 1 AI preprocessing: Yes" }),
    );
    await user.click(await screen.findByRole("menuitemradio", { name: "No" }));
    expect(
      screen.getByRole("button", {
        name: "Rule 1 preprocessing rule: not used",
      }),
    ).toBeDisabled();
    expect(screen.getByText("No")).toHaveClass("bg-gray-100", "rounded-full");
  });

  it("shows the rules while the workflows and playbooks are still being listed", async () => {
    const user = userEvent.setup();
    mocks.workflows.mockReturnValue(new Promise(() => {}));
    mocks.playbooks.mockReturnValue(new Promise(() => {}));
    server = settings([
      rule("NDAs", "lawyer-a", {
        preprocess: true,
        preprocess_with: {
          kind: "playbook",
          id: "pb-1",
          name: "Supplier NDA playbook",
        },
      }),
    ]);
    render(<IntakeRules orgId="org-a" />);
    expect(await table()).toHaveValue("NDAs");
    // A rule names its own workflow or playbook until the lists arrive.
    await user.click(
      screen.getByRole("button", {
        name: "Rule 1 preprocessing rule: Supplier NDA playbook",
      }),
    );
    expect(screen.getAllByRole("menuitem", { name: "Loading…" })).toHaveLength(
      2,
    );
  });
  it("names a workflow or playbook the admin can't open as such", async () => {
    server = settings([
      rule("NDAs", "lawyer-a", {
        preprocess: true,
        preprocess_with: { kind: "playbook", id: "pb-hidden", name: null },
      }),
    ]);
    render(<IntakeRules orgId="org-a" />);
    await table();
    expect(
      screen.getByRole("button", {
        name: "Rule 1 preprocessing rule: A playbook you can't open",
      }),
    ).toBeInTheDocument();
  });

  it("saves a new rule once it has a condition and a member", async () => {
    const user = userEvent.setup();
    render(<IntakeRules orgId="org-a" />);
    await table();
    await user.click(screen.getByRole("button", { name: "New rule" }));
    const condition = screen.getByRole("textbox", { name: "Rule 2 condition" });
    expect(condition).toHaveFocus();
    await user.type(condition, "Employment questions");
    // Without a member the rule waits, saying what it needs.
    expect(condition).toHaveAccessibleDescription(
      "Choose who to assign to save this rule.",
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(mocks.update).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Rule 2 assigns to no one yet" }),
    );
    await user.click(
      await screen.findByRole("menuitemradio", { name: /^Lawyer B/ }),
    );
    expect(condition).not.toHaveAccessibleDescription();
    await waitFor(
      () =>
        expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
          rules: [
            rule("The request is about an NDA", "lawyer-a"),
            rule("Employment questions", "lawyer-b"),
          ],
        }),
      SAVE_WAIT,
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("moves and removes rules from each row's menu, saving the new order", async () => {
    const user = userEvent.setup();
    server = settings([
      rule("NDAs", "lawyer-a"),
      rule("Employment", "lawyer-b"),
    ]);
    render(<IntakeRules orgId="org-a" />);
    await table();
    await user.click(
      screen.getByRole("button", { name: "Actions for rule 1" }),
    );
    expect(screen.getByRole("menuitem", { name: "Move up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.keyboard("{Escape}");
    await rowAction(user, 2, "Move up");
    expect(
      screen.getByRole("textbox", { name: "Rule 1 condition" }),
    ).toHaveValue("Employment");
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        rules: [rule("Employment", "lawyer-b"), rule("NDAs", "lawyer-a")],
      }),
    );
    await rowAction(user, 1, "Delete");
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
        rules: [rule("NDAs", "lawyer-a")],
      }),
    );
    await rowAction(user, 1, "Delete");
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("org-a", { rules: [] }),
    );
    expect(screen.getByText("No rules yet")).toBeInTheDocument();
  });

  it("keeps fields open while a save is out, and saves what was typed meanwhile next", async () => {
    const user = userEvent.setup();
    const pending = deferred<IntakeAutomationSettings>();
    mocks.update.mockImplementationOnce(
      async (_org: string, update: IntakeAutomationUpdate) => {
        const next = applyUpdate(update);
        await pending.promise;
        return next;
      },
    );
    render(<IntakeRules orgId="org-a" />);
    const condition = await table();
    await user.clear(condition);
    await user.type(condition, "Employment");
    await waitFor(
      () => expect(mocks.update).toHaveBeenCalledTimes(1),
      SAVE_WAIT,
    );
    expect(condition).toBeEnabled();
    await user.type(condition, " and leases");
    pending.resolve(server);
    await waitFor(
      () =>
        expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
          rules: [rule("Employment and leases", "lawyer-a")],
        }),
      SAVE_WAIT,
    );
    expect(condition).toHaveValue("Employment and leases");
  });

  it("still shows the rules when workflows and playbooks can't be listed", async () => {
    mocks.workflows.mockRejectedValue(new Error("Unavailable"));
    server = settings([rule("NDAs", "lawyer-a", { preprocess: true })]);
    render(<IntakeRules orgId="org-a" />);
    await table();
    await userEvent.click(
      screen.getByRole("button", { name: "Rule 1 preprocessing rule: None" }),
    );
    expect(
      screen.getByText("Couldn’t load every workflow and playbook."),
    ).toBeInTheDocument();
  });

  it("tells a member who isn't an owner or admin that they cannot change them", async () => {
    mocks.automation.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    render(<IntakeRules orgId="org-a" />);
    expect(
      await screen.findByText(
        "Only owners and admins can change intake rules.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows loading rows in the table's columns while it loads", () => {
    mocks.automation.mockReturnValue(new Promise(() => {}));
    render(<IntakeRules orgId="org-a" />);
    const loading = screen.getByLabelText("Loading the rules");
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(within(loading).queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "New rule" })).toBeDisabled();
  });

  it.each([
    ["org-a", "/organizations/org-a/settings/intake"],
    ["personal", "/settings/intake"],
  ])(
    "is a page of its own in %s's settings, leading back to Intake",
    async (orgId, intakeHref) => {
      const user = userEvent.setup();
      render(<IntakeRulesPage orgId={orgId} />);
      expect(
        screen.getByRole("heading", { level: 1, name: "Intake rules" }),
      ).toBeInTheDocument();
      await table();
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(mocks.push).toHaveBeenCalledWith(intakeHref);
    },
  );

  it("searches and filters the rules, keeping each rule's priority", async () => {
    const user = userEvent.setup();
    server = settings([
      rule("NDAs", "lawyer-a", { preprocess: true }),
      rule("Employment questions", "lawyer-b"),
      rule("Supplier contracts", "lawyer-a"),
    ]);
    render(<IntakeRules orgId="org-a" />);
    await table();
    // The first column is each rule's priority: the order rules are tried in.
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.queryByText(/first rule whose condition/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filter by member" }));
    await user.click(await screen.findByRole("menuitem", { name: "Lawyer B" }));
    expect(
      screen.getByRole("textbox", { name: "Rule 2 condition" }),
    ).toHaveValue("Employment questions");
    expect(
      screen.queryByRole("textbox", { name: "Rule 1 condition" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filter by member" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "All Members" }),
    );
    // The toolbar's tabs split the rules by AI preprocessing.
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Preprocessed" }));
    expect(
      screen.getAllByRole("textbox", { name: /^Rule \d condition$/ }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("textbox", { name: "Rule 1 condition" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Not preprocessed" }));
    expect(
      screen.getAllByRole("textbox", { name: /^Rule \d condition$/ }),
    ).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Search rules…" }));
    await user.type(screen.getByPlaceholderText("Search rules…"), "supplier");
    expect(
      screen.getByRole("textbox", { name: "Rule 3 condition" }),
    ).toHaveValue("Supplier contracts");
    expect(
      screen.getAllByRole("textbox", { name: /^Rule \d condition$/ }),
    ).toHaveLength(1);
    await user.type(screen.getByPlaceholderText("Search rules…"), " nothing");
    expect(screen.getByText("No matching rules")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      screen.getAllByRole("textbox", { name: /^Rule \d condition$/ }),
    ).toHaveLength(3);
    // Filtering only shows: nothing was saved.
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("acts on the selected rules from the toolbar's Actions, asking before deleting", async () => {
    const user = userEvent.setup();
    server = settings([
      rule("NDAs", "lawyer-a"),
      rule("Employment questions", "lawyer-b"),
      rule("Supplier contracts", "lawyer-a"),
    ]);
    render(<IntakeRules orgId="org-a" />);
    await table();
    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Select rule 1" }));
    await user.click(screen.getByRole("checkbox", { name: "Select rule 3" }));
    expect(
      screen.getByRole("checkbox", { name: "Select all rules" }),
    ).toHaveProperty("indeterminate", true);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Turn on AI preprocessing" }),
    );
    await waitFor(
      () =>
        expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
          rules: [
            rule("NDAs", "lawyer-a", { preprocess: true }),
            rule("Employment questions", "lawyer-b"),
            rule("Supplier contracts", "lawyer-a", { preprocess: true }),
          ],
        }),
      SAVE_WAIT,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText("Delete 2 rules?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(
      screen.getAllByRole("textbox", { name: /^Rule \d condition$/ }),
    ).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(
      () =>
        expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
          rules: [rule("Employment questions", "lawyer-b")],
        }),
      SAVE_WAIT,
    );
    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
  });

  it("reorders rules by dragging one onto another", async () => {
    server = settings([
      rule("NDAs", "lawyer-a"),
      rule("Employment questions", "lawyer-b"),
      rule("Supplier contracts", "lawyer-a"),
    ]);
    render(<IntakeRules orgId="org-a" />);
    await table();
    const data = new Map<string, string>();
    const types: string[] = [];
    const dataTransfer = {
      setData: (type: string, value: string) => {
        data.set(type, value);
        types.push(type);
      },
      getData: (type: string) => data.get(type) ?? "",
      types,
      setDragImage: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    };
    const row = (n: number) =>
      screen
        .getByRole("textbox", { name: `Rule ${n} condition` })
        .closest<HTMLElement>("[data-rule-row]")!;
    const handle = row(1).querySelector<HTMLElement>("[draggable]")!;
    // Rule 1, dropped over the bottom half of rule 3, goes last.
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(row(3), { dataTransfer });
    fireEvent.drop(row(3), { dataTransfer });
    fireEvent.dragEnd(handle, { dataTransfer });
    expect(
      screen.getByRole("textbox", { name: "Rule 3 condition" }),
    ).toHaveValue("NDAs");
    await waitFor(
      () =>
        expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
          rules: [
            rule("Employment questions", "lawyer-b"),
            rule("Supplier contracts", "lawyer-a"),
            rule("NDAs", "lawyer-a"),
          ],
        }),
      SAVE_WAIT,
    );
  });

  it("opens a condition that doesn't fit over the rows below, to read and edit it whole", async () => {
    const user = userEvent.setup();
    const long =
      "The request is about a supplier, reseller or distribution agreement worth more than fifty thousand dollars a year";
    server = settings([rule(long, "lawyer-a"), rule("NDAs", "lawyer-b")]);
    render(<IntakeRules orgId="org-a" />);
    await table();
    const [overflowing, fits] = screen.getAllByRole("textbox", {
      name: /^Rule \d condition$/,
    });
    Object.defineProperty(overflowing, "scrollWidth", { value: 600 });
    Object.defineProperty(overflowing, "clientWidth", { value: 300 });
    // One that fits stays on its line.
    await user.click(fits);
    expect(fits).toHaveFocus();
    expect(
      screen.queryByRole("textbox", { name: "Rule 2 condition" })?.tagName,
    ).toBe("INPUT");

    await user.click(overflowing);
    const open = screen.getByRole("textbox", { name: "Rule 1 condition" });
    expect(open.tagName).toBe("TEXTAREA");
    expect(open).toHaveFocus();
    expect(open).toHaveValue(long);
    await user.type(open, " or a framework{Enter}");
    // Enter closes it, back on its line, and a line break never saves.
    const line = screen.getByRole("textbox", { name: "Rule 1 condition" });
    expect(line.tagName).toBe("INPUT");
    expect(line).toHaveValue(`${long} or a framework`);
    await waitFor(
      () =>
        expect(mocks.update).toHaveBeenLastCalledWith("org-a", {
          rules: [
            rule(`${long} or a framework`, "lawyer-a"),
            rule("NDAs", "lawyer-b"),
          ],
        }),
      SAVE_WAIT,
    );
  });

  it("tells a member they cannot change the rules, without reading them", () => {
    render(<IntakeRulesPage orgId="org-a" allowed={false} />);
    expect(
      screen.getByText("Only owners and admins can change intake rules."),
    ).toBeInTheDocument();
    expect(mocks.automation).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
