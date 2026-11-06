import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type {
  IntakeEvent,
  IntakeMessage,
  IntakeReceipt,
  IntakeRequest,
  IntakeRequestPage,
  IntakeRequestSummary,
} from "@mike/contracts";
import { IntakeInbox, Inbox } from "./IntakeInbox";
import { IntakeDetail, Detail } from "./IntakeDetail";
import { IntakeNewRequestPage } from "./IntakeNewRequest";
import { setIntakeMemoryAccount } from "@/app/lib/intakeMemory";

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  requesters: vi.fn(),
  copy: vi.fn(),
  list: vi.fn(),
  submit: vi.fn(),
  edit: vi.fn(),
  request: vi.fn(),
  messages: vi.fn(),
  events: vi.fn(),
  command: vi.fn(),
  retry: vi.fn(),
  replySeen: vi.fn(),
  documents: vi.fn(),
  upload: vi.fn(),
  document: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
  partial: vi.fn(),
  dashboard: vi.fn(),
  UploadBatchError: class UploadBatchError extends Error {
    constructor(
      message: string,
      readonly outcomes: { filename: string; status: string }[],
    ) {
      super(message);
    }
  },
  searchParams: new URLSearchParams(),
  workspace: {
    accountId: "account-a",
    workspaceId: "org-a",
    activeOrganization: { id: "org-a" } as { id: string } | null,
  },
}));
vi.mock("@/app/lib/mikeApi", () => ({
  getIntakeMembers: mocks.members,
  getIntakeRequesters: mocks.requesters,
  copyIntakeDocuments: mocks.copy,
  listIntakeRequests: mocks.list,
  submitIntakeRequest: mocks.submit,
  editIntakeRequest: mocks.edit,
  getIntakeRequest: mocks.request,
  getIntakeMessages: mocks.messages,
  getIntakeEvents: mocks.events,
  commandIntakeRequest: mocks.command,
  retryIntakeDelivery: mocks.retry,
  markIntakeReplySeen: mocks.replySeen,
  getIntakeDashboard: mocks.dashboard,
  getIntakeDocuments: mocks.documents,
  uploadIntakeDocuments: mocks.upload,
  UploadBatchError: mocks.UploadBatchError,
  getDocument: mocks.document,
  getDocumentUrl: vi.fn(),
  isMfaRequiredError: (error: { code?: string }) =>
    error?.code === "mfa_verification_required",
}));
// The real Add documents modal needs the app's directory; a stand-in picks
// one library document.
vi.mock("./IntakeDocumentPicker", () => ({
  IntakeDocumentPicker: ({
    open,
    onPick,
    onClose,
  }: {
    open: boolean;
    onPick: (documents: { id: string; filename: string }[]) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Add documents">
        <button
          type="button"
          onClick={() => {
            onClose();
            onPick([{ id: "library-doc", filename: "Library NDA.pdf" }]);
          }}
        >
          Pick Library NDA.pdf
        </button>
      </div>
    ) : null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.push }),
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
  PERSONAL_WORKSPACE: "personal",
  useWorkspace: () => mocks.workspace,
}));
vi.mock("@/app/hooks/useItemWorkspace", () => ({ useItemWorkspace: vi.fn() }));

vi.mock("@/app/components/shared/PageHeader", () => ({
  PageHeader: ({
    children,
    actions: ungrouped = [],
    actionGroups,
    breadcrumbs = [],
  }: {
    children?: ReactNode;
    breadcrumbs?: { label?: ReactNode }[];
    actions?: (
      | false
      | null
      | undefined
      | {
          type?: string;
          title?: string;
          label?: ReactNode;
          render?: ReactNode;
          disabled?: boolean;
          onClick?: () => void;
          value?: string;
          placeholder?: string;
          onChange?: (value: string) => void;
          pressed?: boolean;
        }
    )[];
    actionGroups?: (typeof ungrouped)[];
  }) => {
    const actions = actionGroups ? actionGroups.flat() : ungrouped;
    return (
      <header>
        {/* The current page's title, which may be an editable input. */}
        {breadcrumbs.length > 1 && breadcrumbs[breadcrumbs.length - 1].label}
        {children}
        {actions.map((action, index) =>
          !action ? null : action.type === "search" ? (
            <input
              key={index}
              type="search"
              aria-label={action.placeholder}
              value={action.value}
              onChange={(event) => action.onChange?.(event.target.value)}
            />
          ) : action.type === "custom" ? (
            <span key={index}>{action.render}</span>
          ) : (
            <button
              key={index}
              type="button"
              aria-label={action.type === "new" ? undefined : action.title}
              aria-pressed={action.type === "new" ? undefined : action.pressed}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.type === "new" ? action.title : action.label}
            </button>
          ),
        )}
      </header>
    );
  },
}));
vi.mock("@/app/lib/userFacingError", () => ({
  describeError: () => ({ message: "Could not load requests." }),
  notifyError: mocks.notify,
  notifyPartialFailure: mocks.partial,
}));
vi.mock("@/app/components/shared/DocumentSidePanel", () => ({
  DocumentSidePanel: ({ doc }: { doc: { filename: string } | null }) =>
    doc ? (
      <div role="dialog" aria-label="Document viewer">
        {doc.filename}
      </div>
    ) : null,
}));
vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: ({
    open,
    onVerified,
  }: {
    open: boolean;
    onVerified: () => void;
  }) =>
    open ? (
      <button type="button" onClick={onVerified}>
        Verify MFA
      </button>
    ) : null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const capabilities = {
  delete: true,
  edit: true,
  assign: true,
  note: true,
  wait: true,
  resume: false,
  resolve: true,
  cancel: true,
  reopen: false,
  send_to_requester: false,
  stop_asking: false,
};
const request = (overrides: Partial<IntakeRequest> = {}): IntakeRequest => ({
  id: "request-a",
  org_id: "org-a",
  subject: "Confidential request A",
  description: "Request description",
  requester_name: "Jane Business",
  requester_email: "jane@business.test",
  requester_team: "Procurement",
  requested_by_date: null,
  state: "in_review",
  version: 1,
  assignee_id: "lawyer-b",
  assignee_name: "Lawyer B",
  created_by: "account-a",
  created_by_name: "Lawyer A",
  source: "manual",
  created_at: "2026-10-26T10:00:00Z",
  updated_at: "2026-10-26T10:00:00Z",
  clarify_stage: null,
  clarify_rounds: 0,
  clarify_max_rounds: 2,
  last_reply_at: null,
  new_reply: false,
  conversation: null,
  capabilities,
  ...overrides,
});
const summary = (
  overrides: Partial<IntakeRequestSummary> = {},
): IntakeRequestSummary => {
  const full = request();
  return {
    id: full.id,
    subject: full.subject,
    requester_name: full.requester_name,
    requester_email: full.requester_email,
    requester_team: full.requester_team,
    requested_by_date: null,
    state: full.state,
    version: full.version,
    assignee_id: full.assignee_id,
    assignee_name: full.assignee_name,
    created_at: full.created_at,
    updated_at: full.updated_at,
    clarify_stage: null,
    new_reply: false,
    capabilities: { assign: true, cancel: true, delete: true },
    ...overrides,
  };
};
const page = (
  requests: IntakeRequestSummary[] = [],
  next_cursor: string | null = null,
): IntakeRequestPage => ({ requests, next_cursor });
const EMPTY_QUEUE =
  "Create an NDA request or legal question from the business to start tracking it.";
const receipt = {
  request_id: "request-a",
  applied_version: 2,
  message_id: null,
  replayed: false,
};

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  window.history.replaceState(null, "", "/intake");
  setIntakeMemoryAccount(null);
  vi.resetAllMocks();
  mocks.workspace = {
    accountId: "account-a",
    workspaceId: "org-a",
    activeOrganization: { id: "org-a" },
  };
  mocks.members.mockResolvedValue([
    { user_id: "account-a", display_name: "Lawyer A", email: "a@example.test" },
    { user_id: "lawyer-b", display_name: "Lawyer B", email: "b@example.test" },
  ]);
  mocks.requesters.mockResolvedValue([
    { name: "Jane Business", email: "jane@business.test" },
    { name: "Sam Business", email: null },
  ]);
  mocks.list.mockResolvedValue(page());
  mocks.request.mockResolvedValue(request());
  mocks.messages.mockResolvedValue([]);
  mocks.events.mockResolvedValue([]);
  mocks.documents.mockResolvedValue([]);
  mocks.upload.mockImplementation(
    async (_org, _request, files: { file: File }[]) =>
      files.map(({ file }) => ({
        clientId: file.name,
        filename: file.name,
        status: "completed",
        result: null,
        errorCode: null,
      })),
  );
  mocks.command.mockResolvedValue(receipt);
  mocks.retry.mockResolvedValue({ retried: true });
  mocks.replySeen.mockResolvedValue({ ok: true });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  // jsdom does not scroll; choosing Resolved brings the comment box into view.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openNewRequest() {
  await screen.findByText(EMPTY_QUEUE);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New request" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "New request" }));
}
function setTargetDate(value: string) {
  const input = screen.getByLabelText("Target date");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}
/** Picks an assignee on the new request page once the members have loaded. */
async function chooseAssignee(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("button", { name: /^Reviewer:/ }));
  await user.click(await screen.findByRole("menuitemradio", { name }));
}
function fillRequest(subject = "Supplier NDA") {
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: subject },
  });
  fireEvent.change(screen.getByLabelText("Requester"), {
    target: { value: "Jane Business" },
  });
  fireEvent.change(screen.getByLabelText("Request"), {
    target: { value: "  Exact request text\nwith newlines  " },
  });
}

/** The note editor, opening it first unless a kept draft already shows it. */
async function noteEditor() {
  const button = await screen.findByRole("button", {
    name: /^(Add comment|Submit)$/,
  });
  if (button.textContent === "Add comment") fireEvent.click(button);
  return screen.getByLabelText("Add comment");
}

