"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Info } from "lucide-react";
import type { IntakeAutomationSettings } from "@mike/contracts";
import { Modal } from "@/app/components/modals/Modal";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import { cn } from "@/app/lib/utils";
import {
  MODELS,
  SETTINGS_MODELS,
  modelDisplayName,
  type ModelOption,
} from "@mike/client";
import {
  Dropdown,
  DropdownContent,
  DropdownLabel,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownSeparator,
  DropdownTrigger,
} from "@mike/ui";
import { orderedModelGroups } from "@mike/ui";
import { GlassCardUI } from "@mike/ui";
import { pillButtonUIClassName } from "@mike/ui";
import { TextButtonUI } from "@mike/ui";
import { textButtonUIClassName } from "@mike/ui";
import { TextSlabUI } from "@mike/ui";
import type { IntakeAutomationDraft } from "./intakeAutomation";
import {
  ROW_DESCRIPTION_CLASS,
  ROW_LABEL_CLASS,
} from "./IntakeSettingsFields";

/**
 * The page's own sections: triage rules and, on Model Preferences, intake's
 * models. The channels are cards of their own, set up in modals
 * (IntakeChannelSettings.tsx).
 */

type Change = (patch: Partial<IntakeAutomationDraft>) => void;

/**
 * One section of the page, as in Settings: its heading above a card of rows.
 * What it does and its setup steps open in a small modal from the info
 * button beside the heading.
 */
