"use client";

import { useEffect, useState } from "react";
import type { IntakeAutomationSettings } from "@mike/contracts";
import { getIntakeAutomation } from "@/app/lib/mikeApi";
import { describeError } from "@/app/lib/userFacingError";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButtonUI } from "@mike/ui";
import { intakeModelsHref, intakeRulesHref } from "./intakeQuery";
import {
  IntakeChannelsSection,
  IntakeChannelsSkeleton,
} from "./IntakeChannelSettings";
import { IntakeTriageRulesSection } from "./IntakeSettingsSections";

/** The sections sit apart, as on any Settings page. */
const SECTION_STACK_CLASS = "space-y-8";

type Loaded = { settings: IntakeAutomationSettings };

/**
 * How MikeGC records requests by itself, as the Intake section of the
 * workspace's settings. The channels it records from (Outlook, Gmail, Slack
 * and Teams) are tiles, each switched on or off in place and set up or
 * managed in its own modal, which saves with its own button. Triage rules
 * have a page of their own.
 */
export function IntakeSettings({ orgId }: { orgId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<
    { forbidden: true } | { forbidden: false; message: string } | null
  >(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    getIntakeAutomation(orgId).then(
      (settings) => {
        if (!active) return;
        setLoaded({ settings });
        setFailure(null);
      },
      (error) => {
        if (!active) return;
        const described = describeError(error, {
          action: "load the intake settings",
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

  if (failure?.forbidden)
    return (
      <EmptyState
        title="Intake"
        description="Only owners and admins can change automated intake."
      />
    );
  if (failure)
    return (
      <EmptyState
        tone="error"
        title="Unable to load the settings"
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
  if (!loaded) return <IntakeSettingsSkeleton />;
  return (
    <div className={SECTION_STACK_CLASS}>
      <IntakeChannelsSection
        orgId={orgId}
        settings={loaded.settings}
        onSettings={(settings) => setLoaded({ settings })}
      />
      <IntakeTriageRulesSection
        rulesHref={intakeRulesHref(orgId)}
        modelsHref={intakeModelsHref(orgId)}
      />
    </div>
  );
}

/** The page while it loads: the channel tiles. */
function IntakeSettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the intake settings">
      <IntakeChannelsSkeleton />
    </div>
  );
}
