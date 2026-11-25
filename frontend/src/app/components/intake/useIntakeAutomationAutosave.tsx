"use client";

import { useCallback, useRef, useState } from "react";
import type {
  IntakeAutomationSettings,
  IntakeAutomationUpdate,
} from "@mike/contracts";
import { MemorySaveStatus } from "@/app/components/memory/MemoryEditorState";
import { useMemoryAutosave } from "@/app/components/memory/useMemoryAutosave";
import { updateIntakeAutomation } from "@/app/lib/mikeApi";
import { describeError } from "@/app/lib/userFacingError";
import { TextButtonUI } from "@mike/ui";
import {
  intakeAutomationChanges,
  intakeAutosaveDraft,
  intakeDraftAfterFailure,
  intakeDraftAfterSave,
  intakeDraftWithSwitches,
  NOTHING_COMMITTED,
  type IntakeAutomationDraft,
  type IntakeCommitted,
} from "./intakeAutomation";

type SaveError = {
  message: string;
  /** What failed, when sending it again could work. */
  retry: IntakeAutomationUpdate | null;
};

/**
 * Automated intake's autosave, for the Settings and Rules pages alike. It
 * sends only what the draft changes: switches and lists at once, text once
 * typing pauses, and a secret once it is complete. Saves run one at a time.
 * A failed save keeps typed text on screen and turns a switch back; Retry
 * turns it again and sends the same save.
 */
export function useIntakeAutomationAutosave({
  orgId,
  settings,
  draft,
  committed = NOTHING_COMMITTED,
  onSettings,
  onDraft,
}: {
  orgId: string;
  settings: IntakeAutomationSettings | null;
  draft: IntakeAutomationDraft | null;
  /** Which typed secrets and IDs are complete, and so may be sent. */
  committed?: Partial<IntakeCommitted>;
  onSettings: (settings: IntakeAutomationSettings) => void;
  onDraft: (
    next: (current: IntakeAutomationDraft) => IntakeAutomationDraft,
  ) => void;
}) {
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  // What would save now, as the autosave's value: "{}" when nothing would.
  const pending =
    settings && draft
      ? JSON.stringify(
          intakeAutomationChanges(
            settings,
            intakeAutosaveDraft(settings, draft, committed),
          ),
        )
      : "{}";

  // What the latest save sent. Saves run one at a time, so when one fails
  // this is what failed.
  const sentRef = useRef<IntakeAutomationUpdate>({});
  const saveChanges = useCallback(
    async (value: string) => {
      const sent = JSON.parse(value) as IntakeAutomationUpdate;
      sentRef.current = sent;
      return { settings: await updateIntakeAutomation(orgId, sent), sent };
    },
    [orgId],
  );
  // The callbacks are read at the time they run, so they see this render's
  // settings even for a save that started earlier.
  const autosave = useMemoryAutosave({
    value: pending,
    persistedValue: "{}",
    enabled: !!settings,
    save: saveChanges,
    // Once saved, the same draft has nothing left to send.
    getPersistedValue: () => "{}",
    onSaved: ({ settings: saved, sent }) => {
      onSettings(saved);
      onDraft((current) => intakeDraftAfterSave(current, sent, saved));
      setSaveError(null);
    },
    onError: (cause) => {
      const sent = sentRef.current;
      if (settings)
        onDraft((current) => intakeDraftAfterFailure(current, sent, settings));
      const described = describeError(cause, {
        action: "save the intake settings",
      });
      setSaveError({
        message: described.message,
        retry: described.retryable ? sent : null,
      });
    },
  });
  // Retry turns the failed switches and models again, unless one was changed
  // since; with the text kept on screen, the whole failed save goes again.
  const retry = (sent: IntakeAutomationUpdate) => {
    setSaveError(null);
    if (settings)
      onDraft((current) => intakeDraftWithSwitches(current, sent, settings));
    autosave.retry();
  };
  return { autosave, saveError, retry };
}

/** Whether the latest change saved, or what went wrong and Retry. */
export function IntakeSaveStatus({
  state,
}: {
  state: ReturnType<typeof useIntakeAutomationAutosave>;
}) {
  const { saveError, autosave, retry } = state;
  return saveError ? (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span role="alert" className="text-red-600">
        {saveError.message}
      </span>
      {saveError.retry && (
        <TextButtonUI size="xs" onClick={() => retry(saveError.retry!)}>
          Retry
        </TextButtonUI>
      )}
    </p>
  ) : (
    <MemorySaveStatus
      error={null}
      status={autosave.status}
      compact
      onRetry={() => autosave.retry()}
    />
  );
}
