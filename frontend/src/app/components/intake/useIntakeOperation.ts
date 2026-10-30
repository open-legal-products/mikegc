"use client";
import { createElement, useEffect, useState } from "react";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { notifyInfo } from "@/shared/lib/errorNotifier";
import {
  createIntakeMemory,
  notifyIntakeMemory,
  type IntakeViewMemory,
} from "@/app/lib/intakeMemory";
import { useIntakeMemorySnapshot } from "./useIntakeMemory";
import type { IntakeReceipt } from "@mike/contracts";
import { describeError, notifyError } from "@/app/lib/userFacingError";

/** A receipt belongs to its retained view, never the route currently on screen. */
export function useIntakeOperation(
  onSaved: (receipt: IntakeReceipt) => void,
  onRejected?: (error: unknown) => void,
  retained?: IntakeViewMemory,
) {
  const [local] = useState(createIntakeMemory);
  const view = retained ?? local;
  const snapshot = useIntakeMemorySnapshot(view);
  useEffect(() => {
    if (!view.valid || !snapshot.outcome || view.outcome !== snapshot.outcome)
      return;
    const outcome = snapshot.outcome;
    const action = view.action ?? "save the change";
    view.outcome = null;
    notifyIntakeMemory(view);
    if ("receipt" in outcome) onSaved(outcome.receipt);
    else {
      onRejected?.(outcome.error);
      notifyError(outcome.error, {
        action: view.uncertain ? `confirm whether we could ${action}` : action,
      });
    }
  }, [view, snapshot.outcome, onSaved, onRejected]);
  /**
   * Run or reconcile the retained command without replacing an unresolved
   * operation. `action` names it in the imperative ("resolve the request").
   */
  async function execute(
    operation?: () => Promise<IntakeReceipt>,
    action?: string,
  ) {
    if (!view.valid || view.busy || view.outcome || (view.pending && operation))
      return;
    if (operation) {
      view.pending = operation;
      view.action = action ?? null;
    }
    const command = view.pending;
    if (!command) return;
    view.busy = true;
    notifyIntakeMemory(view);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const receipt = await command();
          if (
            !receipt ||
            !Number.isInteger(receipt.applied_version) ||
            typeof receipt.replayed !== "boolean"
          )
            throw new Error("Invalid intake acknowledgement");
          if (!view.valid) return;
          view.pending = null;
          view.uncertain = false;
          view.outcome = { receipt };
          return;
        } catch (error) {
          if (!view.valid) return;
          const status =
            error && typeof error === "object" && "status" in error
              ? Number(error.status)
              : 0;
          const code =
            error && typeof error === "object" && "code" in error
              ? error.code
              : null;
          if (status >= 400 && status < 500) {
            // Only these SQL rejections follow the immutable receipt lookup.
            // A gateway 429/400/409 says nothing about an earlier lost response.
            const definitive =
              !view.uncertain ||
              (status === 409 &&
                [
                  "intake_conflict",
                  "intake_command_reused",
                  "intake_purged",
                ].includes(String(code)));
            if (definitive) {
              view.pending = null;
              view.uncertain = false;
            }
            view.outcome = { error };
            return;
          }
          view.uncertain = true;
          if (attempt === 1 || view.listeners.size === 0) {
            view.outcome = { error };
            return;
          }
        }
      }
    } finally {
      view.busy = false;
      if (view.valid) notifyIntakeMemory(view);
    }
  }
  return {
    busy: snapshot.busy,
    uncertain: snapshot.uncertain,
    execute,
    locked: snapshot.busy || snapshot.uncertain || !!snapshot.outcome,
  };
}

/**
 * Guard an unsent draft without browser dialogs. In-app navigation keeps the
 * draft in tab memory, so it only shows a toast; an explicit discard asks
 * through `discardPopup`, which the caller renders.
 */
export function useIntakeDraftWarning(dirty: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  /** Run `discard` at once when clean, otherwise after the person confirms. */
  const requestDiscard = (discard: () => void) => {
    if (!dirty) discard();
    else setPending(() => discard);
  };
  useEffect(() => {
    if (!dirty) return;
    const kept = () =>
      notifyInfo(
        "Your draft is kept in this tab until you send or discard it.",
      );
    window.addEventListener("mike:before-workspace-change", kept);
    window.addEventListener("mike:before-navigation", kept);
    return () => {
      window.removeEventListener("mike:before-workspace-change", kept);
      window.removeEventListener("mike:before-navigation", kept);
    };
  }, [dirty]);
  const discardPopup = createElement(ConfirmPopup, {
    open: !!pending,
    title: "Discard this draft?",
    message: "Unsaved text will be lost.",
    confirmLabel: "Discard",
    confirmVariant: "danger",
    cancelLabel: "Keep editing",
    onCancel: () => setPending(null),
    onConfirm: () => {
      const discard = pending;
      setPending(null);
      discard?.();
    },
  });
  return { requestDiscard, discardPopup };
}
/** Describe an intake load failure without exposing raw service errors. */
export function intakeError(error: unknown, action = "load intake requests") {
  return describeError(error, { action }).message;
}
