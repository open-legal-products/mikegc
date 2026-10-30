import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useIntakeDraftWarning,
  useIntakeOperation,
} from "./useIntakeOperation";

import {
  createIntakeMemory,
  discardIntakeDraft,
  getIntakeMemory,
  setIntakeMemoryAccount,
} from "@/app/lib/intakeMemory";

const mocks = vi.hoisted(() => ({ notifyInfo: vi.fn() }));
vi.mock("@/shared/lib/errorNotifier", () => ({ notifyInfo: mocks.notifyInfo }));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: vi.fn(),
  describeError: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  mocks.notifyInfo.mockClear();
});
const receipt = {
  request_id: "request-a",
  applied_version: 2,
  message_id: null,
  replayed: false,
};

describe("intake operation lifecycle", () => {
  it("retains the original operation after a lost response followed by denied access", async () => {
    const saved = vi.fn();
    const rejected = vi.fn();
    const command = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockRejectedValueOnce({ status: 403 })
      .mockResolvedValue(receipt);
    const { result } = renderHook(() => useIntakeOperation(saved, rejected));
    await act(async () => result.current.execute(command));
    expect(rejected).toHaveBeenCalledExactlyOnceWith({ status: 403 });
    expect(result.current.uncertain).toBe(true);
    const other = vi.fn();
    await act(async () => result.current.execute(other));
    expect(other).not.toHaveBeenCalled();
    await act(async () => result.current.execute());
    expect(command).toHaveBeenCalledTimes(3);
    expect(saved).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(result.current.locked).toBe(false);
  });

  it("refuses draft discard while an uncertain command still needs reconciliation", async () => {
    const memory = createIntakeMemory();
    memory.values.set("body", "Keep this exact answer");
    const command = vi.fn().mockRejectedValue(new Error("lost response"));
    const { result } = renderHook(() =>
      useIntakeOperation(vi.fn(), undefined, memory),
    );
    await act(async () => result.current.execute(command));
    expect(discardIntakeDraft(memory)).toBe(false);
    expect(memory.values.get("body")).toBe("Keep this exact answer");
    expect(memory.pending).toBe(command);
    command.mockResolvedValue(receipt);
    await act(async () => result.current.execute());
    act(() => {
      expect(discardIntakeDraft(memory)).toBe(true);
    });
    expect(memory.values.size).toBe(0);
  });

  it("releases a definitively rejected command after uncertainty and permits a new command", async () => {
    const rejected = vi.fn();
    const command = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce({ status: 409, code: "intake_conflict" });
    const { result } = renderHook(() => useIntakeOperation(vi.fn(), rejected));
    await act(async () => result.current.execute(command));
    expect(result.current.locked).toBe(false);
    const retry = vi.fn().mockResolvedValue(receipt);
    await act(async () => result.current.execute(retry));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledTimes(2);
  });

  it("does not retry or report results after unmount", async () => {
    let reject!: (error: unknown) => void;
    const pending = new Promise<never>((_, no) => {
      reject = no;
    });
    const command = vi.fn().mockReturnValue(pending);
    const saved = vi.fn();
    const rejected = vi.fn();
    const { result, unmount } = renderHook(() =>
      useIntakeOperation(saved, rejected),
    );
    let execution!: Promise<void>;
    act(() => {
      execution = result.current.execute(command);
    });
    unmount();
    await act(async () => {
      reject(new Error("offline"));
      await execution;
    });
    expect(command).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
  });
});

function Draft({
  dirty = true,
  onDiscard = () => {},
}: {
  dirty?: boolean;
  onDiscard?: () => void;
}) {
  const guard = useIntakeDraftWarning(dirty);
  return (
    <>
      <button type="button" onClick={() => guard.requestDiscard(onDiscard)}>
        Close draft
      </button>
      {guard.discardPopup}
    </>
  );
}

