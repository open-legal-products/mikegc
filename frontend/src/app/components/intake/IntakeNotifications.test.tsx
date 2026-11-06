import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeNotification } from "@mike/contracts";
import { claimIntakeNotifications } from "@/app/lib/mikeApi";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { ToastViewportUI, clearToasts } from "@/shared/ui/ToastUI";
import {
  INTAKE_NOTIFICATION_CLAIM_WAIT_MS,
  INTAKE_NOTIFICATION_MAX_BACKOFF_MS,
  INTAKE_NOTIFICATION_POLL_MS,
  IntakeNotifications,
} from "./IntakeNotifications";
import { onIntakeNotified } from "./intakeNotificationToasts";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/lib/mikeApi", () => ({ claimIntakeNotifications: vi.fn() }));
vi.mock("@/app/contexts/WorkspaceContext", () => ({ useWorkspace: vi.fn() }));

const notification = (
  extra: Partial<IntakeNotification> = {},
): IntakeNotification => ({
  workspace: "org-1",
  workspace_name: "Acme Legal",
  request_id: "request-1",
  subject: "Supplier NDA for Acme",
  kind: "new_request",
  change: "assign",
  actor_name: "Sam Colleague",
  automated: false,
  channel: null,
  more: 0,
  created_at: "2026-11-04T10:00:00Z",
  ...extra,
});
const claim = vi.mocked(claimIntakeNotifications);
const none = { notifications: [] };
const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  fireEvent(document, new Event("visibilitychange"));
};
const mount = () =>
  render(
    <>
      <IntakeNotifications />
      <ToastViewportUI />
    </>,
  );