describe("creating requests", () => {
  it("creates a request for a named requester and assigns it to its creator", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    render(<IntakeNewRequestPage />);
    fillRequest();
    expect(screen.queryByLabelText("Team")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const body = mocks.submit.mock.calls[0][1];
    expect(body).toMatchObject({
      subject: "Supplier NDA",
      description: "  Exact request text\nwith newlines  ",
      requester_name: "Jane Business",
      requester_email: null,
      requester_team: null,
      requested_by_date: null,
      assignee_id: "account-a",
    });
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(`/intake/${body.id}?org=org-a`),
    );
  });

  it("can leave a request unassigned and checks the email inline", async () => {
    const user = userEvent.setup();
    render(<IntakeNewRequestPage />);
    fillRequest();
    fireEvent.change(screen.getByLabelText("Requester email"), {
      target: { value: "not an email" },
    });
    expect(
      screen.getByText("Enter an email address like name@company.com."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create request" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Requester email"), {
      target: { value: "jane@business.test" },
    });
    await chooseAssignee(user, "Unassigned");
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit.mock.calls[0][1]).toMatchObject({
      requester_email: "jane@business.test",
      assignee_id: null,
    });
  });

  it("confirms a typed target date with Enter without creating the request", async () => {
    render(<IntakeNewRequestPage />);
    fillRequest();
    const date = screen.getByLabelText("Target date");
    fireEvent.change(date, { target: { value: "2026-11-10" } });
    // Not cancelled, Enter would submit the surrounding form.
    expect(fireEvent.keyDown(date, { key: "Enter" })).toBe(false);
    expect((date as HTMLInputElement).value).toMatch(/Nov/);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("sends a target date as a calendar date, without a timezone", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    render(<IntakeNewRequestPage />);
    fillRequest();
    setTargetDate("2026-11-10");
    expect(screen.queryByLabelText("Timezone")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const body = mocks.submit.mock.calls[0][1];
    expect(body.requested_by_date).toBe("2026-11-10");
    expect(body).not.toHaveProperty("timezone");
  });

  it("asks in a popup before closing a draft and retains its text when declined", async () => {
    render(<IntakeNewRequestPage />);
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Unsent question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard this draft?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Unsent question");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(mocks.push).toHaveBeenCalledWith("/intake/requests");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("reconciles a lost submission with the same request ID, command ID and text", async () => {
    mocks.submit
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementation(async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }));
    render(<IntakeNewRequestPage />);
    fillRequest();
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled(),
    );
    const original = structuredClone(mocks.submit.mock.calls[0]);
    expect(mocks.submit.mock.calls[1]).toEqual(original);
    expect(
      screen.getByRole("button", { name: "Create request" }),
    ).toBeDisabled();
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        `/intake/${original[1].id}?org=org-a`,
      ),
    );
    expect(mocks.submit.mock.calls[2]).toEqual(original);
  });

  it("restores every field after navigation and clears only a discarded draft", async () => {
    const user = userEvent.setup();
    const first = render(<IntakeNewRequestPage />);
    fillRequest("Final keystroke!");
    setTargetDate("2026-11-10");
    await chooseAssignee(user, "Lawyer B");
    first.unmount();
    const second = render(<IntakeNewRequestPage />);
    expect(screen.getByLabelText("Subject")).toHaveValue("Final keystroke!");
    expect(screen.getByLabelText("Requester")).toHaveValue("Jane Business");
    expect(screen.getByLabelText("Request")).toHaveValue(
      "  Exact request text\nwith newlines  ",
    );
    expect(
      (screen.getByLabelText("Target date") as HTMLInputElement).value,
    ).toMatch(/Nov/);
    expect(
      await screen.findByRole("button", { name: "Reviewer: Lawyer B" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(mocks.push).toHaveBeenCalledWith("/intake/requests");
    second.unmount();
    render(<IntakeNewRequestPage />);
    expect(screen.getByLabelText("Subject")).toHaveValue("");
    expect(
      await screen.findByRole("button", { name: "Reviewer: Lawyer A" }),
    ).toBeInTheDocument();
  });
});

describe("queue", () => {
  it("shows requester, target date and an overdue marker", async () => {
    mocks.list.mockResolvedValue(
      page([
        summary({
          requested_by_date: "2020-01-15",
          assignee_id: null,
          assignee_name: null,
        }),
      ]),
    );
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await screen.findByRole("link", { name: "Confidential request A" });
    expect(screen.getByText("Jane Business")).toBeInTheDocument();
    // The requester column is one line: the name, not their team or email.
    expect(screen.queryByText("Procurement")).not.toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText(", overdue")).toBeInTheDocument();
    expect(screen.getByTitle("Target date passed")).toHaveClass("text-red-600");
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("filters the queue to one requester and clears it with the X", async () => {
    const user = userEvent.setup();
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await user.click(
      await screen.findByRole("button", { name: "Filter by requester" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Sam Business/ }),
    );
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "org-a",
        expect.objectContaining({ requester: "Sam Business" }),
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Filter by requester" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Remove Sam Business from the filter",
      }),
    );
    await waitFor(() =>
      expect(mocks.list.mock.calls.at(-1)?.[1].requester).toBeUndefined(),
    );
  });

  it("searches lawyers to filter by one and sorts by target date", async () => {
    const user = userEvent.setup();
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await user.click(
      await screen.findByRole("button", { name: "Filter by reviewer" }),
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search people" }),
      "b@example",
    );
    await user.click(await screen.findByRole("button", { name: /Lawyer B/ }));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "org-a",
        expect.objectContaining({ assignee: "lawyer-b", sort: "updated" }),
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Sort by target date" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Soonest target first" }),
    );
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "org-a",
        expect.objectContaining({ assignee: "lawyer-b", sort: "target" }),
      ),
    );
  });

  it("loads the next page by cursor without repeating rows", async () => {
    mocks.list
      .mockResolvedValueOnce(page([summary()], "cursor-1"))
      .mockResolvedValueOnce(
        page([
          summary(),
          summary({ id: "request-b", subject: "Second request" }),
        ]),
      );
    render(<Inbox orgId="org-a" accountId="account-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByRole("link", { name: "Second request" });
    expect(mocks.list).toHaveBeenLastCalledWith(
      "org-a",
      expect.objectContaining({ cursor: "cursor-1" }),
    );
    expect(
      screen.getAllByRole("link", { name: "Confidential request A" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes quietly on focus and keeps rows it scrolled to", async () => {
    mocks.list
      .mockResolvedValueOnce(page([summary()], "cursor-1"))
      .mockResolvedValueOnce(
        page([summary({ id: "request-b", subject: "Second request" })]),
      );
    render(<Inbox orgId="org-a" accountId="account-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByRole("link", { name: "Second request" });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("link", { name: "Second request" }),
    ).toBeInTheDocument();
  });

  it("keeps the rows on screen, and drops a missing one from the selection, when a refresh fails", async () => {
    const both = page([
      summary(),
      summary({ id: "request-b", subject: "Second request" }),
    ]);
    mocks.list
      .mockResolvedValueOnce(both)
      .mockResolvedValueOnce(page([summary()]))
      .mockResolvedValueOnce(both)
      .mockRejectedValueOnce(new TypeError("offline"));
    const user = userEvent.setup();
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await user.click(
      await screen.findByRole("checkbox", { name: "Select Second request" }),
    );
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    // Quiet refreshes are at most every 30 seconds.
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const refocus = () => {
      now += 60_000;
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
    };
    // A refresh drops the selected row, and the selection with it.
    refocus();
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Second request" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Actions" }),
    ).not.toBeInTheDocument();
    // When it comes back, it is not selected again.
    refocus();
    expect(
      await screen.findByRole("checkbox", { name: "Select Second request" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Actions" }),
    ).not.toBeInTheDocument();
    // This refresh fails.
    refocus();
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(expect.any(TypeError), {
        action: "refresh the requests",
      }),
    );
    expect(
      screen.getByRole("link", { name: "Second request" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Unable to load requests"),
    ).not.toBeInTheDocument();
  });

  it("drops a next page that was loading when the list refreshed", async () => {
    const more = deferred<IntakeRequestPage>();
    mocks.list
      .mockResolvedValueOnce(page([summary()], "cursor-1"))
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce(
        page(
          [summary({ id: "request-n", subject: "Newest request" }), summary()],
          "cursor-2",
        ),
      );
    render(<Inbox orgId="org-a" accountId="account-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await screen.findByRole("link", { name: "Newest request" });
    await act(async () =>
      more.resolve(
        page([summary({ id: "request-c", subject: "Older request" })]),
      ),
    );
    // That page followed rows that are no longer the last on screen.
    expect(
      screen.queryByRole("link", { name: "Older request" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "org-a",
        expect.objectContaining({ cursor: "cursor-2" }),
      ),
    );
  });

  it("searches at most the 200 characters the API takes", async () => {
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await screen.findByText(EMPTY_QUEUE);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search requests or requesters…" }),
      { target: { value: "x".repeat(300) } },
    );
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "org-a",
        expect.objectContaining({ search: "x".repeat(200) }),
      ),
    );
  });

  it("cancels a request from its row menu with a reason", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(page([summary({ version: 4 })]));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await user.click(
      await screen.findByRole("button", {
        name: "Actions for Confidential request A",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Cancel request" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Cancel request",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Why is this being cancelled?"),
      "Duplicate",
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        "cancel",
        {
          command_id: expect.any(String),
          expected_version: 4,
          body: "Duplicate",
        },
      ),
    );
  });

  it("deletes a request from its row menu only after confirmation", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(page([summary({ version: 4 })]));
    mocks.command.mockResolvedValue(receipt);
    render(<Inbox orgId="org-a" accountId="account-a" />);
    const openMenu = async () =>
      user.click(
        await screen.findByRole("button", {
          name: "Actions for Confidential request A",
        }),
      );
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Cancel request" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Delete request" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Keep request",
      }),
    );
    expect(mocks.command).not.toHaveBeenCalled();

    await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Delete request" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete this request?");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete request" }),
    );
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        "delete",
        { command_id: expect.any(String), expected_version: 4 },
      ),
    );
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("deletes selected requests and reports the ones that changed", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(
      page([
        summary(),
        summary({
          id: "request-b",
          subject: "Second request",
          state: "resolved",
          capabilities: { assign: false, cancel: false, delete: true },
        }),
      ]),
    );
    mocks.command
      .mockResolvedValueOnce(receipt)
      .mockRejectedValueOnce(new Error("changed"));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await user.click(
      await screen.findByRole("checkbox", { name: "Select all requests" }),
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    // Closed requests can't be cancelled, but they can still be deleted.
    expect(
      screen.getByRole("menuitem", { name: "Cancel request" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("menuitem", { name: "Delete 2 requests" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete 2 requests?");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete requests" }),
    );
    await waitFor(() =>
      expect(mocks.partial).toHaveBeenCalledWith(
        "1 of 2 requests couldn't be deleted and are still selected. They may have changed; check them and try again.",
        { action: "delete the requests" },
      ),
    );
    expect(mocks.command.mock.calls.map((call) => call[1])).toEqual([
      "request-a",
      "request-b",
    ]);
    // The one that failed stays selected, so it can be found and retried.
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("checkbox", { name: "Select Second request" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select Confidential request A" }),
    ).not.toBeChecked();
  });

  it("assigns a request to the signed-in member from its row menu", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(page([summary({ version: 3 })]));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await user.click(
      await screen.findByRole("button", {
        name: "Actions for Confidential request A",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Assign to me" }));
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        "assignment",
        expect.objectContaining({
          expected_version: 3,
          assignee_id: "account-a",
        }),
      ),
    );
  });

  it("keeps the person's own requests in Personal, and deletes them for them alone", async () => {
    const user = userEvent.setup();
    const organization = { ...mocks.workspace };
    Object.assign(mocks.workspace, {
      workspaceId: "personal",
      activeOrganization: null,
    });
    try {
      mocks.list.mockResolvedValue(page([summary()]));
      render(<IntakeInbox />);
      await user.click(
        await screen.findByRole("button", {
          name: "Actions for Confidential request A",
        }),
      );
      expect(mocks.list).toHaveBeenCalledWith("personal", expect.anything());
      await user.click(
        screen.getByRole("menuitem", { name: "Delete request" }),
      );
      expect(await screen.findByRole("dialog")).toHaveTextContent(
        "Its notes, history and documents are deleted. This can't be undone.",
      );
    } finally {
      Object.assign(mocks.workspace, organization);
    }
  });

  it("switches to the dashboard page from the header", async () => {
    render(<Inbox orgId="org-a" accountId="account-a" />);
    expect(
      screen.getByRole("heading", { name: "Intake: Requests" }),
    ).toBeInTheDocument();
    const requests = await screen.findByRole("button", { name: "Requests" });
    expect(requests).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(requests);
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(mocks.push).toHaveBeenCalledWith("/intake/dashboard");
  });

  it("opens the list its URL describes and keeps the URL in step", async () => {
    const lawyer = "00000000-0000-4000-8000-0000000000b0";
    mocks.searchParams = new URLSearchParams(
      `tab=resolved&assignee=${lawyer}&sort=updated_asc&q=nda&scope=bogus`,
    );
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith("org-a", {
        search: "nda",
        state: "resolved",
        assignee: lawyer,
        sort: "updated_asc",
      }),
    );
    expect(screen.getByRole("button", { name: "Resolved" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    // A tab is a step Back returns from; a filter only replaces the URL.
    fireEvent.click(screen.getByRole("button", { name: "Outstanding" }));
    await waitFor(() =>
      expect(push).toHaveBeenLastCalledWith(
        null,
        "",
        `?assignee=${lawyer}&sort=updated_asc&q=nda`,
      ),
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search requests or requesters…" }),
      {
        target: { value: "lease" },
      },
    );
    await waitFor(() =>
      expect(replace).toHaveBeenLastCalledWith(
        null,
        "",
        `?assignee=${lawyer}&sort=updated_asc&q=lease`,
      ),
    );
    expect(mocks.list).toHaveBeenLastCalledWith(
      "org-a",
      expect.objectContaining({ search: "lease" }),
    );
  });

  it("lists outstanding requests by default, with the tabs for closed ones", async () => {
    const user = userEvent.setup();
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith("org-a", {
        search: "",
        sort: "updated",
        scope: "open",
      }),
    );
    expect(screen.getByRole("button", { name: "Outstanding" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getAllByRole("button", {
        name: /^(Outstanding|Resolved|Cancelled)$/,
      }),
    ).toHaveLength(3);
    // Only the statuses an outstanding request can have, each with its colour.
    await user.click(screen.getByRole("button", { name: "Filter by status" }));
    expect(
      screen.queryByRole("menuitem", { name: "Resolved" }),
    ).not.toBeInTheDocument();
    const inProgress = screen.getByRole("menuitem", { name: "In progress" });
    expect(
      inProgress.querySelector('[aria-hidden="true"].rounded-full'),
    ).toHaveClass("bg-amber-500");
  });

  it("shows recent figures, which count closed requests too, under no tab", async () => {
    mocks.searchParams = new URLSearchParams("scope=recorded_30d");
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith("org-a", {
        search: "",
        sort: "updated",
        scope: "recorded_30d",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Created in the last 30 days" }),
    ).toBeInTheDocument();
    for (const name of ["Outstanding", "Resolved", "Cancelled"])
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
  });

  it("names a dashboard figure's filter and clears it when chosen", async () => {
    mocks.searchParams = new URLSearchParams("scope=overdue&sort=target");
    mocks.list.mockResolvedValue(page([summary()]));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await screen.findByRole("link", { name: "Confidential request A" });
    expect(mocks.list).toHaveBeenCalledWith("org-a", {
      search: "",
      sort: "target",
      scope: "overdue",
    });
    expect(screen.getByRole("button", { name: "Outstanding" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Overdue" }));
    // Back to the plain Outstanding list.
    await waitFor(() =>
      expect(mocks.list.mock.calls.at(-1)?.[1]).toMatchObject({
        scope: "open",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Overdue" }),
    ).not.toBeInTheDocument();
    expect(window.location.search).toBe("?sort=target");
  });

  it("drops a dashboard figure's filter with any other tab", async () => {
    mocks.searchParams = new URLSearchParams("scope=open");
    render(<Inbox orgId="org-a" accountId="account-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Resolved" }));
    await waitFor(() =>
      expect(mocks.list.mock.calls.at(-1)?.[1]).toEqual({
        search: "",
        state: "resolved",
        sort: "updated",
      }),
    );
    expect(window.location.search).toBe("?tab=resolved");
  });

  it("opens the new request page from New request", async () => {
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    expect(mocks.push).toHaveBeenCalledWith("/intake/new");
  });

  it("loads the queue and offers New request even when the member list fails", async () => {
    mocks.members.mockRejectedValue(new Error("members unavailable"));
    mocks.list.mockResolvedValue(page([summary()]));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await screen.findByRole("link", { name: "Confidential request A" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New request" })).toBeEnabled();
  });

  it("shows a failed list as an error, never as an empty queue", async () => {
    mocks.list.mockRejectedValue(new Error("list unavailable"));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load requests.",
    );
    expect(screen.queryByText(EMPTY_QUEUE)).not.toBeInTheDocument();
  });

  it("clears loaded rows immediately while a new workspace list is pending", async () => {
    const next = deferred<IntakeRequestPage>();
    mocks.list
      .mockResolvedValueOnce(page([summary()]))
      .mockReturnValueOnce(next.promise);
    const view = render(<IntakeInbox />);
    await screen.findByRole("link", { name: "Confidential request A" });
    mocks.workspace = {
      ...mocks.workspace,
      workspaceId: "org-b",
      activeOrganization: { id: "org-b" },
    };
    view.rerender(<IntakeInbox />);
    expect(
      screen.queryByRole("link", { name: "Confidential request A" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading requests");
    await act(async () => next.resolve(page()));
    expect(screen.getByText(EMPTY_QUEUE)).toBeInTheDocument();
  });

  it("rejects stale A responses across A to B to A workspace navigation", async () => {
    const oldA = deferred<IntakeRequestPage>();
    const oldB = deferred<IntakeRequestPage>();
    mocks.list
      .mockReturnValueOnce(oldA.promise)
      .mockReturnValueOnce(oldB.promise)
      .mockResolvedValueOnce(page([summary({ subject: "Fresh A" })]));
    const view = render(<IntakeInbox />);
    mocks.workspace = {
      ...mocks.workspace,
      workspaceId: "org-b",
      activeOrganization: { id: "org-b" },
    };
    view.rerender(<IntakeInbox />);
    mocks.workspace = {
      ...mocks.workspace,
      workspaceId: "org-a",
      activeOrganization: { id: "org-a" },
    };
    view.rerender(<IntakeInbox />);
    await screen.findByRole("link", { name: "Fresh A" });
    await act(async () => {
      oldB.resolve(page([summary({ subject: "Old B" })]));
      oldA.resolve(page([summary({ subject: "Old A" })]));
    });
    expect(screen.getByRole("link", { name: "Fresh A" })).toBeInTheDocument();
    expect(screen.queryByText("Old A")).not.toBeInTheDocument();
    expect(screen.queryByText("Old B")).not.toBeInTheDocument();
  });
});

const contractFile = () =>
  new File(["contract"], "Supplier NDA.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
const message = (overrides: Partial<IntakeMessage>): IntakeMessage => ({
  id: "message-a",
  kind: "note",
  body: "A note",
  author_id: "account-a",
  author_name: "Lawyer A",
  created_at: "2026-10-27T10:00:00Z",
  ...overrides,
});
const event = (overrides: Partial<IntakeEvent>): IntakeEvent => ({
  id: 1,
  kind: "submitted",
  from_state: null,
  to_state: "submitted",
  actor_id: "account-a",
  actor_name: "Lawyer A",
  assignee_name: null,
  created_at: "2026-10-26T10:00:00Z",
  ...overrides,
});
const detail = (orgId = "org-a") => (
  <Detail
    orgId={orgId}
    requestId="request-a"
    accountId={mocks.workspace.accountId}
  />
);

describe("contract review documents", () => {
  const contract = () =>
    new File(["contract"], "Supplier NDA.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  const chooseFiles = (files: File[]) => {
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files } });
  };

  it("offers a drop zone and accepts only supported files", async () => {
    render(<IntakeNewRequestPage />);
    expect(screen.getByText("Documents")).toBeInTheDocument();
    chooseFiles([contract(), new File(["x"], "notes.txt")]);
    expect(screen.getByText("Supplier NDA.docx")).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unsupported file type",
    );
  });

  it("copies library documents picked in Add documents once the request is created", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    mocks.copy.mockResolvedValue([]);
    render(<IntakeNewRequestPage />);
    fillRequest();
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Drag and drop documents here, or click to browse\./,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Pick Library NDA.pdf" }),
    );
    expect(screen.getByText("Library NDA.pdf")).toBeInTheDocument();
    expect(mocks.copy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    const requestId = mocks.submit.mock.calls[0][1].id;
    expect(mocks.copy).toHaveBeenCalledWith("org-a", requestId, [
      "library-doc",
    ]);
  });

  it("uploads the documents to the request once it is created", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    render(<IntakeNewRequestPage />);
    fillRequest();
    const file = contract();
    chooseFiles([file]);
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    const requestId = mocks.submit.mock.calls[0][1].id;
    expect(mocks.upload).toHaveBeenCalledWith("org-a", requestId, [{ file }]);
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.submit.mock.invocationCallOrder[0],
    );
    expect(mocks.push).toHaveBeenCalledWith(`/intake/${requestId}?org=org-a`);
    expect(mocks.partial).not.toHaveBeenCalled();
  });

  it("says the request was saved when its documents fail to upload", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    mocks.upload.mockRejectedValue(new TypeError("offline"));
    render(<IntakeNewRequestPage />);
    fillRequest();
    chooseFiles([contract()]);
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.partial).toHaveBeenCalledWith(
      "The request was saved, but Supplier NDA.docx couldn't be added. Add it from the request.",
      { action: "add the documents" },
    );
  });

  it("names each document that could not be added, uploaded or copied", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    mocks.upload.mockResolvedValue([
      {
        clientId: "a",
        filename: "Supplier NDA.docx",
        status: "error",
        result: null,
        errorCode: "failed",
      },
    ]);
    mocks.copy.mockRejectedValue(new TypeError("offline"));
    render(<IntakeNewRequestPage />);
    fillRequest();
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Drag and drop documents here, or click to browse\./,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Pick Library NDA.pdf" }),
    );
    chooseFiles([contract()]);
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.partial).toHaveBeenCalledTimes(1);
    expect(mocks.partial).toHaveBeenCalledWith(
      "The request was saved, but Supplier NDA.docx and Library NDA.pdf couldn't be added. Add them from the request.",
      { action: "add the documents" },
    );
  });

  it("names only the documents a failed later upload session left out", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    mocks.upload.mockRejectedValue(
      new mocks.UploadBatchError("Session failed", [
        { filename: "Supplier NDA.docx", status: "completed" },
        { filename: "Order form.pdf", status: "error" },
      ]),
    );
    render(<IntakeNewRequestPage />);
    fillRequest();
    chooseFiles([
      contract(),
      new File(["%PDF"], "Order form.pdf", { type: "application/pdf" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.partial).toHaveBeenCalledWith(
      "The request was saved, but Order form.pdf couldn't be added. Add it from the request.",
      { action: "add the documents" },
    );
  });

  it("stays locked until its library documents are copied, so it is never created twice", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    const copied = deferred<[]>();
    mocks.copy.mockReturnValue(copied.promise);
    const view = render(<IntakeNewRequestPage />);
    fillRequest();
    setTargetDate("2026-12-01");
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Drag and drop documents here, or click to browse\./,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Pick Library NDA.pdf" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    const adding = await screen.findByRole("button", {
      name: /Adding documents/,
    });
    expect(adding).toBeDisabled();
    expect(screen.getByLabelText("Target date")).toBeDisabled();
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    fireEvent.submit(adding.closest("form")!);
    // Leaving and coming back while the copy runs keeps the form locked.
    view.unmount();
    render(<IntakeNewRequestPage />);
    expect(
      await screen.findByRole("button", { name: /Adding documents/ }),
    ).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Subject").closest("form")!);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await act(async () => copied.resolve([]));
    // The draft is gone once the documents are in, and the form is free again.
    await waitFor(() =>
      expect(screen.getByLabelText("Subject")).toHaveValue(""),
    );
    expect(screen.getByLabelText("Subject")).toBeEnabled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("says the request goes to its creator even when the member list fails", async () => {
    mocks.members.mockRejectedValue(new TypeError("offline"));
    render(<IntakeNewRequestPage />);
    await waitFor(() => expect(mocks.members).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Reviewer: Myself" }),
    ).toBeInTheDocument();
  });

  it("lists, opens and adds documents on the request", async () => {
    mocks.documents.mockResolvedValue([
      {
        document_id: "doc-a",
        filename: "Supplier NDA.docx",
        file_type: "docx",
        size_bytes: 1234,
        status: "ready",
        added_by_name: "Lawyer A",
        created_at: "2026-10-27T10:00:00Z",
      },
      {
        document_id: "doc-b",
        filename: "Schedule.pdf",
        file_type: "pdf",
        size_bytes: 10,
        status: "processing",
        added_by_name: "Lawyer A",
        created_at: "2026-10-27T10:01:00Z",
      },
    ]);
    mocks.document.mockResolvedValue({
      id: "doc-a",
      filename: "Supplier NDA.docx",
    });
    render(
      <Detail orgId="org-a" requestId="request-a" accountId="account-a" />,
    );
    const documents = await screen.findByRole("region", { name: "Documents" });
    expect(within(documents).getByTitle("Schedule.pdf")).toHaveTextContent(
      "Processing",
    );
    expect(
      within(documents).queryByRole("button", { name: "Open Schedule.pdf" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(documents).getByRole("button", { name: "Open Supplier NDA.docx" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Document viewer" }),
    ).toHaveTextContent("Supplier NDA.docx");
    expect(mocks.document).toHaveBeenCalledWith("doc-a");
    const file = contract();
    chooseFiles([file]);
    await waitFor(() =>
      expect(mocks.upload).toHaveBeenCalledWith("org-a", "request-a", [
        { file },
      ]),
    );
    await waitFor(() => expect(mocks.documents).toHaveBeenCalledTimes(2));
  });
});

describe("request detail", () => {
  it("opens a new Assistant chat with the request ready to process, sending nothing", async () => {
    const user = userEvent.setup();
    render(detail());
    await noteEditor();
    await user.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Process this request in a new Assistant chat",
      }),
    );
    // The composer there shows the request's pill and a suggested prompt.
    expect(mocks.push).toHaveBeenCalledWith(
      "/assistant?intake=request-a&intake_org=org-a",
    );
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("adds a note without a version and clears the draft once saved", async () => {
    render(detail());
    const editor = await noteEditor();
    fireEvent.change(editor, {
      target: { value: "  Called Jane.\nShe agreed.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0]).toEqual([
      "org-a",
      "request-a",
      "notes",
      { command_id: expect.any(String), body: "  Called Jane.\nShe agreed.  " },
    ]);
    // The box stays open, emptied for the next comment.
    await waitFor(() =>
      expect(screen.getByLabelText("Add comment")).toHaveValue(""),
    );
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it("resolves from the note form with the exact note, and retries the same command after a lost response", async () => {
    mocks.command
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockRejectedValueOnce(new TypeError("offline"));
    const user = userEvent.setup();
    render(detail());
    // Choosing Resolved opens the note form rather than a dialog.
    await user.click(await screen.findByRole("button", { name: /^Status:/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Resolved" }));
    const field = await screen.findByLabelText("Add comment");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        block: "center",
        behavior: "smooth",
      }),
    );
    fireEvent.change(field, {
      target: { value: "  Approved with edits.\nSecond line  " },
    });
    await user.click(screen.getByRole("button", { name: "Resolve request" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled(),
    );
    const original = structuredClone(mocks.command.mock.calls[0]);
    expect(original).toEqual([
      "org-a",
      "request-a",
      "resolve",
      {
        command_id: expect.any(String),
        expected_version: 1,
        body: "  Approved with edits.\nSecond line  ",
      },
    ]);
    expect(mocks.command.mock.calls[1]).toEqual(original);
    expect(field).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(3));
    expect(mocks.command.mock.calls[2]).toEqual(original);
    // Once saved, the note that became the resolution is cleared.
    await waitFor(() =>
      expect(screen.getByLabelText("Add comment")).toHaveValue(""),
    );
  });

  it("keeps a resolution after a conflict and resends it as a new command at the refreshed version", async () => {
    mocks.command.mockRejectedValueOnce({
      status: 409,
      code: "intake_conflict",
    });
    mocks.request
      .mockResolvedValueOnce(request())
      .mockResolvedValue(request({ version: 2 }));
    const user = userEvent.setup();
    render(detail());
    fireEvent.change(await noteEditor(), {
      target: { value: "Needs confirmation" },
    });
    await user.click(screen.getByRole("button", { name: "Resolve request" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText("Add comment")).toHaveValue(
      "Needs confirmation",
    );
    await user.click(screen.getByRole("button", { name: "Resolve request" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[1][3]).toMatchObject({
      expected_version: 2,
      body: "Needs confirmation",
    });
    expect(mocks.command.mock.calls[1][3].command_id).not.toBe(
      mocks.command.mock.calls[0][3].command_id,
    );
  });

  it("keeps an unsent note when saving an assignment, and lists every member with the viewer first", async () => {
    render(detail());
    const user = userEvent.setup();
    const editor = await noteEditor();
    fireEvent.change(editor, { target: { value: "Unsent note" } });
    await user.click(
      screen.getByRole("button", { name: "Reviewer: Lawyer B" }),
    );
    const options = screen.getAllByRole("menuitemradio");
    expect(options).toHaveLength(3);
    ["Unassigned", "Myself", "Lawyer B"].forEach((name, i) =>
      expect(options[i]).toHaveAccessibleName(name),
    );
    expect(
      screen.getByRole("menuitemradio", { name: "Lawyer B" }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "Myself" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Add comment")).toHaveValue("Unsent note");
    expect(mocks.command.mock.calls[0]).toEqual([
      "org-a",
      "request-a",
      "assignment",
      {
        command_id: expect.any(String),
        expected_version: 1,
        assignee_id: "account-a",
      },
    ]);
  });

  it("shows people's photos on a closed request too, and copes without them", async () => {
    const photo = "data:image/png;base64,AAAA";
    mocks.request.mockResolvedValue(
      request({
        state: "resolved",
        capabilities: {
          ...capabilities,
          assign: false,
          resolve: false,
          reopen: true,
        },
      }),
    );
    mocks.members.mockResolvedValue([
      {
        user_id: "account-a",
        display_name: "Lawyer A",
        email: "a@example.test",
        profile_photo: photo,
      },
    ]);
    mocks.messages.mockResolvedValue([
      message({
        id: "m2",
        kind: "resolution",
        body: "Approved.",
        author_id: "account-a",
      }),
    ]);
    const { unmount } = render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    await waitFor(() =>
      expect(activity.querySelector(`img[src="${photo}"]`)).not.toBeNull(),
    );
    unmount();
    // Without the member list, a closed request still loads, with initials.
    mocks.members.mockRejectedValue(new Error("members unavailable"));
    render(detail());
    expect(
      await screen.findByRole("region", { name: "Activity" }),
    ).toHaveTextContent("Approved.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads MikeGC's preprocessing report as Markdown and people's notes as typed", async () => {
    mocks.messages.mockResolvedValue([
      message({
        id: "m-report",
        purpose: "preprocessing",
        automated: true,
        author_id: null,
        author_name: "MikeGC",
        body: "AI preprocessing\n\n**Cannot be signed** as is.\n\nMarked up with tracked changes:\n- Supplier NDA.docx: 2 changes",
      }),
      message({ id: "m-note", body: "Keep **this** literal." }),
    ]);
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    expect(
      (await within(activity).findByText("Cannot be signed")).tagName,
    ).toBe("STRONG");
    expect(
      within(activity).getByText("Supplier NDA.docx: 2 changes").tagName,
    ).toBe("LI");
    expect(
      within(activity).getByText("Keep **this** literal."),
    ).toBeInTheDocument();
  });

  it("reads a cancellation's reason in the timeline and offers Reopen in place of a note", async () => {
    const user = userEvent.setup();
    mocks.request.mockResolvedValue(
      request({
        state: "cancelled",
        version: 3,
        capabilities: {
          ...capabilities,
          resolve: false,
          cancel: false,
          reopen: true,
          edit: false,
        },
      }),
    );
    mocks.messages.mockResolvedValue([
      message({ id: "m2", kind: "cancel_reason", body: "Jane withdrew it." }),
    ]);
    mocks.events.mockResolvedValue([event({ id: 3, kind: "cancel" })]);
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    expect(activity).toHaveTextContent(
      "Lawyer A gave the reason for cancelling ·",
    );
    expect(activity).toHaveTextContent("Jane withdrew it.");
    expect(activity).toHaveTextContent("Lawyer A cancelled this ·");
    expect(
      screen.queryByRole("region", { name: "Cancellation reason" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add comment" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        "reopen",
        { command_id: expect.any(String), expected_version: 3 },
      ),
    );
  });

  it("reads the resolution in history, offers Reopen, and names people and automatic changes", async () => {
    mocks.request.mockResolvedValue(
      request({
        state: "resolved",
        capabilities: {
          ...capabilities,
          resolve: false,
          reopen: true,
          edit: false,
        },
      }),
    );
    mocks.messages.mockResolvedValue([
      message({ id: "m1", body: "Called the supplier" }),
      message({ id: "m2", kind: "resolution", body: "Approved as drafted." }),
    ]);
    mocks.events.mockResolvedValue([
      event({ id: 1, assignee_name: "Lawyer B" }),
      event({
        id: 2,
        kind: "assignee_left",
        actor_name: null,
        assignee_name: "Lawyer B",
      }),
      event({ id: 3, kind: "resolve" }),
    ]);
    render(detail());
    // The resolution reads in the timeline; nothing is pinned above it.
    await screen.findByText("Approved as drafted.");
    expect(
      screen.queryByRole("region", { name: "Resolution" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add comment" }),
    ).not.toBeInTheDocument();
    // Each entry reads as who did what; an automatic change has no person.
    const activity = screen.getByRole("region", { name: "Activity" });
    expect(activity).toHaveTextContent(
      "Lawyer A created this and assigned it to Lawyer B ·",
    );
    expect(activity).toHaveTextContent(
      "Automatically unassigned Lawyer B because they left the organization ·",
    );
    expect(activity).toHaveTextContent("Lawyer A recorded the resolution ·");
    const details = screen.getByRole("complementary", { name: "Details" });
    await userEvent
      .setup()
      .click(within(details).getByRole("button", { name: "Status: Resolved" }));
    expect(
      screen.getByRole("menuitem", { name: "Reopen" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    // A closed request's details and title can be read but not changed.
    expect(within(details).queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Subject" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit request" }),
    ).not.toBeInTheDocument();
    expect(details).toHaveTextContent("Jane Business");
  });

  it("shows MikeGC's preprocessing note with its mark, not a person's", async () => {
    mocks.messages.mockResolvedValue([
      message({
        id: "note-mikegc",
        author_id: null,
        author_name: "MikeGC",
        automated: true,
        body: "AI preprocessing\n\nThe NDA runs five years.",
      }),
    ]);
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    await waitFor(() => expect(activity).toHaveTextContent("MikeGC commented"));
    expect(activity).toHaveTextContent("The NDA runs five years.");
    expect(activity.querySelector('[data-actor="mikegc"]')).not.toBeNull();
  });

  it("names MikeGC as the creator of a request it recorded, with where it came from", async () => {
    mocks.request.mockResolvedValue(
      request({ created_by: null, created_by_name: "MikeGC", source: "email" }),
    );
    mocks.events.mockResolvedValue([
      event({
        actor_id: null,
        actor_name: "MikeGC",
        assignee_name: "Lawyer B",
      }),
      event({ id: 2, kind: "assign", assignee_name: "Lawyer A" }),
    ]);
    const { unmount } = render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    expect(activity).toHaveTextContent(
      "MikeGC created this and assigned it to Lawyer B ·",
    );
    // MikeGC's entry has its mark; a member's has their avatar.
    const marks = activity.querySelectorAll("[data-actor]");
    expect(marks[0]).toHaveAttribute("data-actor", "mikegc");
    expect(marks[1]).toHaveAttribute("data-actor", "person");
    const details = screen.getByRole("complementary", { name: "Details" });
    // Plain text after the name, beside MikeGC's mark.
    expect(details).toHaveTextContent("Created byMikeGC from email");
    expect(details.querySelector('[data-actor="mikegc"]')).not.toBeNull();
    expect(
      within(details).queryByRole("img", { name: "MikeGC" }),
    ).not.toBeInTheDocument();
    unmount();

    mocks.request.mockResolvedValue(
      request({ created_by: null, created_by_name: "MikeGC", source: "slack" }),
    );
    render(detail());
    const fromSlack = await screen.findByRole("complementary", {
      name: "Details",
    });
    await waitFor(() =>
      expect(fromSlack).toHaveTextContent("Created byMikeGC from Slack"),
    );
  });

  it("says nothing of a source for a request a member created", async () => {
    render(detail());
    const details = await screen.findByRole("complementary", {
      name: "Details",
    });
    expect(details).toHaveTextContent("Created byLALawyer A");
    expect(details).not.toHaveTextContent(/from (email|Slack)/);
    expect(details.querySelector('[data-actor="mikegc"]')).toBeNull();
  });

  it("changes status from the details panel and copies the link from the header", async () => {
    const user = userEvent.setup();
    render(detail());
    const details = await screen.findByRole("complementary", {
      name: "Details",
    });
    expect(within(details).getByText("In progress")).toBeInTheDocument();
    await user.click(
      within(details).getByRole("button", { name: "Requester: Jane Business" }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Jane Business");
    expect(screen.getByLabelText("Email")).toHaveValue("jane@business.test");
    await user.keyboard("{Escape}");
    // The title above the request edits in place; the heading only names
    // the page for assistive technology.
    expect(
      screen.getByRole("heading", { level: 1, name: "Confidential request A" }),
    ).toHaveClass("sr-only");
    expect(
      within(details)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Status: In progress",
      "Reviewer: Lawyer B",
      "Requester: Jane Business",
      "Choose target date",
    ]);
    const header = screen.getByRole("banner");
    expect(
      within(header)
        .getAllByRole("button")
        .map(
          (button) => button.getAttribute("aria-label") ?? button.textContent,
        ),
    ).toEqual([
      "Process this request in a new Assistant chat",
      "Copy link",
      "More actions",
    ]);
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await user.click(within(header).getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/intake/request-a?org=org-a`,
    );
    await user.click(
      within(details).getByRole("button", { name: "Status: In progress" }),
    );
    expect(screen.getByRole("menuitemradio", { name: "New" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(
      screen.getByRole("menuitemradio", { name: "Waiting on requester" }),
    );
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        "wait",
        expect.objectContaining({ expected_version: 1 }),
      ),
    );
  });

  it("reads notes and changes as one timeline, oldest first", async () => {
    mocks.messages.mockResolvedValue([
      message({
        id: "m1",
        body: "Called the supplier",
        created_at: "2026-10-27T10:00:00Z",
      }),
    ]);
    mocks.events.mockResolvedValue([
      event({ id: 1, created_at: "2026-10-26T10:00:00Z" }),
      event({ id: 2, kind: "wait", created_at: "2026-10-28T10:00:00Z" }),
    ]);
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    const entries = within(activity).getAllByRole("listitem");
    // A note's text sits below its line.
    expect(entries[1].textContent).toMatch(
      /commented · .*Called the supplier$/,
    );
    expect(entries.map((entry) => entry.textContent)).toEqual([
      expect.stringContaining("Lawyer A created this"),
      expect.stringContaining("Lawyer A commented"),
      expect.stringContaining("Lawyer A marked this waiting on the requester"),
    ]);
  });

  it("puts a note before the change saved with it at the same time", async () => {
    const at = "2026-10-27T10:00:00Z";
    mocks.messages.mockResolvedValue([
      message({ id: "m1", body: "Waiting on the draft", created_at: at }),
    ]);
    mocks.events.mockResolvedValue([
      event({ id: 1, created_at: "2026-10-26T10:00:00Z" }),
      event({ id: 2, kind: "wait", created_at: at }),
    ]);
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    expect(
      within(activity)
        .getAllByRole("listitem")
        .map((entry) => entry.textContent),
    ).toEqual([
      expect.stringContaining("created this"),
      expect.stringContaining("commented"),
      expect.stringContaining("marked this waiting on the requester"),
    ]);
  });

  it("deletes the request only after confirmation and returns to the queue", async () => {
    mocks.command.mockResolvedValue(receipt);
    const user = userEvent.setup();
    render(detail());
    const header = screen.getByRole("banner");
    const menu = async () => {
      await user.click(
        await within(header).findByRole("button", { name: "More actions" }),
      );
      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent),
      ).toEqual(["Delete request"]);
      await user.click(
        screen.getByRole("menuitem", { name: "Delete request" }),
      );
      return screen.getByRole("dialog", { name: "Delete this request?" });
    };
    await user.click(
      within(await menu()).getByRole("button", { name: "Keep request" }),
    );
    expect(mocks.command).not.toHaveBeenCalled();
    await user.click(
      within(await menu()).getByRole("button", { name: "Delete request" }),
    );
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        "delete",
        expect.objectContaining({ expected_version: 1 }),
      ),
    );
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/intake/requests"),
    );
    // The deleted request is not loaded again.
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("adds files dropped anywhere on the page", async () => {
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    const file = contractFile();
    const dataTransfer = {
      types: ["Files"],
      files: [file],
      dropEffect: "none",
    };
    fireEvent.dragEnter(activity, { dataTransfer });
    expect(
      screen.getByText("Drop documents to add them to this request"),
    ).toBeInTheDocument();
    fireEvent.drop(activity, { dataTransfer });
    await waitFor(() =>
      expect(mocks.upload).toHaveBeenCalledWith("org-a", "request-a", [
        { file },
      ]),
    );
    expect(
      screen.queryByText("Drop documents to add them to this request"),
    ).not.toBeInTheDocument();
  });

  it("adds documents with a note, tagged on the note and listed with the request's", async () => {
    mocks.command.mockResolvedValue({ ...receipt, message_id: "message-new" });
    let finish = () => {};
    mocks.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([{ status: "completed" }]);
        }),
    );
    mocks.document.mockResolvedValue({
      id: "doc-n",
      filename: "Supplier NDA.docx",
    });
    render(detail());
    const editor = await noteEditor();
    fireEvent.change(editor, { target: { value: "Signed copy attached" } });
    const file = contractFile();
    fireEvent.change(
      editor.parentElement!.querySelector<HTMLInputElement>(
        'input[type="file"]',
      )!,
      { target: { files: [file, new File(["x"], "notes.txt")] } },
    );
    const waiting = screen.getByRole("list", {
      name: "Documents to add with the note",
    });
    expect(waiting).toHaveTextContent("Supplier NDA.docx");
    expect(waiting).not.toHaveTextContent("notes.txt");
    // Nothing is uploaded until the note exists.
    expect(mocks.upload).not.toHaveBeenCalled();

    mocks.messages.mockResolvedValue([
      message({ id: "message-new", body: "Signed copy attached" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(mocks.upload).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        [{ file }],
        { messageId: "message-new" },
      ),
    );
    const activity = screen.getByRole("region", { name: "Activity" });
    // While it uploads, the note already shows the document.
    expect(
      await within(activity).findByTitle("Supplier NDA.docx · Uploading"),
    ).toBeInTheDocument();

    mocks.documents.mockResolvedValue([
      {
        document_id: "doc-n",
        filename: "Supplier NDA.docx",
        file_type: "docx",
        size_bytes: 1234,
        status: "ready",
        added_by_name: "Lawyer A",
        created_at: "2026-10-28T10:00:00Z",
        message_id: "message-new",
      },
    ]);
    finish();
    const tag = await within(activity).findByRole("button", {
      name: "Open Supplier NDA.docx",
    });
    expect(
      within(screen.getByRole("region", { name: "Documents" })).getByRole(
        "button",
        { name: "Open Supplier NDA.docx" },
      ),
    ).toBeInTheDocument();
    fireEvent.click(tag);
    expect(
      await screen.findByRole("dialog", { name: "Document viewer" }),
    ).toHaveTextContent("Supplier NDA.docx");
    expect(mocks.document).toHaveBeenCalledWith("doc-n");
  });

  it("leaves a text drop on the note form to the browser", async () => {
    render(detail());
    const editor = await noteEditor();
    const dataTransfer = {
      types: ["text/plain"],
      files: [],
      dropEffect: "none",
    };
    // Not cancelled, so the browser still inserts the dragged text.
    expect(fireEvent.drop(editor, { dataTransfer })).toBe(true);
    expect(
      screen.queryByRole("list", { name: "Documents to add with the note" }),
    ).not.toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("adds library documents to a note, copied onto it once it is saved", async () => {
    mocks.command.mockResolvedValue({ ...receipt, message_id: "note-1" });
    mocks.copy.mockResolvedValue([]);
    const user = userEvent.setup();
    render(detail());
    const editor = await noteEditor();
    await user.click(screen.getByRole("button", { name: "Add documents" }));
    await user.click(
      screen.getByRole("button", { name: "Pick Library NDA.pdf" }),
    );
    expect(
      screen.getByRole("list", { name: "Documents to add with the note" }),
    ).toHaveTextContent("Library NDA.pdf");
    expect(mocks.copy).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: "Sent the signed copy." } });
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        ["library-doc"],
        "note-1",
      ),
    );
  });

  it("keeps files dropped on the comment box for the comment, until removed", async () => {
    render(detail());
    const editor = await noteEditor();
    const file = contractFile();
    const dataTransfer = {
      types: ["Files"],
      files: [file],
      dropEffect: "none",
    };
    fireEvent.dragEnter(editor, { dataTransfer });
    fireEvent.dragOver(editor, { dataTransfer });
    expect(
      screen.queryByText("Drop documents to add them to this request"),
    ).not.toBeInTheDocument();
    fireEvent.drop(editor, { dataTransfer });
    expect(
      screen.getByRole("list", { name: "Documents to add with the note" }),
    ).toHaveTextContent("Supplier NDA.docx");
    expect(mocks.upload).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Supplier NDA.docx" }),
    );
    expect(
      screen.queryByRole("list", { name: "Documents to add with the note" }),
    ).not.toBeInTheDocument();
    // The box itself is always there; it has no Close.
    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
  });

  it("resolves from the comment box with or without a comment, in place of Cancel", async () => {
    mocks.command.mockResolvedValue(receipt);
    const user = userEvent.setup();
    render(detail());
    const editor = await noteEditor();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    // With nothing typed, it resolves without a resolution.
    const resolve = screen.getByRole("button", { name: "Resolve request" });
    expect(resolve).toBeEnabled();
    await user.click(resolve);
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0][3]).not.toHaveProperty("body");
    // A comment, when there is one, becomes the resolution.
    fireEvent.change(editor, { target: { value: "Signed as drafted." } });
    await user.click(resolve);
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        "resolve",
        expect.objectContaining({ body: "Signed as drafted." }),
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reads a resolution under its resolved entry in the timeline", async () => {
    const at = "2026-10-28T10:00:00Z";
    mocks.request.mockResolvedValue(
      request({
        state: "resolved",
        capabilities: {
          ...capabilities,
          edit: false,
          assign: false,
          resolve: false,
          cancel: false,
          reopen: true,
        },
      }),
    );
    mocks.messages.mockResolvedValue([
      message({
        id: "m1",
        kind: "resolution",
        body: "Signed as drafted.",
        created_at: at,
      }),
    ]);
    mocks.events.mockResolvedValue([
      event({ id: 1, created_at: "2026-10-26T10:00:00Z" }),
      event({ id: 2, kind: "resolve", to_state: "resolved", created_at: at }),
    ]);
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    const entries = within(activity).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[1]).toHaveTextContent(
      /resolved this · .*Signed as drafted\.$/,
    );
  });

  it("leaves Resolve request out when the request cannot be resolved", async () => {
    // An open request the server says this member cannot resolve.
    mocks.request.mockResolvedValue(
      request({ capabilities: { ...capabilities, resolve: false } }),
    );
    render(detail());
    await noteEditor();
    expect(
      screen.queryByRole("button", { name: "Resolve request" }),
    ).not.toBeInTheDocument();
  });

  it("asks for documents in the field and says what is uploading", async () => {
    let finish = () => {};
    mocks.upload.mockImplementation(
      (_org, _request, files: { file: File }[]) =>
        new Promise((resolve) => {
          finish = () =>
            resolve(
              files.map(({ file }) => ({
                clientId: file.name,
                filename: file.name,
                status: "completed",
                result: null,
                errorCode: null,
              })),
            );
        }),
    );
    const browse = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    render(detail());
    const documents = await screen.findByRole("region", { name: "Documents" });
    fireEvent.click(
      within(documents).getByRole("button", {
        name: /^Drag and drop documents here, or click to browse\./,
      }),
    );
    // Clicking opens Add documents, and a picked library file is copied on.
    expect(browse).not.toHaveBeenCalled();
    mocks.copy.mockResolvedValue([]);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Add documents" })).getByRole(
        "button",
        { name: "Pick Library NDA.pdf" },
      ),
    );
    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        ["library-doc"],
        null,
      ),
    );
    fireEvent.change(
      documents.querySelector<HTMLInputElement>('input[type="file"]')!,
      { target: { files: [contractFile()] } },
    );
    expect(
      await within(documents).findByText("Uploading 1 document…"),
    ).toBeInTheDocument();
    expect(
      within(documents).queryByRole("button", { name: /click to/ }),
    ).not.toBeInTheDocument();
    mocks.documents.mockResolvedValue([
      {
        document_id: "doc-a",
        filename: "Supplier NDA.docx",
        file_type: "docx",
        size_bytes: 8,
        status: "ready",
        added_by_name: "Lawyer A",
        created_at: "2026-10-27T10:00:00Z",
      },
    ]);
    finish();
    // With documents, the grey field gives way to an Add menu by the heading.
    const add = await within(documents).findByRole("button", {
      name: "Add documents",
    });
    expect(
      within(documents).getByRole("button", { name: "Open Supplier NDA.docx" }),
    ).toBeInTheDocument();
    expect(
      within(documents).queryByRole("button", { name: /click to/ }),
    ).not.toBeInTheDocument();
    browse.mockClear();
    await userEvent.click(add);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Upload Documents" }),
    );
    expect(browse).toHaveBeenCalledTimes(1);
    await userEvent.click(add);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Saved Documents" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Add documents" }),
    ).toBeInTheDocument();
  });

  it("saves a detail field at the loaded version when it is left", async () => {
    mocks.edit.mockResolvedValue(receipt);
    render(detail());
    fireEvent.click(
      await screen.findByRole("button", { name: "Requester: Jane Business" }),
    );
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: " Sam Business " } });
    fireEvent.blur(name);
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(mocks.edit.mock.calls[0]).toEqual([
      "org-a",
      "request-a",
      expect.objectContaining({
        expected_version: 1,
        requester_name: "Sam Business",
        requester_email: "jane@business.test",
        description: "Request description",
      }),
    ]);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  });

  it("does not save an unchanged or invalid field, and Escape puts it back", async () => {
    render(detail());
    fireEvent.click(
      await screen.findByRole("button", { name: "Requester: Jane Business" }),
    );
    const email = screen.getByLabelText("Email");
    fireEvent.blur(email);
    fireEvent.change(email, { target: { value: "not an email" } });
    fireEvent.keyDown(email, { key: "Enter" });
    expect(
      screen.getByText("Enter an email address like name@company.com."),
    ).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(email, { key: "Escape" });
    expect(email).toHaveValue("jane@business.test");
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it("waits for a saving change before sending the next field's edit", async () => {
    const first = deferred<typeof receipt>();
    mocks.edit
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ...receipt, applied_version: 3 });
    render(detail());
    fireEvent.click(
      await screen.findByRole("button", { name: "Requester: Jane Business" }),
    );
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Sam Business" } });
    fireEvent.blur(name);
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "sam@business.test" } });
    fireEvent.blur(email);
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    mocks.request.mockResolvedValue(
      request({ version: 2, requester_name: "Sam Business" }),
    );
    await act(async () => first.resolve(receipt));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));
    // The queued edit carries the saved name and the refreshed version.
    expect(mocks.edit.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        expected_version: 2,
        requester_name: "Sam Business",
        requester_email: "sam@business.test",
        // A team recorded earlier is kept although the field is hidden.
        requester_team: "Procurement",
      }),
    );
  });

  it("sends a command made just after its own last change at that change's version", async () => {
    mocks.command
      .mockResolvedValueOnce({ ...receipt, applied_version: 2 })
      .mockResolvedValueOnce({ ...receipt, applied_version: 3 });
    const user = userEvent.setup();
    render(detail());
    const details = await screen.findByRole("complementary", {
      name: "Details",
    });
    // The refresh after the assignment has not arrived yet.
    mocks.request.mockReturnValue(deferred<IntakeRequest>().promise);
    await user.click(
      within(details).getByRole("button", { name: "Reviewer: Lawyer B" }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: "Myself" }));
    const status = within(details).getByRole("button", {
      name: "Status: In progress",
    });
    await waitFor(() => expect(status).toBeEnabled());
    await user.click(status);
    await user.click(
      screen.getByRole("menuitemradio", { name: "Waiting on requester" }),
    );
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[1][3]).toMatchObject({
      expected_version: 2,
    });
  });

  it("saves a field once when Enter is followed by leaving it", async () => {
    mocks.edit.mockResolvedValue(receipt);
    render(detail());
    fireEvent.click(
      await screen.findByRole("button", { name: "Requester: Jane Business" }),
    );
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Sam Business" } });
    mocks.request.mockResolvedValue(
      request({ version: 2, requester_name: "Sam Business" }),
    );
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.blur(name);
    expect(
      await screen.findByRole("button", { name: "Requester: Sam Business" }),
    ).toBeInTheDocument();
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });

  it("sends a target date alone, as a calendar date", async () => {
    mocks.edit.mockResolvedValue(receipt);
    render(detail());
    await screen.findByRole("complementary", { name: "Details" });
    expect(screen.queryByLabelText("Timezone")).toBeNull();
    setTargetDate("2026-12-15");
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(mocks.edit.mock.calls[0][2]).toMatchObject({
      requested_by_date: "2026-12-15",
    });
    expect(mocks.edit.mock.calls[0][2]).not.toHaveProperty("timezone");
  });

  it("discards a cancellation reason when its dialog is closed", async () => {
    const user = userEvent.setup();
    render(detail());
    const details = await screen.findByRole("complementary", {
      name: "Details",
    });
    const chooseCancelled = async () => {
      await user.click(
        within(details).getByRole("button", { name: "Status: In progress" }),
      );
      await user.click(
        screen.getByRole("menuitemradio", { name: "Cancelled" }),
      );
      return screen.getByRole("dialog");
    };
    const dialog = await chooseCancelled();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Duplicate" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(await chooseCancelled()).getByRole("textbox")).toHaveValue(
      "",
    );
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("cannot confirm a delete while another change is saving", async () => {
    const saving = deferred<typeof receipt>();
    mocks.edit.mockReturnValue(saving.promise);
    const user = userEvent.setup();
    render(detail());
    await user.click(
      await screen.findByRole("button", { name: "Edit request" }),
    );
    const editor = screen.getByRole("textbox", { name: "Request" });
    fireEvent.change(editor, { target: { value: "A clearer description" } });
    const submit = within(editor.closest("section")!).getByRole("button", {
      name: "Submit",
    });
    await user.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "More actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete request" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this request?" });
    // The edit starts while the confirmation is open.
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    const confirm = within(dialog).getByRole("button", {
      name: "Delete request",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    await act(async () => saving.resolve(receipt));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("takes no files dropped on the comment box while the comment is saving", async () => {
    const saving = deferred<IntakeReceipt>();
    mocks.command.mockReturnValue(saving.promise);
    render(detail());
    const editor = await noteEditor();
    fireEvent.change(editor, { target: { value: "Called the supplier" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    const dataTransfer = {
      types: ["Files"],
      files: [contractFile()],
      dropEffect: "none",
    };
    fireEvent.dragEnter(editor, { dataTransfer });
    fireEvent.drop(editor, { dataTransfer });
    await act(async () =>
      saving.resolve({ ...receipt, message_id: "message-new" }),
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("says the note was added when its documents cannot be uploaded at all", async () => {
    mocks.command.mockResolvedValue({ ...receipt, message_id: "message-new" });
    mocks.upload.mockRejectedValue(new TypeError("offline"));
    render(detail());
    const editor = await noteEditor();
    fireEvent.change(editor, { target: { value: "Signed copy attached" } });
    fireEvent.change(
      editor.parentElement!.querySelector<HTMLInputElement>(
        'input[type="file"]',
      )!,
      { target: { files: [contractFile()] } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(mocks.partial).toHaveBeenCalledWith(
        "The note was added, but its documents couldn't be uploaded. Add them to the request's documents instead.",
        { action: "upload the documents" },
      ),
    );
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("does not report a note when a resolution without text has documents that fail to copy", async () => {
    mocks.command.mockResolvedValue({ ...receipt, message_id: null });
    mocks.copy.mockRejectedValue(new TypeError("offline"));
    render(detail());
    await noteEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add documents" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Pick Library NDA.pdf" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolve request" }));
    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        ["library-doc"],
        null,
      ),
    );
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(expect.any(TypeError), {
        action: "add the documents",
      }),
    );
    expect(mocks.partial).not.toHaveBeenCalled();
  });

  it("keeps Check again for an unconfirmed cancel once the request is hidden", async () => {
    const recheck = deferred<IntakeRequest>();
    mocks.request
      .mockResolvedValueOnce(request())
      .mockReturnValue(recheck.promise);
    mocks.command
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockRejectedValueOnce({ status: 403 });
    const user = userEvent.setup();
    render(detail());
    const details = await screen.findByRole("complementary", {
      name: "Details",
    });
    await user.click(
      within(details).getByRole("button", { name: "Status: In progress" }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: "Cancelled" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Duplicate" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel request" }),
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(3));
    expect(mocks.command.mock.calls[2]).toEqual(mocks.command.mock.calls[0]);
    await act(async () => recheck.reject({ status: 403 }));
  });

  it("renames the request from the page title", async () => {
    mocks.edit.mockResolvedValue(receipt);
    render(detail());
    const title = await screen.findByRole("textbox", { name: "Subject" });
    expect(title).toHaveValue("Confidential request A");
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.blur(title);
    // A request always has a subject.
    expect(title).toHaveValue("Confidential request A");
    fireEvent.change(title, { target: { value: "Renamed request" } });
    fireEvent.keyDown(title, { key: "Enter" });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(mocks.edit).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        expect.objectContaining({ subject: "Renamed request" }),
      ),
    );
  });

  it("edits the description in place and keeps it open until saved", async () => {
    mocks.edit.mockResolvedValue(receipt);
    const user = userEvent.setup();
    render(detail());
    await user.click(
      await screen.findByRole("button", { name: "Edit request" }),
    );
    const editor = screen.getByRole("textbox", { name: "Request" });
    expect(editor).toHaveValue("Request description");
    // The comment box has a Submit of its own, so look in the request's section.
    const section = editor.closest("section")!;
    expect(
      within(section).getByRole("button", { name: "Submit" }),
    ).toBeDisabled();
    await user.clear(editor);
    await user.type(editor, "A clearer description");
    mocks.request.mockResolvedValue(
      request({ version: 2, description: "A clearer description" }),
    );
    await user.click(within(section).getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(mocks.edit).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        expect.objectContaining({ description: "A clearer description" }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Request" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("A clearer description")).toBeInTheDocument();
  });

  it("refreshes in place when the window regains focus", async () => {
    render(detail());
    await screen.findByRole("heading", {
      level: 1,
      name: "Confidential request A",
    });
    const refreshed = deferred<IntakeRequest>();
    mocks.request.mockReturnValue(refreshed.promise);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("heading", { level: 1, name: "Confidential request A" }),
    ).toBeInTheDocument();
    await act(async () => refreshed.resolve(request({ subject: "Renamed A" })));
    expect(
      screen.getByRole("heading", { level: 1, name: "Renamed A" }),
    ).toBeInTheDocument();
  });

  it("hides revoked content immediately after an uncertain 403 while retaining the command", async () => {
    const recheck = deferred<IntakeRequest>();
    mocks.request
      .mockResolvedValueOnce(request())
      .mockReturnValue(recheck.promise);
    mocks.command
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockRejectedValueOnce({ status: 403 });
    render(detail());
    fireEvent.change(await noteEditor(), {
      target: { value: "Sensitive draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("Confidential request A"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add comment")).not.toBeInTheDocument();
    const original = structuredClone(mocks.command.mock.calls[0]);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(3));
    expect(mocks.command.mock.calls[2]).toEqual(original);
    await act(async () => recheck.reject({ status: 403 }));
  });

  it("does not display a late request response after the account changes", async () => {
    const oldAccount = deferred<IntakeRequest>();
    mocks.request
      .mockReturnValueOnce(oldAccount.promise)
      .mockResolvedValueOnce(request({ subject: "Current account request" }));
    const view = render(<IntakeDetail orgId="org-a" requestId="request-a" />);
    mocks.workspace = { ...mocks.workspace, accountId: "account-b" };
    view.rerender(<IntakeDetail orgId="org-a" requestId="request-a" />);
    await screen.findByRole("heading", {
      level: 1,
      name: "Current account request",
    });
    await act(async () =>
      oldAccount.resolve(request({ subject: "Previous account secret" })),
    );
    expect(
      screen.queryByText("Previous account secret"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Current account request",
      }),
    ).toBeInTheDocument();
  });
});

describe("history navigation recovery", () => {
  it("restores a note draft after rechecking access", async () => {
    const first = render(detail());
    fireEvent.change(await noteEditor(), {
      target: { value: "Retained note!" },
    });
    first.unmount();
    mocks.request.mockResolvedValue(request({ version: 7 }));
    render(detail());
    expect(screen.queryByLabelText("Add comment")).not.toBeInTheDocument();
    expect(await noteEditor()).toHaveValue("Retained note!");
  });

  it("hides a retained draft after access is revoked while away", async () => {
    const first = render(detail());
    fireEvent.change(await noteEditor(), {
      target: { value: "Private retained note" },
    });
    first.unmount();
    mocks.request.mockRejectedValue({ status: 403 });
    render(detail());
    await screen.findByRole("alert");
    expect(
      screen.queryByDisplayValue("Private retained note"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Request description")).not.toBeInTheDocument();
  });

  it("keeps drafts separate between organizations and clears them on account change", async () => {
    const first = render(detail("org-a"));
    fireEvent.change(await noteEditor(), {
      target: { value: "Account A org A" },
    });
    first.unmount();
    const second = render(detail("org-b"));
    expect(await noteEditor()).toHaveValue("");
    second.unmount();
    const third = render(detail("org-a"));
    expect(await noteEditor()).toHaveValue("Account A org A");
    third.unmount();
    setIntakeMemoryAccount("account-b");
    mocks.workspace.accountId = "account-b";
    render(detail("org-a"));
    expect(await noteEditor()).toHaveValue("");
  });
});

describe("requester loop", () => {
  const slack = {
    source: "slack" as const,
    channel_name: "legal-requests",
    team_name: null,
    permalink: "https://acme.slack.com/archives/C1/p1700000000000100",
    mailbox: null,
    to: [],
    cc: [],
    max_attachment_bytes: null,
    documents: true,
  };
  const gmail = {
    source: "gmail" as const,
    channel_name: null,
    team_name: null,
    permalink: null,
    mailbox: "intake@acme.test",
    to: ["ana@acme.test"],
    cc: ["ben@acme.test"],
    max_attachment_bytes: 25 * 1024 * 1024,
    documents: true,
  };
  const MB = 1024 * 1024;
  const doc = (
    id: string,
    filename: string,
    size: number,
    extra: Record<string, unknown> = {},
  ) => ({
    document_id: id,
    filename,
    file_type: "docx",
    size_bytes: size,
    status: "ready",
    added_by_name: "MikeGC",
    created_at: "2026-10-26T10:00:00Z",
    message_id: null,
    revised: false,
    ...extra,
  });
  const threaded = (overrides: Partial<IntakeRequest> = {}) =>
    request({
      conversation: slack,
      capabilities: { ...capabilities, send_to_requester: true },
      ...overrides,
    });

  it("messages the requester from the bottom of Messages, keeping the comment box for notes", async () => {
    mocks.request.mockResolvedValue(threaded());
    const user = userEvent.setup();
    render(detail());
    // The comment box writes internal notes only.
    await noteEditor();
    expect(
      screen.queryByRole("button", { name: "Message requester" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Message the requester"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Messages/ }));
    // The history scrolls within the section; the box sits under it.
    const history = screen.getByRole("region", { name: "Message history" });
    expect(history).toHaveClass("max-h-[28rem]", "overflow-y-auto");
    const box = screen.getByLabelText("Message the requester");
    expect(
      history.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // It says who will see the message.
    expect(box).toHaveAccessibleDescription(
      /^Posts in the Slack thread.*visible to everyone in the channel\.$/,
    );
    fireEvent.change(box, { target: { value: "Which entity signs?" } });
    await user.click(screen.getByRole("button", { name: "Ask requester" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0]).toEqual([
      "org-a",
      "request-a",
      "wait",
      {
        command_id: expect.any(String),
        expected_version: 1,
        body: "Which entity signs?",
        send_to_requester: true,
      },
    ]);
    await waitFor(() =>
      expect(screen.getByLabelText("Message the requester")).toHaveValue(""),
    );
  });

  it("offers no way to message the requester on a request with no thread", async () => {
    render(detail());
    await noteEditor();
    expect(
      screen.queryByRole("button", { name: /^Messages/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Message the requester"),
    ).not.toBeInTheDocument();
  });

  it("resolves with a reply: revised documents ticked by default, and the ones past the email limit named first", async () => {
    mocks.request.mockResolvedValue(threaded({ conversation: gmail }));
    mocks.documents.mockResolvedValue([
      doc("redline", "NDA redline.docx", 20 * MB, { revised: true }),
      doc("original", "Schedule.pdf", 1 * MB),
      doc("second", "SOW redline.docx", 10 * MB, { revised: true }),
    ]);
    const user = userEvent.setup();
    render(detail());
    const editor = await noteEditor();
    fireEvent.change(editor, { target: { value: "Approved with edits." } });
    await user.click(screen.getByRole("button", { name: "Resolve request" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Resolve request",
    });
    // Replying is never assumed, even with a comment written.
    const reply = within(dialog).getByRole("switch", {
      name: "Send reply by email",
    });
    expect(reply).toHaveAttribute("aria-checked", "false");
    expect(within(dialog).queryByLabelText("Message")).not.toBeInTheDocument();
    await user.click(reply);
    // The comment starts the reply, which is then written apart from it.
    const message = within(dialog).getByLabelText("Message");
    expect(message).toHaveValue("Approved with edits.");
    fireEvent.change(message, {
      target: { value: "Here are the agreed edits." },
    });
    expect(reply).toHaveAccessibleDescription(
      "Emails ana@acme.test, cc ben@acme.test.",
    );
    const box = (name: RegExp) =>
      within(dialog).getByRole("checkbox", { name });
    expect(box(/NDA redline/)).toBeChecked();
    expect(box(/Schedule/)).not.toBeChecked();
    expect(box(/SOW redline/)).toBeChecked();
    // 20 MB then 10 MB passes 25 MB: the second is named, not attached.
    expect(dialog).toHaveTextContent(
      "1 document may be left out as too large to email",
    );
    expect(box(/SOW redline/).closest("label")).toHaveTextContent(
      "May be too large to email",
    );
    // Tick order decides: the 1 MB schedule fits after the redline.
    await user.click(box(/SOW redline/));
    await user.click(box(/Schedule/));
    expect(dialog).not.toHaveTextContent("may be left out");
    await user.click(
      within(dialog).getByRole("button", { name: "Resolve and reply" }),
    );
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0]).toEqual([
      "org-a",
      "request-a",
      "resolve",
      {
        command_id: expect.any(String),
        expected_version: 1,
        // The comment stays the internal resolution; the reply is sent.
        body: "Approved with edits.",
        send_to_requester: true,
        reply: "Here are the agreed edits.",
        documents: ["redline", "original"],
      },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Resolve request" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("asks first whether to reply, showing the message and documents only once it will", async () => {
    mocks.request.mockResolvedValue(threaded());
    const user = userEvent.setup();
    render(detail());
    await user.click(await screen.findByRole("button", { name: /^Status:/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Resolved" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Resolve request",
    });
    const reply = within(dialog).getByRole("switch", {
      name: "Send reply in Slack",
    });
    expect(reply).toHaveAttribute("aria-checked", "false");
    // The thread is visible to everyone in its channel, and the switch says so.
    expect(reply).toHaveAccessibleDescription(
      /^Posts in the Slack thread.*visible to everyone in the channel\.$/,
    );
    expect(within(dialog).queryByLabelText("Message")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Documents to send"),
    ).not.toBeInTheDocument();
    await user.click(reply);
    expect(within(dialog).getByLabelText("Message")).toHaveValue("");
    expect(within(dialog).getByText("Documents to send")).toBeInTheDocument();
    await user.click(reply);
    expect(within(dialog).queryByLabelText("Message")).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Resolve request" }),
    );
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0][3]).toEqual({
      command_id: expect.any(String),
      expected_version: 1,
    });
  });

  it("says a Slack app without files:write sends text only", async () => {
    mocks.request.mockResolvedValue(
      threaded({ conversation: { ...slack, documents: false } }),
    );
    mocks.documents.mockResolvedValue([
      doc("redline", "NDA redline.docx", MB, { revised: true }),
    ]);
    const user = userEvent.setup();
    render(detail());
    const editor = await noteEditor();
    fireEvent.change(editor, { target: { value: "Done." } });
    await user.click(screen.getByRole("button", { name: "Resolve request" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Resolve request",
    });
    await user.click(
      within(dialog).getByRole("switch", { name: "Send reply in Slack" }),
    );
    expect(dialog).toHaveTextContent(
      "Reinstall the Slack app to send documents.",
    );
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Resolve and reply" }),
    );
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0][3]).toEqual({
      command_id: expect.any(String),
      expected_version: 1,
      body: "Done.",
      send_to_requester: true,
      reply: "Done.",
    });
  });

  it("keeps questions, replies and the resolution reply in a collapsed Messages section, with how each was sent, and retries one that failed", async () => {
    mocks.request.mockResolvedValue(
      threaded({
        state: "resolved",
        capabilities: {
          ...capabilities,
          resolve: false,
          reopen: true,
          send_to_requester: false,
        },
      }),
    );
    const delivery = (overrides: Record<string, unknown> = {}) => ({
      outbound_id: "out-1",
      kind: "question" as const,
      status: "sent" as const,
      error: null,
      sent_at: "2026-10-27T10:00:05Z",
      message_id: null,
      documents: [],
      ...overrides,
    });
    const resolutionDelivery = delivery({
      outbound_id: "out-3",
      kind: "answer",
      message_id: "answer-a",
      documents: [
        { document_id: "d1", filename: "NDA.docx", left_out: false },
        { document_id: "d2", filename: "Big.pdf", left_out: true },
      ],
    });
    mocks.messages.mockResolvedValue([
      message({
        id: "question-mikegc",
        kind: "question",
        automated: true,
        author_id: null,
        author_name: "MikeGC",
        body: "Before Legal starts, MikeGC needs:\n1. Which entity signs?",
        created_at: "2026-10-27T10:00:00Z",
        delivery: delivery(),
      }),
      message({
        id: "question-a",
        kind: "question",
        body: "Is Acme a customer?",
        created_at: "2026-10-27T11:00:00Z",
        delivery: delivery({
          outbound_id: "out-2",
          status: "failed",
          error: "MikeGC was removed from #legal-requests.",
        }),
      }),
      message({
        id: "reply-a",
        kind: "reply",
        author_id: null,
        author_name: "Ana Ruiz",
        body: "Acme Ltd signs. It's a customer.",
        created_at: "2026-10-27T12:00:00Z",
        external_author: {
          name: "Ana Ruiz",
          email: "ana@acme.test",
          source: "slack",
        },
      }),
      message({
        id: "resolution-a",
        kind: "resolution",
        body: "Approved.",
        created_at: "2026-10-28T10:00:00Z",
      }),
      message({
        id: "answer-a",
        kind: "answer",
        body: "Here is the signed NDA.",
        created_at: "2026-10-28T10:00:00Z",
        delivery: resolutionDelivery,
      }),
    ]);
    mocks.events.mockResolvedValue([
      event({ id: 2, kind: "stop_asking", created_at: "2026-10-27T11:30:00Z" }),
      event({
        id: 3,
        kind: "resolve",
        to_state: "resolved",
        created_at: "2026-10-28T10:00:00Z",
        delivery: resolutionDelivery,
      }),
    ]);
    mocks.documents.mockResolvedValue([
      doc("d9", "Signed NDA.pdf", MB, { message_id: "reply-a" }),
    ]);
    const user = userEvent.setup();
    // After userEvent's own clipboard stub, so this one is read.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    await waitFor(() =>
      expect(activity).toHaveTextContent("stopped MikeGC asking the requester"),
    );
    // Activity is the work in the app; the conversation reads in Messages.
    expect(activity).not.toHaveTextContent("asked the requester");
    expect(activity).not.toHaveTextContent("replied in Slack");
    // The resolution reads under its change: what stayed in the app and
    // what went to the requester, apart.
    expect(activity).toHaveTextContent("Internal commentApproved.");
    expect(activity).toHaveTextContent(
      "Reply to the requesterHere is the signed NDA.Sent with NDA.docx",
    );
    const toggle = screen.getByRole("button", { name: /^Messages/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Messages41 not sent");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const log = screen.getByRole("list", {
      name: "Messages with the requester",
    });
    // Oldest first, ours on the right and the requester's on the left.
    const bubbles = [...log.children];
    expect(bubbles.map((b) => b.className.includes("justify-end"))).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(bubbles[0]).toHaveTextContent("MikeGC");
    expect(bubbles[1]).toHaveTextContent("Is Acme a customer?");
    expect(bubbles[2]).toHaveTextContent("Ana Ruiz · Slack");
    expect(bubbles[2]).toHaveTextContent("Signed NDA.pdf");
    expect(bubbles[3]).toHaveTextContent("Resolution");
    // The reply, never the internal comment.
    expect(bubbles[3]).toHaveTextContent("Here is the signed NDA.");
    expect(bubbles[3]).not.toHaveTextContent("Approved.");
    expect(bubbles[3]).toHaveTextContent("Sent with NDA.docx");
    expect(bubbles[3]).toHaveTextContent("Not sent: Big.pdf");
    expect(bubbles[1]).toHaveTextContent(
      "Couldn't send: MikeGC was removed from #legal-requests.",
    );
    // Only the failed one offers Retry and Copy text, naming what they act on.
    expect(
      screen.getAllByRole("button", { name: /^Retry sending/ }),
    ).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: "Copy the text of the question" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Is Acme a customer?"),
    );
    await user.click(
      screen.getByRole("button", { name: "Retry sending the question" }),
    );
    await waitFor(() =>
      expect(mocks.retry).toHaveBeenCalledWith("org-a", "request-a", "out-2"),
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  });

  it("keeps a resolution's internal comment out of Messages when only documents were sent", async () => {
    mocks.request.mockResolvedValue(threaded({ state: "resolved" }));
    mocks.messages.mockResolvedValue([
      message({
        id: "resolution-a",
        kind: "resolution",
        body: "Internal only: the supplier pushed back on the cap.",
        created_at: "2026-10-28T10:00:00Z",
      }),
    ]);
    mocks.events.mockResolvedValue([
      event({
        id: 3,
        kind: "resolve",
        to_state: "resolved",
        created_at: "2026-10-28T10:00:00Z",
        delivery: {
          outbound_id: "out-3",
          kind: "answer",
          status: "failed",
          error: "MikeGC was removed from #legal-requests.",
          message_id: null,
          sent_at: null,
          documents: [{ document_id: "d1", filename: "NDA.docx", left_out: false }],
        },
      }),
    ]);
    const user = userEvent.setup();
    render(detail());
    // Activity has both: the comment that stayed in the app, and the reply,
    // documents alone, with how it went.
    const activity = await screen.findByRole("region", { name: "Activity" });
    await waitFor(() =>
      expect(activity).toHaveTextContent(
        "Internal commentInternal only: the supplier pushed back on the cap.",
      ),
    );
    expect(activity).toHaveTextContent(
      "Reply to the requesterDocuments only.Couldn't send: MikeGC was removed from #legal-requests.",
    );
    const toggle = screen.getByRole("button", { name: /^Messages/ });
    expect(toggle).toHaveTextContent("1 not sent");
    await user.click(toggle);
    const log = screen.getByRole("list", { name: "Messages with the requester" });
    expect(log).toHaveTextContent("Resolution");
    expect(log).toHaveTextContent("Couldn't send: MikeGC was removed from #legal-requests.");
    // The requester never saw the comment.
    expect(log).not.toHaveTextContent("Internal only");
    // No text was sent, so there is none to copy.
    expect(
      screen.queryByRole("button", { name: /^Copy the text/ }),
    ).not.toBeInTheDocument();
    await user.click(
      within(log).getByRole("button", { name: "Retry sending the resolution reply" }),
    );
    await waitFor(() =>
      expect(mocks.retry).toHaveBeenCalledWith("org-a", "request-a", "out-3"),
    );
  });

  it("shows a resolution with nothing sent as its internal comment alone", async () => {
    mocks.request.mockResolvedValue(threaded({ state: "resolved" }));
    mocks.messages.mockResolvedValue([
      message({
        id: "resolution-a",
        kind: "resolution",
        body: "Closed after a call.",
        created_at: "2026-10-28T10:00:00Z",
      }),
    ]);
    mocks.events.mockResolvedValue([
      event({ id: 3, kind: "resolve", to_state: "resolved", created_at: "2026-10-28T10:00:00Z" }),
    ]);
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    await waitFor(() =>
      expect(activity).toHaveTextContent("Internal commentClosed after a call."),
    );
    expect(activity).not.toHaveTextContent("Reply to the requester");
  });

  it("checks on a message still sending and says when it is sent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pending = message({
        id: "question-a",
        kind: "question",
        body: "Which entity signs?",
        delivery: {
          outbound_id: "out-1",
          kind: "question",
          status: "pending",
          error: null,
          sent_at: null,
          message_id: "question-a",
          documents: [],
        },
      });
      mocks.request.mockResolvedValue(threaded());
      mocks.messages
        .mockResolvedValueOnce([pending])
        .mockResolvedValue([
          { ...pending, delivery: { ...pending.delivery!, status: "sent" } },
        ]);
      render(detail());
      const activity = await screen.findByRole("region", { name: "Activity" });
      fireEvent.click(await screen.findByRole("button", { name: /^Messages/ }));
      const log = screen.getByRole("list", {
        name: "Messages with the requester",
      });
      await waitFor(() => expect(log).toHaveTextContent("Sending"));
      await act(async () => {
        vi.advanceTimersByTime(5_100);
      });
      await waitFor(() => expect(log).toHaveTextContent("Sent"));
      expect(activity).toHaveTextContent("Message to the requester sent.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says MikeGC is waiting on the requester, links the thread, and stops asking", async () => {
    mocks.request.mockResolvedValue(
      threaded({
        state: "needs_information",
        clarify_stage: "readiness",
        clarify_rounds: 1,
        capabilities: {
          ...capabilities,
          wait: false,
          resume: true,
          send_to_requester: true,
          stop_asking: true,
        },
      }),
    );
    const user = userEvent.setup();
    render(detail());
    const details = await screen.findByRole("complementary", {
      name: "Details",
    });
    expect(
      within(details).getByRole("button", { name: /^Status:/ }),
    ).toHaveAccessibleName("Status: Waiting on requester (MikeGC asked)");
    expect(details).toHaveTextContent(
      "MikeGC is waiting for the requester's answer (round 1 of 2).",
    );
    const thread = within(details).getByRole("link", {
      name: /Slack thread in #legal-requests/,
    });
    expect(thread).toHaveAttribute("href", slack.permalink);
    expect(thread).toHaveAttribute("target", "_blank");
    await user.click(
      within(details).getByRole("button", { name: "Stop asking" }),
    );
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0]).toEqual([
      "org-a",
      "request-a",
      "stop_asking",
      { command_id: expect.any(String), expected_version: 1 },
    ]);
  });

  it("names an email thread's recipients, each on its own line", async () => {
    mocks.request.mockResolvedValue(threaded({ conversation: gmail }));
    render(detail());
    const details = await screen.findByRole("complementary", {
      name: "Details",
    });
    expect(details).toHaveTextContent("Gmail email from intake@acme.test");
    expect(within(details).getByText("To ana@acme.test")).toBeInTheDocument();
    expect(within(details).getByText("Cc ben@acme.test")).toBeInTheDocument();
  });

  it("clears the New reply flag once Messages is opened to show the reply", async () => {
    mocks.request.mockResolvedValue(
      threaded({ new_reply: true, last_reply_at: "2026-11-03T10:00:00.000Z" }),
    );
    const { unmount } = render(detail());
    // Opening the request isn't reading the reply: Messages starts collapsed.
    const toggle = await screen.findByRole("button", { name: /^Messages/ });
    expect(mocks.replySeen).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    // Only the reply on screen is seen; a later one stays new.
    await waitFor(() =>
      expect(mocks.replySeen).toHaveBeenCalledWith(
        "org-a",
        "request-a",
        "2026-11-03T10:00:00.000Z",
      ),
    );
    expect(mocks.replySeen).toHaveBeenCalledTimes(1);
    unmount();
    mocks.replySeen.mockClear();
    mocks.request.mockResolvedValue(threaded());
    render(detail());
    await screen.findByRole("region", { name: "Activity" });
    expect(mocks.replySeen).not.toHaveBeenCalled();
  });

  it("names where MikeGC recorded a request from Outlook, Gmail or Teams", async () => {
    for (const [source, label] of [
      ["outlook", "Outlook"],
      ["gmail", "Gmail"],
      ["teams", "Teams"],
    ] as const) {
      mocks.request.mockResolvedValue(
        request({ created_by: null, created_by_name: "MikeGC", source }),
      );
      const { unmount } = render(detail());
      const details = await screen.findByRole("complementary", {
        name: "Details",
      });
      await waitFor(() =>
        expect(details).toHaveTextContent(`Created byMikeGC from ${label}`),
      );
      unmount();
    }
  });

  it("shows only the status, counts unread replies, and filters to them", async () => {
    mocks.list.mockResolvedValue(
      page([
        summary({
          state: "needs_information",
          clarify_stage: "rule",
          new_reply: true,
          unread_replies: 3,
        }),
      ]),
    );
    const user = userEvent.setup();
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await screen.findByRole("link", { name: "Confidential request A" });
    expect(screen.getByText("Waiting on requester")).toBeInTheDocument();
    expect(screen.queryByText("New reply")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3 unread replies" })).toHaveTextContent("3");
    await user.click(screen.getByRole("button", { name: "Filter by replies" }));
    await user.click(await screen.findByText("Unread replies"));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "org-a",
        expect.objectContaining({ new_reply: true }),
      ),
    );
    expect(window.location.search).toBe("?reply=new");
  });

});
