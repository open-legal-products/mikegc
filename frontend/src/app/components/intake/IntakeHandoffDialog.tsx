"use client";

import type { IntakeClarifyStage } from "@mike/contracts";
import { Modal } from "@/app/components/modals/Modal";
import { Loader2 } from "lucide-react";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";

/** Approval of a frozen detail edit that ends automatic clarification. */
export function IntakeHandoffDialog({
  changes,
  stage,
  stale = false,
  locked = false,
  busy = false,
  uncertain = false,
  onCheckAgain,
  onConfirm,
  onCancel,
}: {
  changes: { label: string; before: string; after: string }[];
  stage: IntakeClarifyStage;
  stale?: boolean;
  locked?: boolean;
  busy?: boolean;
  uncertain?: boolean;
  onCheckAgain?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open
      size="sm"
      className="h-auto max-h-[calc(100vh-2rem)]"
      breadcrumbs={["Intake", "Stop automatic follow-up?"]}
      onClose={() => { if (!locked) onCancel(); }}
      closeDisabled={locked}
      primaryAction={{
        label: "Save and stop follow-up",
        disabled: stale || locked || changes.length === 0,
        onClick: onConfirm,
        icon: busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : undefined,
      }}
      cancelAction={{ label: "Cancel edit", onClick: onCancel, disabled: locked }}
    >
      <div className="space-y-4 pb-4 text-sm leading-relaxed text-gray-700">
        <p>Saving these changes stops MikeGC&apos;s automatic questions. New requester replies will still be recorded, but won&apos;t trigger another automatic follow-up.</p>
        {stage === "readiness" && (
          <p>Preprocessing will continue with the information already received.</p>
        )}
        <div>
          <h2 className="mb-2 text-sm font-medium text-gray-900">Changes to save</h2>
          <dl className="space-y-3">
            {changes.map((change) => (
              <div key={change.label}>
                <dt className="text-xs text-gray-500">{change.label}</dt>
                <dd className="[overflow-wrap:anywhere]">
                  From {change.before || "None"} to{" "}
                  <span className="font-medium text-gray-900">{change.after || "None"}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {(busy || uncertain) && (
          <div className="space-y-2">
            <p role="status">
              {busy
                ? "Saving changes…"
                : "The save could not be confirmed. Your changes are kept."}
            </p>
            {uncertain && onCheckAgain && (
              <PillButtonUI tone="white" size="sm" disabled={busy} onClick={onCheckAgain}>
                Check again
              </PillButtonUI>
            )}
          </div>
        )}
        {stale && !locked && (
          <p role="alert" className="text-red-600">
            The request changed. Go back and review it before saving.
          </p>
        )}
      </div>
    </Modal>
  );
}
