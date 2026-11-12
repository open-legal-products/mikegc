"use client";

import { useEffect, useState } from "react";
import type { IntakeAutomationSettings } from "@mike/contracts";
import { PERSONAL_WORKSPACE } from "@/app/contexts/WorkspaceContext";
import { getIntakeAutomation } from "@/app/lib/mikeApi";
import { describeError } from "@/app/lib/userFacingError";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { EmptyState } from "@/app/components/ui/empty-state";
import { GlassCardUI } from "@mike/ui";
import { PillButtonUI } from "@mike/ui";
import {
  intakeAutomationDraft,
  type IntakeAutomationDraft,
} from "./intakeAutomation";
import { IntakeModelsSection } from "./IntakeSettingsSections";
import {
  IntakeSaveStatus,
  useIntakeAutomationAutosave,
} from "./useIntakeAutomationAutosave";

/** Where an organization's, or a person's own, model keys are set. */
function modelKeysHref(orgId: string) {
  return orgId === PERSONAL_WORKSPACE
    ? "/settings/byok"
    : `/organizations/${encodeURIComponent(orgId)}/settings/providers`;
}

/**
 * The models intake's triage and AI preprocessing run with, as a section of
 * Model Preferences: an organization's, or for Personal the person's. Each
 * saves as soon as it is chosen.
 */
export function IntakeModelSettings({ orgId }: { orgId: string }) {
  const [settings, setSettings] = useState<IntakeAutomationSettings | null>(
    null,
  );
  const [draft, setDraft] = useState<IntakeAutomationDraft | null>(null);
  const [failure, setFailure] = useState<
    { forbidden: true } | { forbidden: false; message: string } | null
  >(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    getIntakeAutomation(orgId).then(
      (loaded) => {
        if (!active) return;
        setSettings(loaded);
        setDraft(intakeAutomationDraft(loaded));
        setFailure(null);
      },
      (error) => {
        if (!active) return;
        const described = describeError(error, {
          action: "load the intake models",
        });
        setFailure(
          described.kind === "forbidden"
            ? { forbidden: true }
            : { forbidden: false, message: described.message },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [orgId, reload]);

  const saving = useIntakeAutomationAutosave({
    orgId,
    settings,
    draft,
    onSettings: setSettings,
    onDraft: (next) =>
      setDraft((current) => (current ? next(current) : current)),
  });

  if (failure?.forbidden)
    return (
      <EmptyState
        title="Intake"
        description="Only owners and admins can change intake's models."
      />
    );
  if (failure)
    return (
      <EmptyState
        tone="error"
        title="Unable to load intake's models"
        description={<span role="alert">{failure.message}</span>}
        action={
          <PillButtonUI
            tone="black"
            size="sm"
            onClick={() => {
              setFailure(null);
              setReload((n) => n + 1);
            }}
          >
            Try again
          </PillButtonUI>
        }
      />
    );
  if (!settings || !draft) return <IntakeModelSettingsSkeleton />;
  return (
    <div>
      <IntakeModelsSection
        settings={settings.models}
        draft={draft}
        modelSettingsHref={modelKeysHref(orgId)}
        onChange={(patch) =>
          setDraft((current) => (current ? { ...current, ...patch } : current))
        }
      />
      <div aria-live="polite" className="mt-2 min-h-4 text-xs">
        <IntakeSaveStatus state={saving} />
      </div>
    </div>
  );
}

/** The section while it loads: its heading, then a card with two pickers. */
function IntakeModelSettingsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading intake's models"
      className="space-y-3"
    >
      <div className="flex h-7 items-center">
        <SkeletonLine className="w-16" />
      </div>
      <GlassCardUI>
        {Array.from({ length: 2 }, (_, row) => (
          <div
            key={row}
            className="space-y-2 border-t border-gray-100 p-4 first:border-t-0"
          >
            <SkeletonLine className="w-24" />
            <SkeletonLine className="w-2/3" />
            <div className="h-9 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none" />
          </div>
        ))}
      </GlassCardUI>
    </div>
  );
}
