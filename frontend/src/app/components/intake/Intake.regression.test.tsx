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
  IntakeRequest,
  IntakeRequestPage,
  IntakeRequestSummary,
} from "@mike/contracts";
import { IntakeInbox, Inbox } from "./IntakeInbox";
import { IntakeDetail, Detail } from "./IntakeDetail";
import { setIntakeMemoryAccount } from "@/app/lib/intakeMemory";

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  list: vi.fn(),
  submit: vi.fn(),
  edit: vi.fn(),
  request: vi.fn(),
  messages: vi.fn(),
  events: vi.fn(),
  command: vi.fn(),
  documents: vi.fn(),
  upload: vi.fn(),
  document: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
  partial: vi.fn(),
  workspace: {
    accountId: "account-a",
    workspaceId: "org-a",
    activeOrganization: { id: "org-a" },
  },
}));
vi.mock("@/app/lib/mikeApi", () => ({
  getIntakeMembers: mocks.members,
  listIntakeRequests: mocks.list,
  submitIntakeRequest: mocks.submit,
  editIntakeRequest: mocks.edit,
  getIntakeRequest: mocks.request,
  getIntakeMessages: mocks.messages,
  getIntakeEvents: mocks.events,
  commandIntakeRequest: mocks.command,
  getIntakeDocuments: mocks.documents,
  uploadIntakeDocuments: mocks.upload,
  getDocument: mocks.document,
  getDocumentUrl: vi.fn(),
  isMfaRequiredError: (error: { code?: string }) =>
    error?.code === "mfa_verification_required",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
  useWorkspace: () => mocks.workspace,
}));
vi.mock("@/app/hooks/useItemWorkspace", () => ({ useItemWorkspace: vi.fn() }));
vi.mock("@/app/components/shared/PageHeader", () => ({
  PageHeader: ({
    children,
    actions = [],
  }: {
    children?: ReactNode;
    actions?: (
      | false
      | null
      | undefined
      | {
          type?: string;
          title?: string;
          label?: ReactNode;
          disabled?: boolean;
          onClick?: () => void;
        }
    )[];
  }) => (
    <header>
      {children}
      {actions.map((action, index) =>
        !action || action.type === "search" ? null : (
          <button
            key={index}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.type === "new" ? action.title : action.label}
          </button>
        ),
      )}
    </header>
  ),
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
  edit: true,
  assign: true,
  note: true,
  wait: true,
  resume: false,
  resolve: true,
  cancel: true,
  reopen: false,
};
const request = (overrides: Partial<IntakeRequest> = {}): IntakeRequest => ({
  id: "request-a",
  org_id: "org-a",
  category: "general",
  subject: "Confidential request A",
  description: "Request description",
  requester_name: "Jane Business",
  requester_email: "jane@business.test",
  requester_team: "Procurement",
  requested_by_date: null,
  timezone: null,
  state: "in_review",
  version: 1,
  assignee_id: "lawyer-b",
  assignee_name: "Lawyer B",
  created_by_name: "Lawyer A",
  created_at: "2026-10-26T10:00:00Z",
  updated_at: "2026-10-26T10:00:00Z",
  capabilities,
  ...overrides,
});
const summary = (
  overrides: Partial<IntakeRequestSummary> = {},
): IntakeRequestSummary => {
  const full = request();
  return {
    id: full.id,
    category: full.category,
    subject: full.subject,
    requester_name: full.requester_name,
    requester_email: full.requester_email,
    requester_team: full.requester_team,
    requested_by_date: null,
    timezone: null,
    state: full.state,
    version: full.version,
    assignee_id: full.assignee_id,
    assignee_name: full.assignee_name,
    created_at: full.created_at,
    updated_at: full.updated_at,
    capabilities: { assign: true, cancel: true },
    ...overrides,
  };
};
const page = (
  requests: IntakeRequestSummary[] = [],
  next_cursor: string | null = null,
): IntakeRequestPage => ({ requests, next_cursor });
const EMPTY_QUEUE =
  "Record an NDA request or legal question from the business to start tracking it.";
const receipt = {
  request_id: "request-a",
  applied_version: 2,
  message_id: null,
  replayed: false,
};

beforeEach(() => {
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
  mocks.list.mockResolvedValue(page());
  mocks.request.mockResolvedValue(request());
  mocks.messages.mockResolvedValue([]);
  mocks.events.mockResolvedValue([]);
  mocks.documents.mockResolvedValue([]);
  mocks.upload.mockImplementation(async (_org, _request, files: { file: File }[]) =>
    files.map(({ file }) => ({
      clientId: file.name,
      filename: file.name,
      status: "completed",
      result: null,
      errorCode: null,
    })),
  );
  mocks.command.mockResolvedValue(receipt);
  vi.spyOn(window, "confirm").mockReturnValue(false);
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
function fillRequest(subject = "Supplier NDA") {
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: subject },
  });
  fireEvent.change(screen.getByLabelText("Requester"), {
    target: { value: "Jane Business" },
  });
  fireEvent.change(screen.getByLabelText("What do they need?"), {
    target: { value: "  Exact request text\nwith newlines  " },
  });
}

