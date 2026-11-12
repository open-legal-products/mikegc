"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import {
  SETTINGS_CONTROL_CLASS,
  SettingsTextInput,
} from "@/app/components/settings/SettingsTextInput";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FieldLabel } from "@/app/components/ui/form-field";
import { useAssignLatest } from "@/app/hooks/useLatestRef";
import {
  getOrgProfile,
  updateOrgProfile,
  type OrgProfile,
  type OrgProfileField,
} from "@/app/lib/mikeApi";
import { notifyError, userFacingApiError } from "@/app/lib/userFacingError";
import { cn } from "@/app/lib/utils";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";

// The Profile section of an organization's settings: what its owners and
// admins tell Mike about the organization. The assistant (chat and project
// chat) and MikeGC's intake agent read it, with the organization's name, as
// background for work in this workspace.
//
// One form with one Save: the fields describe a single thing, and a profile
// half-saved field by field would reach the next chat half-written. Only the
// fields that changed are sent, so two admins editing different fields do not
// undo each other.

type FieldSpec = {
  key: OrgProfileField;
  label: string;
  description: string;
  placeholder: string;
  /** Mirrors ORG_PROFILE_FIELDS in backend/src/lib/orgProfile.ts. */
  max: number;
  multiline: boolean;
};

export const ORG_PROFILE_FIELDS: readonly FieldSpec[] = [
  {
    key: "about",
    label: "About",
    description:
      "What the organization does: its business, products or services, and customers.",
    placeholder:
      "e.g. We make accounting software for small businesses, sold by subscription in the UK and Europe.",
    max: 2000,
    multiline: true,
  },
  {
    key: "industry",
    label: "Industry",
    description: "The sector it works in.",
    placeholder: "e.g. Financial software",
    max: 200,
    multiline: false,
  },
  {
    key: "headquarters",
    label: "Headquarters",
    description: "Where it is based.",
    placeholder: "e.g. London, United Kingdom",
    max: 200,
    multiline: false,
  },
  {
    key: "jurisdictions",
    label: "Jurisdictions",
    description: "Where it does business.",
    placeholder: "e.g. United Kingdom, European Union, United States",
    max: 500,
    multiline: false,
  },
  {
    key: "legal_entities",
    label: "Legal entities",
    description:
      "The companies in the group, so Mike can tell which party to a contract is yours.",
    placeholder:
      "e.g. Acme Holdings Ltd (England and Wales)\nAcme Inc. (Delaware)",
    max: 1000,
    multiline: true,
  },
  {
    key: "legal_team",
    label: "Legal team",
    description: "Who is in the legal team and what it covers.",
    placeholder:
      "e.g. Three commercial lawyers and a privacy counsel. Employment matters go to outside counsel.",
    max: 1000,
    multiline: true,
  },
  {
    key: "additional_context",
    label: "Other context",
    description:
      "Anything else that helps, such as standard positions, preferred governing law or risk appetite.",
    placeholder:
      "e.g. We contract on our own terms where we can, under English law.",
    max: 2000,
    multiline: true,
  },
];

type Draft = Record<OrgProfileField, string>;