describe("unsent draft guard", () => {
  it("confirms an explicit discard in a popup, never a browser dialog", () => {
    const confirm = vi.spyOn(window, "confirm");
    const onDiscard = vi.fn();
    render(<Draft onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole("button", { name: "Close draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("discards a clean draft without asking", () => {
    const onDiscard = vi.fn();
    render(<Draft dirty={false} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole("button", { name: "Close draft" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard this draft?")).not.toBeInTheDocument();
  });

  it("lets navigation proceed with a toast while the draft stays in the tab", () => {
    const view = render(<Draft />);
    for (const name of [
      "mike:before-workspace-change",
      "mike:before-navigation",
    ])
      expect(window.dispatchEvent(new Event(name, { cancelable: true }))).toBe(
        true,
      );
    expect(mocks.notifyInfo).toHaveBeenCalledTimes(2);
    view.unmount();
    window.dispatchEvent(
      new Event("mike:before-navigation", { cancelable: true }),
    );
    expect(mocks.notifyInfo).toHaveBeenCalledTimes(2);
  });

  it("does not ask the browser to confirm unloading", () => {
    render(<Draft />);
    expect(
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(true);
  });
});

describe("retained command recovery", () => {
  it.each([400, 401, 403, 404, 409, 429])(
    "keeps the identical uncertain command after gateway %s",
    async (status) => {
      const view = createIntakeMemory();
      const command = vi
        .fn()
        .mockRejectedValueOnce(new Error("lost response"))
        .mockRejectedValueOnce({ status })
        .mockResolvedValue(receipt);
      const saved = vi.fn();
      const first = renderHook(() =>
        useIntakeOperation(saved, undefined, view),
      );
      await act(async () => first.result.current.execute(command));
      expect(first.result.current.locked).toBe(true);
      first.unmount();
      const next = renderHook(() => useIntakeOperation(saved, undefined, view));
      const replacement = vi.fn();
      await act(async () => next.result.current.execute(replacement));
      expect(replacement).not.toHaveBeenCalled();
      await act(async () => next.result.current.execute());
      expect(command).toHaveBeenCalledTimes(3);
      expect(saved).toHaveBeenCalledExactlyOnceWith(receipt);
    },
  );

  it("settles an in-flight command while away without navigating the new reader", async () => {
    const view = createIntakeMemory();
    let resolve!: (r: typeof receipt) => void;
    const command = vi.fn().mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const oldSaved = vi.fn();
    const first = renderHook(() =>
      useIntakeOperation(oldSaved, undefined, view),
    );
    let running!: Promise<void>;
    act(() => {
      running = first.result.current.execute(command);
    });
    first.unmount();
    await act(async () => {
      resolve(receipt);
      await running;
    });
    expect(oldSaved).not.toHaveBeenCalled();
    const newSaved = vi.fn();
    renderHook(() => useIntakeOperation(newSaved, undefined, view));
    expect(newSaved).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("reattaches to a running command without sending another copy", async () => {
    const view = createIntakeMemory();
    let resolve!: (r: typeof receipt) => void;
    const command = vi.fn().mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const first = renderHook(() =>
      useIntakeOperation(vi.fn(), undefined, view),
    );
    let running!: Promise<void>;
    act(() => {
      running = first.result.current.execute(command);
    });
    first.unmount();
    const saved = vi.fn();
    const next = renderHook(() => useIntakeOperation(saved, undefined, view));
    expect(next.result.current.busy).toBe(true);
    await act(async () => next.result.current.execute());
    expect(command).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(receipt);
      await running;
    });
    expect(saved).toHaveBeenCalledExactlyOnceWith(receipt);
  });

  it("revokes old account closures and ignores late success after identity changes", async () => {
    setIntakeMemoryAccount("account-a");
    const view = getIntakeMemory("account-a", "org-a", "new-request");
    view.values.set("body", "Private draft");
    let resolve!: (r: typeof receipt) => void;
    const command = vi.fn().mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const saved = vi.fn();
    const first = renderHook(() => useIntakeOperation(saved, undefined, view));
    let running!: Promise<void>;
    act(() => {
      running = first.result.current.execute(command);
    });
    first.unmount();
    setIntakeMemoryAccount("account-b");
    await act(async () => {
      resolve(receipt);
      await running;
    });
    expect(saved).not.toHaveBeenCalled();
    expect(view.valid).toBe(false);
    expect(view.pending).toBeNull();
    expect(view.values.size).toBe(0);
    await first.result.current.execute(command);
    expect(command).toHaveBeenCalledTimes(1);
    expect(
      getIntakeMemory("account-b", "org-a", "new-request").values.size,
    ).toBe(0);
    setIntakeMemoryAccount(null);
  });
});