describe("recording requests", () => {
  it("records a request for a named requester and assigns it to its creator", async () => {
    mocks.submit.mockImplementation(
      async (_org: string, body: { id: string }) => ({
        ...receipt,
        request_id: body.id,
      }),
    );
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fillRequest();
    fireEvent.change(screen.getByLabelText("Team (optional)"), {
      target: { value: "Procurement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const body = mocks.submit.mock.calls[0][1];
    expect(body).toMatchObject({
      subject: "Supplier NDA",
      description: "  Exact request text\nwith newlines  ",
      requester_name: "Jane Business",
      requester_email: null,
      requester_team: "Procurement",
      requested_by_date: null,
      timezone: null,
      assignee_id: "account-a",
    });
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(`/intake/${body.id}?org=org-a`),
    );
  });

  it("can leave a request unassigned and checks the email inline", async () => {
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fillRequest();
    fireEvent.change(screen.getByLabelText("Email (optional)"), {
      target: { value: "not an email" },
    });
    expect(
      screen.getByText("Enter an email address like name@company.com."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record request" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email (optional)"), {
      target: { value: "jane@business.test" },
    });
    fireEvent.click(screen.getByLabelText("Assign to me"));
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit.mock.calls[0][1]).toMatchObject({
      requester_email: "jane@business.test",
      assignee_id: null,
    });
  });

  it("requires a known timezone for a target date", async () => {
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fillRequest();
    fireEvent.change(screen.getByLabelText("Target date (optional)"), {
      target: { value: "2026-11-10" },
    });
    fireEvent.change(screen.getByLabelText("Timezone"), {
      target: { value: "Europe/Londn" },
    });
    expect(
      screen.getByText(
        "Choose a timezone from the list, such as Europe/London.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record request" }),
    ).toBeDisabled();
  });

  it("asks in a popup before closing a draft and retains its text when declined", async () => {
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Unsent question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard this draft?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Unsent question");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByLabelText("Subject")).not.toBeInTheDocument();
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
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fillRequest();
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled(),
    );
    const original = structuredClone(mocks.submit.mock.calls[0]);
    expect(mocks.submit.mock.calls[1]).toEqual(original);
    expect(
      screen.getByRole("button", { name: "Record request" }),
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
    const first = render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fillRequest("Final keystroke!");
    fireEvent.click(screen.getByRole("button", { name: "Contract review" }));
    fireEvent.change(screen.getByLabelText("Target date (optional)"), {
      target: { value: "2026-11-10" },
    });
    fireEvent.change(screen.getByLabelText("Timezone"), {
      target: { value: "Europe/Stockholm" },
    });
    fireEvent.click(screen.getByLabelText("Assign to me"));
    first.unmount();
    render(<Inbox orgId="org-a" accountId="account-a" />);
    expect(screen.getByLabelText("Subject")).toHaveValue("Final keystroke!");
    expect(screen.getByLabelText("Requester")).toHaveValue("Jane Business");
    expect(screen.getByLabelText("What do they need?")).toHaveValue(
      "  Exact request text\nwith newlines  ",
    );
    expect(screen.getByRole("button", { name: "Contract review" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Timezone")).toHaveValue("Europe/Stockholm");
    expect(screen.getByLabelText("Assign to me")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await openNewRequest();
    expect(screen.getByLabelText("Subject")).toHaveValue("");
    expect(screen.getByLabelText("Assign to me")).toBeChecked();
  });
});

describe("queue", () => {
  it("shows requester, target date and an overdue marker", async () => {
    mocks.list.mockResolvedValue(
      page([
        summary({
          requested_by_date: "2020-01-15",
          timezone: "UTC",
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

  it("switches between All and Assigned to me, searches lawyers and sorts by target date", async () => {
    const user = userEvent.setup();
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await user.click(await screen.findByRole("button", { name: "Assigned to me" }));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "org-a",
        expect.objectContaining({ assignee: "me" }),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Filter by assigned lawyer" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(
      await screen.findByRole("button", { name: "Filter by assigned lawyer" }),
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

  it("filters the queue by type on the server", async () => {
    const user = userEvent.setup();
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await user.click(
      await screen.findByRole("button", { name: "Filter by type" }),
    );
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["All types", "Contract review", "Legal question"]);
    await user.click(screen.getByRole("menuitem", { name: "Contract review" }));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "org-a",
        expect.objectContaining({ category: "nda" }),
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
  author_name: "Lawyer A",
  created_at: "2026-10-27T10:00:00Z",
  ...overrides,
});
const event = (overrides: Partial<IntakeEvent>): IntakeEvent => ({
  id: 1,
  kind: "submitted",
  from_state: null,
  to_state: "submitted",
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
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files } });
  };

  it("offers a drop zone for every request type and accepts only supported files", async () => {
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    expect(screen.getByText("Documents (optional)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Contract review" }));
    expect(screen.getByText("Documents (optional)")).toBeInTheDocument();
    chooseFiles([contract(), new File(["x"], "notes.txt")]);
    expect(screen.getByText("Supplier NDA.docx")).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported file type");
  });

  it("uploads the documents to the request once it is recorded", async () => {
    mocks.submit.mockImplementation(async (_org: string, body: { id: string }) => ({
      ...receipt,
      request_id: body.id,
    }));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fireEvent.click(screen.getByRole("button", { name: "Contract review" }));
    fillRequest();
    const file = contract();
    chooseFiles([file]);
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
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
    mocks.submit.mockImplementation(async (_org: string, body: { id: string }) => ({
      ...receipt,
      request_id: body.id,
    }));
    mocks.upload.mockRejectedValue(new TypeError("offline"));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fireEvent.click(screen.getByRole("button", { name: "Contract review" }));
    fillRequest();
    chooseFiles([contract()]);
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.partial).toHaveBeenCalledWith(
      "The request was saved, but its documents couldn't be uploaded. Add them from the request.",
      { action: "upload the documents" },
    );
  });

  it("uploads documents for a legal question, keeping them when the type changes", async () => {
    mocks.submit.mockImplementation(async (_org: string, body: { id: string }) => ({
      ...receipt,
      request_id: body.id,
    }));
    render(<Inbox orgId="org-a" accountId="account-a" />);
    await openNewRequest();
    fireEvent.click(screen.getByRole("button", { name: "Contract review" }));
    const file = contract();
    chooseFiles([file]);
    fireEvent.click(screen.getByRole("button", { name: "Legal question" }));
    expect(screen.getByText("Supplier NDA.docx")).toBeInTheDocument();
    fillRequest();
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    const body = mocks.submit.mock.calls[0][1];
    expect(body.category).toBe("general");
    expect(mocks.upload).toHaveBeenCalledWith("org-a", body.id, [{ file }]);
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
    mocks.document.mockResolvedValue({ id: "doc-a", filename: "Supplier NDA.docx" });
    render(
      <Detail orgId="org-a" requestId="request-a" accountId="account-a" />,
    );
    const documents = await screen.findByRole("region", { name: "Documents" });
    expect(within(documents).getByTitle("Schedule.pdf · Processing")).toBeInTheDocument();
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
      expect(mocks.upload).toHaveBeenCalledWith("org-a", "request-a", [{ file }]),
    );
    await waitFor(() => expect(mocks.documents).toHaveBeenCalledTimes(2));
  });
});

describe("request detail", () => {
  it("adds a note without a version and clears the draft once saved", async () => {
    render(detail());
    const editor = await screen.findByLabelText("Add a note");
    fireEvent.change(editor, {
      target: { value: "  Called Jane.\nShe agreed.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0]).toEqual([
      "org-a",
      "request-a",
      "notes",
      { command_id: expect.any(String), body: "  Called Jane.\nShe agreed.  " },
    ]);
    await waitFor(() =>
      expect(screen.getByLabelText("Add a note")).toHaveValue(""),
    );
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it("resolves with an exact resolution and retries the same command after a lost response", async () => {
    mocks.command
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockRejectedValueOnce(new TypeError("offline"));
    const user = userEvent.setup();
    render(detail());
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Resolution");
    fireEvent.change(field, {
      target: { value: "  Approved with edits.\nSecond line  " },
    });
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Check again" }),
      ).toBeEnabled(),
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
    await user.click(
      within(dialog).getByRole("button", { name: "Check again" }),
    );
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(3));
    expect(mocks.command.mock.calls[2]).toEqual(original);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
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
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    fireEvent.change(await screen.findByLabelText("Resolution"), {
      target: { value: "Needs confirmation" },
    });
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Resolve",
      }),
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Resolution")).toHaveValue(
      "Needs confirmation",
    );
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[1][3]).toMatchObject({
      expected_version: 2,
      body: "Needs confirmation",
    });
    expect(mocks.command.mock.calls[1][3].command_id).not.toBe(
      mocks.command.mock.calls[0][3].command_id,
    );
  });

  it("keeps an unsent note when saving an assignment, and assigns to me in one click", async () => {
    render(detail());
    const user = userEvent.setup();
    const editor = await screen.findByLabelText("Add a note");
    fireEvent.change(editor, { target: { value: "Unsent note" } });
    await user.click(screen.getByRole("button", { name: "Assigned to Lawyer B" }));
    // The current assignee is not offered again; the signed-in member comes first.
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Assign to me", "Unassign"]);
    await user.click(screen.getByRole("menuitem", { name: "Assign to me" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Add a note")).toHaveValue("Unsent note");
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

  it("pins the resolution and names people and automatic changes in history", async () => {
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
    const outcome = await screen.findByRole("region", { name: "Resolution" });
    expect(outcome).toHaveTextContent("Approved as drafted.");
    expect(
      screen.getByText("Recorded and assigned to Lawyer B"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unassigned because Lawyer B left the organization"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Automatically ·/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit details" }),
    ).not.toBeInTheDocument();
  });

  it("keeps less common actions in one menu behind a single primary action", async () => {
    const user = userEvent.setup();
    render(detail());
    const summary = await screen.findByRole("region", { name: "Request summary" });
    expect(within(summary).getByText("In progress")).toBeInTheDocument();
    expect(within(summary).getByText("Jane Business")).toBeInTheDocument();
    expect(within(summary).getByText("jane@business.test")).toBeInTheDocument();
    expect(
      within(summary)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["Resolve", "More actions", "Assigned to Lawyer B"]);
    await user.click(within(summary).getByRole("button", { name: "More actions" }));
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "Mark waiting on requester",
      "Edit details",
      "Copy link",
      "Cancel request",
    ]);
    await user.click(
      screen.getByRole("menuitem", { name: "Mark waiting on requester" }),
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
      message({ id: "m1", body: "Called the supplier", created_at: "2026-10-27T10:00:00Z" }),
    ]);
    mocks.events.mockResolvedValue([
      event({ id: 1, created_at: "2026-10-26T10:00:00Z" }),
      event({ id: 2, kind: "wait", created_at: "2026-10-28T10:00:00Z" }),
    ]);
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    const entries = within(activity).getAllByRole("listitem");
    expect(entries.map((entry) => entry.textContent)).toEqual([
      expect.stringContaining("Recorded"),
      expect.stringContaining("Called the supplier"),
      expect.stringContaining("Marked waiting on requester"),
    ]);
  });

  it("adds files dropped anywhere on the page", async () => {
    render(detail());
    const activity = await screen.findByRole("region", { name: "Activity" });
    const file = contractFile();
    const dataTransfer = { types: ["Files"], files: [file], dropEffect: "none" };
    fireEvent.dragEnter(activity, { dataTransfer });
    expect(
      screen.getByText("Drop documents to add them to this request"),
    ).toBeInTheDocument();
    fireEvent.drop(activity, { dataTransfer });
    await waitFor(() =>
      expect(mocks.upload).toHaveBeenCalledWith("org-a", "request-a", [{ file }]),
    );
    expect(
      screen.queryByText("Drop documents to add them to this request"),
    ).not.toBeInTheDocument();
  });

  it("edits details at the loaded version", async () => {
    mocks.edit.mockResolvedValue(receipt);
    const user = userEvent.setup();
    render(detail());
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit details" }));
    expect(screen.getByLabelText("Requester")).toHaveValue("Jane Business");
    fireEvent.change(screen.getByLabelText("Requester"), {
      target: { value: "Sam Business" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
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

  it("refreshes in place when the window regains focus", async () => {
    render(detail());
    await screen.findByText("Confidential request A");
    const refreshed = deferred<IntakeRequest>();
    mocks.request.mockReturnValue(refreshed.promise);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Confidential request A")).toBeInTheDocument();
    await act(async () => refreshed.resolve(request({ subject: "Renamed A" })));
    expect(screen.getByText("Renamed A")).toBeInTheDocument();
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
    fireEvent.change(await screen.findByLabelText("Add a note"), {
      target: { value: "Sensitive draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("Confidential request A"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a note")).not.toBeInTheDocument();
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
    await screen.findByText("Current account request");
    await act(async () =>
      oldAccount.resolve(request({ subject: "Previous account secret" })),
    );
    expect(
      screen.queryByText("Previous account secret"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Current account request")).toBeInTheDocument();
  });
});

describe("history navigation recovery", () => {
  it("restores a note draft after rechecking access", async () => {
    const first = render(detail());
    fireEvent.change(await screen.findByLabelText("Add a note"), {
      target: { value: "Retained note!" },
    });
    first.unmount();
    mocks.request.mockResolvedValue(request({ version: 7 }));
    render(detail());
    expect(screen.queryByLabelText("Add a note")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Add a note")).toHaveValue(
      "Retained note!",
    );
  });

  it("hides a retained draft after access is revoked while away", async () => {
    const first = render(detail());
    fireEvent.change(await screen.findByLabelText("Add a note"), {
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
    fireEvent.change(await screen.findByLabelText("Add a note"), {
      target: { value: "Account A org A" },
    });
    first.unmount();
    const second = render(detail("org-b"));
    expect(await screen.findByLabelText("Add a note")).toHaveValue("");
    second.unmount();
    const third = render(detail("org-a"));
    expect(await screen.findByLabelText("Add a note")).toHaveValue(
      "Account A org A",
    );
    third.unmount();
    setIntakeMemoryAccount("account-b");
    mocks.workspace.accountId = "account-b";
    render(detail("org-a"));
    expect(await screen.findByLabelText("Add a note")).toHaveValue("");
  });
});