/** As the server stores it: plain line endings, no outer whitespace. */
function normalize(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function draftOf(profile: OrgProfile): Draft {
  return Object.fromEntries(
    ORG_PROFILE_FIELDS.map(({ key }) => [key, profile[key] ?? ""]),
  ) as Draft;
}

/** The fields whose text differs from what is saved, as the server should store them. */
function changesOf(
  draft: Draft,
  saved: Draft,
): Partial<Record<OrgProfileField, string | null>> {
  const changes: Partial<Record<OrgProfileField, string | null>> = {};
  for (const { key } of ORG_PROFILE_FIELDS) {
    const value = normalize(draft[key]);
    if (value !== normalize(saved[key])) changes[key] = value || null;
  }
  return changes;
}

export function OrganizationProfileSettings({ orgId }: { orgId: string }) {
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A notice's Retry runs the save of the render it is pressed in.
  const retryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOrgProfile(orgId)
      .then((profile) => {
        if (cancelled) return;
        const loaded = draftOf(profile);
        setSaved(loaded);
        setDraft(loaded);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          userFacingApiError(error, "The organization's profile could not be loaded."),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, loadVersion]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const changes = draft && saved ? changesOf(draft, saved) : {};
  const dirty = Object.keys(changes).length > 0;
  const tooLong = draft
    ? ORG_PROFILE_FIELDS.filter(({ key, max }) => normalize(draft[key]).length > max)
    : [];

  // Leaving the page, or closing the tab, drops what was typed.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!draft || !saved || saving) return;
    const pending = changesOf(draft, saved);
    if (Object.keys(pending).length === 0) return;
    setSaving(true);
    setJustSaved(false);
    try {
      const profile = await updateOrgProfile(orgId, pending);
      // The fields are locked while saving, so nothing was typed since:
      // show what the server kept, trimmed, with any other admin's change.
      const stored = draftOf(profile);
      setSaved(stored);
      setDraft(stored);
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 2000);
    } catch (error) {
      // The draft stays as it was typed, to try again.
      notifyError(error, {
        action: "save the organization profile",
        onRetry: () => retryRef.current?.(),
      });
    } finally {
      setSaving(false);
    }
  }, [draft, saved, saving, orgId]);
  useAssignLatest(retryRef, () => void save());

  if (loadError && !draft)
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title="Profile"
        description={loadError}
        tone="error"
        action={
          <PillButtonUI
            tone="black"
            size="sm"
            onClick={() => {
              setLoadError(null);
              setLoadVersion((current) => current + 1);
            }}
          >
            Try again
          </PillButtonUI>
        }
      />
    );

  return (
    <form
      className="space-y-3"
      aria-labelledby="org-profile-heading"
      onSubmit={(event) => {
        event.preventDefault();
        if (tooLong.length === 0) void save();
      }}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <SettingsHeading id="org-profile-heading">Profile</SettingsHeading>
        <span className="text-xs text-gray-400" aria-live="polite">
          {saving ? "Saving..." : justSaved ? "Saved" : ""}
        </span>
      </div>
      <SettingsDescription>
        Tell Mike about your organization. The assistant and the intake agent
        use these details, with the organization&apos;s name, as background
        for work in this workspace. Every field is optional.
      </SettingsDescription>

      <GlassCardUI>
        {ORG_PROFILE_FIELDS.map((field) => (
          <SettingsRow key={field.key} layout="stacked">
            {draft ? (
              <ProfileField
                field={field}
                value={draft[field.key]}
                disabled={saving}
                onChange={(value) =>
                  setDraft((current) =>
                    current ? { ...current, [field.key]: value } : current,
                  )
                }
              />
            ) : (
              <div className="space-y-2" aria-hidden>
                <span className="block h-4 w-28 animate-pulse rounded bg-gray-200" />
                <span className="block h-4 w-64 max-w-full animate-pulse rounded bg-gray-200" />
                <span
                  className={cn(
                    "block w-full animate-pulse rounded-lg bg-gray-200",
                    field.multiline ? "h-24" : "h-10",
                  )}
                />
              </div>
            )}
          </SettingsRow>
        ))}
      </GlassCardUI>

      <div className="flex flex-wrap justify-end gap-2">
        {dirty ? (
          <PillButtonUI
            type="button"
            tone="white"
            size="sm"
            disabled={saving}
            onClick={() => saved && setDraft(saved)}
          >
            Discard changes
          </PillButtonUI>
        ) : null}
        <PillButtonUI
          type="submit"
          tone="black"
          size="sm"
          disabled={!draft || !dirty || tooLong.length > 0 || saving}
          loading={saving}
        >
          Save
        </PillButtonUI>
      </div>
    </form>
  );
}

function ProfileField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `org-profile-${field.key}`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const length = normalize(value).length;
  const over = length > field.max;
  // The count shows once it matters: near the limit, or past it.
  const showCount = length >= field.max * 0.9;
  const describedBy = [descriptionId, over ? errorId : null]
    .filter(Boolean)
    .join(" ");
  const common = {
    id,
    value,
    disabled,
    placeholder: field.placeholder,
    "aria-describedby": describedBy,
    "aria-invalid": over || undefined,
  };
  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        {showCount ? (
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              over ? "text-red-600" : "text-gray-400",
            )}
          >
            {length.toLocaleString("en-US")} / {field.max.toLocaleString("en-US")}
          </span>
        ) : null}
      </div>
      <p id={descriptionId} className="-mt-1 mb-2 text-xs text-gray-500">
        {field.description}
      </p>
      {field.multiline ? (
        <textarea
          {...common}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "block min-h-24 max-h-96 resize-y py-2 [field-sizing:content] [overflow-wrap:anywhere]",
            SETTINGS_CONTROL_CLASS,
          )}
        />
      ) : (
        <SettingsTextInput
          {...common}
          type="text"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {over ? (
        <p id={errorId} className="mt-1 text-xs text-red-600" role="alert">
          {field.label} must be {field.max.toLocaleString("en-US")} characters
          or fewer.
        </p>
      ) : null}
    </div>
  );
}