const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(useWorkspace).mockReturnValue({
    accountId: "me",
    workspaceId: "org-1",
  } as ReturnType<typeof useWorkspace>);
  claim.mockResolvedValue(none);
});
afterEach(() => {
  cleanup();
  act(() => clearToasts());
  setVisibility("visible");
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("IntakeNotifications", () => {
  it("shows a New Intake Request toast that opens the request", async () => {
    claim.mockResolvedValueOnce({ notifications: [notification()] });
    mount();
    await flush();
    expect(screen.getByText("New Intake Request")).toBeInTheDocument();
    // The request's subject in bold, then what happened, on one line.
    expect(screen.getByTestId("intake-notification-line")).toHaveTextContent(
      "Supplier NDA for Acme: Sam Colleague assigned it to you",
    );
    expect(screen.getByText("Supplier NDA for Acme:")).toHaveClass(
      "font-semibold",
      "text-gray-500",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(push).toHaveBeenCalledWith("/intake/request-1?org=org-1");
    // Opening it closes the toast.
    expect(screen.queryByText("New Intake Request")).not.toBeInTheDocument();
  });
  it("shows an Intake request update, naming another workspace", async () => {
    claim.mockResolvedValueOnce({
      notifications: [
        notification({
          kind: "update",
          change: "reply",
          actor_name: "Jane Business",
          channel: "slack",
          workspace: "org-2",
          workspace_name: "Beta Legal",
        }),
      ],
    });
    mount();
    await flush();
    // Another workspace is named in the title.
    expect(
      screen.getByText("Intake request update (in Beta Legal)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Jane Business replied in Slack")).toBeInTheDocument();
  });
  it("tells open intake views which requests have news", async () => {
    const listener = vi.fn();
    const stop = onIntakeNotified("org-1", listener);
    claim.mockResolvedValueOnce({ notifications: [notification()] });
    mount();
    await flush();
    expect(listener).toHaveBeenCalledWith(["request-1"]);
    stop();
  });
  it("checks every 30 seconds while visible, never while hidden, and at once on return", async () => {
    mount();
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(INTAKE_NOTIFICATION_POLL_MS));
    expect(claim).toHaveBeenCalledTimes(2);
    act(() => setVisibility("hidden"));
    await act(() => vi.advanceTimersByTimeAsync(5 * INTAKE_NOTIFICATION_POLL_MS));
    expect(claim).toHaveBeenCalledTimes(2);
    act(() => setVisibility("visible"));
    await flush();
    expect(claim).toHaveBeenCalledTimes(3);
    // Focus right after a check waits for the next one instead.
    fireEvent(window, new Event("focus"));
    await flush();
    expect(claim).toHaveBeenCalledTimes(3);
  });
  it("says nothing when a check fails, and waits longer before the next", async () => {
    claim.mockRejectedValue(new Error("offline"));
    mount();
    await flush();
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(INTAKE_NOTIFICATION_POLL_MS));
    expect(claim).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(INTAKE_NOTIFICATION_POLL_MS));
    expect(claim).toHaveBeenCalledTimes(2);
    // Never longer than the ceiling, and back to normal once it works.
    await act(() => vi.advanceTimersByTimeAsync(INTAKE_NOTIFICATION_MAX_BACKOFF_MS * 2));
    let calls = claim.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(INTAKE_NOTIFICATION_MAX_BACKOFF_MS));
    expect(claim.mock.calls.length).toBe(calls + 1);
    claim.mockResolvedValue(none);
    await act(() => vi.advanceTimersByTimeAsync(INTAKE_NOTIFICATION_MAX_BACKOFF_MS));
    calls = claim.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(INTAKE_NOTIFICATION_POLL_MS));
    expect(claim.mock.calls.length).toBe(calls + 1);
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
  });
  it("shows a check's notifications once when remounted while it is in flight", async () => {
    let answer!: (claim: { notifications: IntakeNotification[] }) => void;
    claim.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const first = mount();
    first.unmount();
    mount();
    // The remount waits for the same claim instead of starting another.
    expect(claim).toHaveBeenCalledTimes(1);
    await act(async () => answer({ notifications: [notification()] }));
    expect(screen.getAllByText("New Intake Request")).toHaveLength(1);
  });
  it("keeps what a check brings back while the tab is hidden, and shows it on return", async () => {
    let answer!: (claim: { notifications: IntakeNotification[] }) => void;
    claim.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    mount();
    act(() => setVisibility("hidden"));
    await act(async () => answer({ notifications: [notification()] }));
    // A toast shown now would time out before anyone saw it.
    expect(screen.queryByText("New Intake Request")).not.toBeInTheDocument();
    act(() => setVisibility("visible"));
    expect(screen.getByText("New Intake Request")).toBeInTheDocument();
    // Showing it needed no second claim.
    expect(claim).toHaveBeenCalledTimes(1);
  });
  it("carries on polling past a claim that doesn't answer, and still shows its late answer", async () => {
    let answer!: (claim: { notifications: IntakeNotification[] }) => void;
    claim.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    mount();
    await act(() => vi.advanceTimersByTimeAsync(INTAKE_NOTIFICATION_CLAIM_WAIT_MS));
    // Given up on, it waits longer before the next check, which claims afresh.
    await act(() => vi.advanceTimersByTimeAsync(2 * INTAKE_NOTIFICATION_POLL_MS));
    expect(claim).toHaveBeenCalledTimes(2);
    await act(async () => answer({ notifications: [notification()] }));
    expect(screen.getByText("New Intake Request")).toBeInTheDocument();
  });
  it("checks nothing without a signed-in account, and stops when unmounted", async () => {
    vi.mocked(useWorkspace).mockReturnValue({
      accountId: undefined,
      workspaceId: null,
    } as ReturnType<typeof useWorkspace>);
    const { unmount } = mount();
    await flush();
    expect(claim).not.toHaveBeenCalled();
    unmount();
    vi.mocked(useWorkspace).mockReturnValue({
      accountId: "me",
      workspaceId: "org-1",
    } as ReturnType<typeof useWorkspace>);
    const second = mount();
    await flush();
    second.unmount();
    await act(() => vi.advanceTimersByTimeAsync(5 * INTAKE_NOTIFICATION_POLL_MS));
    expect(claim).toHaveBeenCalledTimes(1);
  });
});