function IntakeSettingsSection({
  title,
  description,
  steps,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** How to set it up, in order. */
  steps?: string[];
  children: ReactNode;
}) {
  const heading = useId();
  const [showGuide, setShowGuide] = useState(false);
  const hasGuide = !!description || !!steps;
  return (
    <section aria-labelledby={heading} className="space-y-3">
      <div className="flex items-center gap-1.5">
        <SettingsHeading id={heading}>{title}</SettingsHeading>
        {hasGuide && (
          <TextButtonUI
            size="icon-xs"
            aria-label={`How to set up ${title}`}
            aria-haspopup="dialog"
            onClick={() => setShowGuide(true)}
          >
            <Info aria-hidden="true" className="h-4 w-4" />
          </TextButtonUI>
        )}
      </div>
      <GlassCardUI>{children}</GlassCardUI>
      {hasGuide && (
        <Modal
          open={showGuide}
          onClose={() => setShowGuide(false)}
          // Where it belongs, then what it is, which names the dialog.
          breadcrumbs={["Intake", "Settings", `Set up ${title}`]}
          size="sm"
          // As tall as its few lines, not a full modal's height.
          className="h-auto"
        >
          <div className="space-y-3 pb-5">
            {description && (
              <SettingsDescription>{description}</SettingsDescription>
            )}
            {steps && (
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700 marker:text-gray-400">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

/** The catalog's name and provider for a model id, as other pickers show it. */
function modelOption(id: string): ModelOption {
  return (
    [...MODELS, ...SETTINGS_MODELS].find((model) => model.id === id) ?? {
      id,
      label: modelDisplayName(id),
      group: "Other providers",
    }
  );
}

type ModelSettings = IntakeAutomationSettings["models"];

/**
 * Models: the model triage runs with and the one AI preprocessing runs with,
 * each chosen from the models the organization has keys for. Neither runs
 * without one, so each says when it can't, and why.
 */
export function IntakeModelsSection({
  title = "Intake",
  settings,
  draft,
  modelSettingsHref,
  onChange,
}: {
  /** The section's heading, which names the feature the models are for. */
  title?: string;
  settings: ModelSettings;
  draft: IntakeAutomationDraft;
  /** Where the model keys both need are set. */
  modelSettingsHref: string;
  onChange: Change;
}) {
  return (
    <IntakeSettingsSection title={title}>
      <ModelRow
        label="Triage"
        description="Writes each request’s subject and summary, fills in its details and assigns it by your rules."
        noun="triage"
        value={draft.triageModel}
        saved={settings.triage}
        savedAvailable={settings.triage_available}
        available={settings.available}
        modelSettingsHref={modelSettingsHref}
        onChange={(triageModel) => onChange({ triageModel })}
      />
      <ModelRow
        label="AI preprocessing"
        description="Answers requests and marks up their Word documents, for rules with AI preprocessing on. A stronger model reads documents better."
        noun="preprocessing"
        value={draft.preprocessingModel}
        saved={settings.preprocessing}
        savedAvailable={settings.preprocessing_available}
        available={settings.available}
        modelSettingsHref={modelSettingsHref}
        onChange={(preprocessingModel) => onChange({ preprocessingModel })}
      />
    </IntakeSettingsSection>
  );
}

/** One model to choose, grouped by provider as other model pickers are. */
function ModelRow({
  label,
  description,
  noun,
  value,
  saved,
  savedAvailable,
  available,
  modelSettingsHref,
  onChange,
}: {
  label: string;
  description: string;
  /** What doesn't run without it, as the notices name it. */
  noun: "triage" | "preprocessing";
  value: string | null;
  saved: string | null;
  savedAvailable: boolean;
  available: string[];
  modelSettingsHref: string;
  onChange: (model: string | null) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const options = available.map(modelOption);
  const groups = orderedModelGroups(options).map((group) => ({
    group,
    items: options.filter((option) => option.group === group),
  }));
  // The saved model has lost its key; a model just chosen is checked on save.
  const keyGone = !!value && value === saved && !savedAvailable;
  const noKeys = !available.length;
  const notice = noKeys
    ? "No model has an API key."
    : keyGone
      ? "This model has no API key."
      : !value
        ? `Choose a model for ${noun} to run.`
        : null;
  return (
    <SettingsRow layout="stacked">
      <div className="min-w-0 space-y-1">
        <p id={labelId} className={ROW_LABEL_CLASS}>
          {label}
        </p>
        <p id={descriptionId} className={ROW_DESCRIPTION_CLASS}>
          {description}
        </p>
      </div>
      <Dropdown>
        <DropdownTrigger asChild>
          <button
            type="button"
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            // Nothing to choose until a model has a key.
            disabled={noKeys}
            className={cn(
              "flex h-9 items-center justify-between gap-2 text-left hover:bg-gray-200/70",
              SETTINGS_CONTROL_CLASS,
            )}
          >
            <span
              className={cn(
                "min-w-0 truncate",
                value ? "text-gray-900" : "text-gray-500",
              )}
            >
              {value ? modelOption(value).label : "No model"}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-gray-500"
            />
          </button>
        </DropdownTrigger>
        <DropdownContent
          align="start"
          className="max-h-80 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          <DropdownRadioGroup
            value={value ?? ""}
            onValueChange={(next) => {
              if (next !== (value ?? "")) onChange(next || null);
            }}
          >
            {groups.map(({ group, items }, index) => (
              <div key={group}>
                {index > 0 && <DropdownSeparator />}
                <DropdownLabel>{group}</DropdownLabel>
                {items.map((option) => (
                  <DropdownRadioItem key={option.id} value={option.id}>
                    {option.label}
                  </DropdownRadioItem>
                ))}
              </div>
            ))}
            {value && (
              <>
                <DropdownSeparator />
                <DropdownRadioItem value="">
                  <span className="min-w-0">
                    No model
                    <span className="block text-gray-500">
                      {noun === "triage"
                        ? "Triage doesn’t run"
                        : "Preprocessing doesn’t run"}
                    </span>
                  </span>
                </DropdownRadioItem>
              </>
            )}
          </DropdownRadioGroup>
        </DropdownContent>
      </Dropdown>
      {notice && (
        <TextSlabUI className="flex items-start gap-2 text-xs text-gray-700">
          <Info
            aria-hidden="true"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500"
          />
          <p>
            {notice}
            {(noKeys || keyGone) && (
              <>
                {" "}
                <Link
                  href={modelSettingsHref}
                  className={textButtonUIClassName({
                    size: "xs",
                    className:
                      "inline px-0 text-xs text-blue-600 underline hover:text-blue-700",
                  })}
                >
                  Add one in Bring Your Own Keys
                </Link>
              </>
            )}
          </p>
        </TextSlabUI>
      )}
    </SettingsRow>
  );
}

/** Triage rules: who each request goes to, on a table page of their own. */
export function IntakeTriageRulesSection({
  rulesHref,
  modelsHref,
}: {
  rulesHref: string;
  /** Model Preferences, where triage's and preprocessing's models are chosen. */
  modelsHref: string;
}) {
  return (
    <IntakeSettingsSection title="Triage rules">
      <SettingsRow>
        <div className="min-w-0">
          <p className={ROW_LABEL_CLASS}>Rules</p>
          <p className={cn(ROW_DESCRIPTION_CLASS, "mt-1")}>
            Who each request goes to, and whether MikeGC preprocesses it. Triage
            and preprocessing use the models chosen in{" "}
            <Link
              href={modelsHref}
              className={textButtonUIClassName({
                size: "xs",
                className:
                  "inline px-0 text-sm text-blue-600 underline hover:text-blue-700",
              })}
            >
              Model Preferences
            </Link>
            .
          </p>
        </div>
        <Link
          href={rulesHref}
          aria-label="Edit rules"
          className={pillButtonUIClassName({
            tone: "blue",
            size: "sm",
            className: "shrink-0",
          })}
        >
          Edit
        </Link>
      </SettingsRow>
    </IntakeSettingsSection>
  );
}
