import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeRequestPickerModal } from "./IntakeRequestPickerModal";
import { AddDocButton } from "../assistant/AddDocButton";
import { notifyError } from "@/app/lib/userFacingError";

const { listIntakeRequests } = vi.hoisted(() => ({
  listIntakeRequests: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", () => ({ listIntakeRequests }));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ workspaceId: "org-1" }),
}));

const summary = (id: string, subject: string) => ({
  id,
  subject,
  requester_name: "Daniel Okafor",
  state: "in_review",
  clarify_stage: null,
});

describe("IntakeRequestPickerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIntakeRequests.mockResolvedValue({
      requests: [
        summary("request-1", "Supplier NDA - Kestrel Components"),
        summary("request-2", "Reseller NDA - Atlas Distribution"),
      ],
      next_cursor: null,
    });
  });

  it("lists the workspace's open requests and hands back the one picked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <IntakeRequestPickerModal
        open
        onClose={onClose}
        onSelect={onSelect}
        breadcrumbs={["Assistant", "Add intake request"]}
      />,
    );
    const row = await screen.findByRole("button", {
      name: /Supplier NDA - Kestrel Components/,
    });
    expect(listIntakeRequests).toHaveBeenCalledWith("org-1", {
      scope: "open",
      search: undefined,
    });
    expect(row).toHaveTextContent("Daniel Okafor · In progress");
    const use = screen.getByRole("button", { name: "Use" });
    expect(use).toBeDisabled();

    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(use);
    expect(onSelect).toHaveBeenCalledWith({
      id: "request-1",
      title: "Supplier NDA - Kestrel Components",
      orgId: "org-1",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("searches on the server", async () => {
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    await screen.findByText("Supplier NDA - Kestrel Components");
    await userEvent.type(
      screen.getByPlaceholderText("Search open requests..."),
      "kestrel",
    );
    await waitFor(() =>
      expect(listIntakeRequests).toHaveBeenLastCalledWith("org-1", {
        scope: "open",
        search: "kestrel",
      }),
    );
  });

  it("loads the queue's next page on request", async () => {
    listIntakeRequests
      .mockResolvedValueOnce({
        requests: [summary("request-1", "Supplier NDA - Kestrel Components")],
        next_cursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        requests: [summary("request-9", "Older open request")],
        next_cursor: null,
      });
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );
    expect(listIntakeRequests).toHaveBeenLastCalledWith("org-1", {
      scope: "open",
      search: undefined,
      cursor: "cursor-2",
    });
    expect(
      await screen.findByRole("button", { name: /Older open request/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("ignores a Load more retry once a new search has replaced the list", async () => {
    listIntakeRequests
      .mockResolvedValueOnce({
        requests: [summary("request-1", "Supplier NDA - Kestrel Components")],
        next_cursor: "cursor-2",
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        requests: [summary("request-5", "Atlas reseller NDA")],
        next_cursor: null,
      });
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    const retry = vi.mocked(notifyError).mock.calls[0][1]!.onRetry!;
    await userEvent.type(
      screen.getByPlaceholderText("Search open requests..."),
      "atlas",
    );
    await screen.findByRole("button", { name: /Atlas reseller NDA/ });
    const calls = listIntakeRequests.mock.calls.length;
    retry();
    expect(listIntakeRequests).toHaveBeenCalledTimes(calls);
    expect(
      screen.queryByRole("button", {
        name: /Supplier NDA - Kestrel Components/,
      }),
    ).toBeNull();
  });

  it("drops a Load more page that arrives after a new search", async () => {
    let finishOld!: (page: unknown) => void;
    listIntakeRequests
      .mockResolvedValueOnce({
        requests: [summary("request-1", "Supplier NDA - Kestrel Components")],
        next_cursor: "cursor-2",
      })
      .mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValueOnce({
        requests: [summary("request-5", "Atlas reseller NDA")],
        next_cursor: null,
      });
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );
    await userEvent.type(
      screen.getByPlaceholderText("Search open requests..."),
      "atlas",
    );
    await screen.findByRole("button", { name: /Atlas reseller NDA/ });
    await act(async () => {
      finishOld({
        requests: [summary("request-9", "Older open request")],
        next_cursor: "cursor-3",
      });
    });
    expect(
      screen.queryByRole("button", { name: /Older open request/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("retries a failed Load more for the same list", async () => {
    listIntakeRequests
      .mockResolvedValueOnce({
        requests: [summary("request-1", "Supplier NDA - Kestrel Components")],
        next_cursor: "cursor-2",
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        requests: [summary("request-9", "Older open request")],
        next_cursor: null,
      });
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    const retry = vi.mocked(notifyError).mock.calls[0][1]!.onRetry!;
    retry();
    expect(
      await screen.findByRole("button", { name: /Older open request/ }),
    ).toBeInTheDocument();
    expect(listIntakeRequests).toHaveBeenLastCalledWith("org-1", {
      scope: "open",
      search: undefined,
      cursor: "cursor-2",
    });
  });

  it("forgets the pick when a new search fails, so Use can't attach it", async () => {
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Supplier NDA - Kestrel Components/,
      }),
    );
    expect(screen.getByRole("button", { name: "Use" })).toBeEnabled();
    listIntakeRequests.mockRejectedValue(new Error("offline"));
    await userEvent.type(
      screen.getByPlaceholderText("Search open requests..."),
      "x",
    );
    expect(
      await screen.findByText("Requests couldn’t be loaded. Try again later."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use" })).toBeDisabled();
  });

  it("asks for nothing while closed", () => {
    const { container } = render(
      <IntakeRequestPickerModal
        open={false}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(listIntakeRequests).not.toHaveBeenCalled();
  });

  it("keeps a pick the new search still lists, and lets it be unpicked", async () => {
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    const pick = () =>
      screen.findByRole("button", {
        name: /Supplier NDA - Kestrel Components/,
      });
    await userEvent.click(await pick());
    await userEvent.type(
      screen.getByPlaceholderText("Search open requests..."),
      "nda",
    );
    await waitFor(() =>
      expect(listIntakeRequests).toHaveBeenLastCalledWith("org-1", {
        scope: "open",
        search: "nda",
      }),
    );
    expect(await pick()).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(await pick());
    expect(await pick()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Use" })).toBeDisabled();
  });

  it("shows loading rows first, then says when a search matches nothing", async () => {
    let finish!: (page: unknown) => void;
    listIntakeRequests
      .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
      .mockResolvedValueOnce({ requests: [], next_cursor: null });
    const { container } = render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    await waitFor(() =>
      expect(
        container.ownerDocument.querySelector(".animate-pulse"),
      ).not.toBeNull(),
    );
    await userEvent.type(
      screen.getByPlaceholderText("Search open requests..."),
      "zzz",
    );
    expect(await screen.findByText("No matches found")).toBeInTheDocument();
    // The first page, now stale, changes nothing when it finally arrives.
    await act(async () => {
      finish({
        requests: [summary("request-1", "Supplier NDA - Kestrel Components")],
        next_cursor: null,
      });
    });
    expect(screen.getByText("No matches found")).toBeInTheDocument();
  });

  it("says nothing of failures from a list a newer search replaced", async () => {
    let failFirst!: (error: Error) => void;
    let failMore!: (error: Error) => void;
    listIntakeRequests
      .mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject)))
      .mockResolvedValueOnce({
        requests: [summary("request-1", "Supplier NDA - Kestrel Components")],
        next_cursor: "cursor-2",
      })
      .mockReturnValueOnce(new Promise((_, reject) => (failMore = reject)))
      .mockResolvedValueOnce({
        requests: [summary("request-5", "Atlas reseller NDA")],
        next_cursor: null,
      });
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    const search = screen.getByPlaceholderText("Search open requests...");
    await userEvent.type(search, "nda");
    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );
    await userEvent.type(search, " atlas");
    await screen.findByRole("button", { name: /Atlas reseller NDA/ });
    await act(async () => {
      failFirst(new Error("offline"));
      failMore(new Error("offline"));
    });
    expect(
      screen.queryByText("Requests couldn’t be loaded. Try again later."),
    ).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Atlas reseller NDA/ }),
    ).toBeInTheDocument();
  });

  it("says when the requests can't be loaded", async () => {
    listIntakeRequests.mockRejectedValue(new Error("offline"));
    render(
      <IntakeRequestPickerModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        breadcrumbs={[]}
      />,
    );
    expect(
      await screen.findByText("Requests couldn’t be loaded. Try again later."),
    ).toBeInTheDocument();
  });
});

describe("AddDocButton intake requests", () => {
  async function menuItems(props: { onIntakeRequests?: () => void }) {
    render(
      <AddDocButton onBrowseAll={vi.fn()} onLocalFiles={vi.fn()} {...props} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add to message" }),
    );
    return (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
  }

  it("offers intake requests only where the composer asks for them", async () => {
    const onIntakeRequests = vi.fn();
    expect(await menuItems({ onIntakeRequests })).toContain("Intake Requests");
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Intake Requests" }),
    );
    expect(onIntakeRequests).toHaveBeenCalled();
  });

  it("leaves it out elsewhere, such as project chats", async () => {
    expect(await menuItems({})).not.toContain("Intake Requests");
  });
});
