"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
  JURISDICTION_OPTIONS,
  type JurisdictionOption,
} from "@/app/lib/jurisdictionOptions";
import {
  getOrgProfile,
  updateOrgProfile,
  type OrgProfile,
  type OrgProfileFields,
  type OrgProfileTextField,
} from "@/app/lib/mikeApi";
import { notifyError, userFacingApiError } from "@/app/lib/userFacingError";
import { cn } from "@/app/lib/utils";
import { COUNTRY_OPTIONS } from "@/app/onboarding/options";
import {
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownItem,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownSeparator,
  DropdownTrigger,
} from "@/shared/ui/dropdown";
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

/** Mirrors ORG_PROFILE_TEXT_FIELDS in backend/src/lib/orgProfile.ts. */
export const ORG_PROFILE_LIMITS: Record<OrgProfileTextField, number> = {
  about: 2000,
  industry: 200,
  headquarters_city: 100,
  headquarters_country: 100,
  legal_entities: 1000,
  legal_team_scope: 1000,
  additional_context: 2000,
};

type TextSpec = {
  key: OrgProfileTextField;
  label: string;
  description?: string;
  placeholder: string;
  multiline: boolean;
  /** What an over-limit message calls the field, when not its label. */
  errorName?: string;
};

const ABOUT: TextSpec = {
  key: "about",
  label: "What does your organization do?",
  errorName: "This answer",
  placeholder:
    "e.g. We make accounting software for small businesses, sold by subscription in the UK and Europe.",
  multiline: true,
};
const INDUSTRY: TextSpec = {
  key: "industry",
  label: "Industry",
  placeholder: "e.g. Financial software",
  multiline: false,
};
const LEGAL_ENTITIES: TextSpec = {
  key: "legal_entities",
  label: "Legal entities",
  description: "Lets Mike tell which party to a contract is yours.",
  placeholder:
    "e.g. Acme Holdings Ltd (England and Wales)\nAcme Inc. (Delaware)",
  multiline: true,
};
const LEGAL_TEAM_SCOPE: TextSpec = {
  key: "legal_team_scope",
  label: "Scope of legal team",
  placeholder:
    "e.g. Commercial contracts, privacy and employment. Disputes go to outside counsel.",
  multiline: true,
};
const ADDITIONAL_CONTEXT: TextSpec = {
  key: "additional_context",
  label: "Other context",
  description:
    "Standard positions, preferred governing law, risk appetite, or anything else that helps.",
  placeholder:
    "e.g. We contract on our own terms where we can, under English law.",
  multiline: true,
};

/** Countries and their subdivisions, with the EU, whose law many organizations work under. */
const ORG_JURISDICTION_OPTIONS: JurisdictionOption[] = [
  { value: "European Union", label: "European Union" },
  ...JURISDICTION_OPTIONS,
];
const JURISDICTION_ORDER = new Map(
  ORG_JURISDICTION_OPTIONS.map((option, index) => [option.value, index]),
);

/** The picked jurisdictions in the menu's order; any not in it first. */
function inMenuOrder(list: string[]): string[] {
  return [...list].sort(
    (a, b) =>
      (JURISDICTION_ORDER.get(a) ?? -1) - (JURISDICTION_ORDER.get(b) ?? -1),
  );
}

/** Radix needs a value for "no country"; this one is never a country. */
const NO_COUNTRY = "__none__";

type Draft = Record<OrgProfileTextField, string> & { jurisdictions: string[] };

const TEXT_KEYS = Object.keys(ORG_PROFILE_LIMITS) as OrgProfileTextField[];

/** As the server stores it: plain line endings, no outer whitespace. */
function normalize(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function draftOf(profile: OrgProfile): Draft {
  const draft = { jurisdictions: profile.jurisdictions ?? [] } as Draft;
  for (const key of TEXT_KEYS) draft[key] = profile[key] ?? "";
  return draft;
}

/** The fields that differ from what is saved, as the server should store them. */
function changesOf(draft: Draft, saved: Draft): Partial<OrgProfileFields> {
  const changes: Partial<OrgProfileFields> = {};
  for (const key of TEXT_KEYS) {
    const value = normalize(draft[key]);
    if (value !== normalize(saved[key])) changes[key] = value || null;
  }
  if (draft.jurisdictions.join("\n") !== saved.jurisdictions.join("\n"))
    changes.jurisdictions = draft.jurisdictions;
  return changes;
}

const tooLongText = (label: string, max: number) =>
  `${label} must be ${max.toLocaleString("en-US")} characters or fewer.`;

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
    ? TEXT_KEYS.filter((key) => normalize(draft[key]).length > ORG_PROFILE_LIMITS[key])
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

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const text = (spec: TextSpec) =>
    draft ? (
      <TextField
        spec={spec}
        value={draft[spec.key]}
        disabled={saving}
        onChange={(value) => set(spec.key, value)}
      />
    ) : (
      <RowSkeleton description={!!spec.description} tall={spec.multiline} />
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
        use these details.
      </SettingsDescription>

      <GlassCardUI>
        <SettingsRow layout="stacked">{text(ABOUT)}</SettingsRow>
        <SettingsRow layout="stacked">{text(INDUSTRY)}</SettingsRow>
        <SettingsRow layout="stacked">
          {draft ? (
            <HeadquartersField
              city={draft.headquarters_city}
              country={draft.headquarters_country}
              disabled={saving}
              onCity={(value) => set("headquarters_city", value)}
              onCountry={(value) => set("headquarters_country", value)}
            />
          ) : (
            <RowSkeleton pair />
          )}
        </SettingsRow>
        <SettingsRow layout="stacked">
          {draft ? (
            <JurisdictionsField
              value={draft.jurisdictions}
              disabled={saving}
              onChange={(value) => set("jurisdictions", value)}
            />
          ) : (
            <RowSkeleton />
          )}
        </SettingsRow>
        <SettingsRow layout="stacked">{text(LEGAL_ENTITIES)}</SettingsRow>
        <SettingsRow layout="stacked">{text(LEGAL_TEAM_SCOPE)}</SettingsRow>
        <SettingsRow layout="stacked">{text(ADDITIONAL_CONTEXT)}</SettingsRow>
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

/** A row's shape while the profile loads: label, optional description, control. */
function RowSkeleton({
  description = false,
  tall = false,
  pair = false,
}: {
  description?: boolean;
  tall?: boolean;
  pair?: boolean;
}) {
  const control = (
    <span
      className={cn(
        "block w-full animate-pulse rounded-lg bg-gray-200",
        tall ? "h-24" : "h-10",
      )}
    />
  );
  return (
    <div className="space-y-2" aria-hidden>
      <span className="block h-4 w-28 animate-pulse rounded bg-gray-200" />
      {description ? (
        <span className="block h-4 w-64 max-w-full animate-pulse rounded bg-gray-200" />
      ) : null}
      {pair ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {control}
          {control}
        </div>
      ) : (
        control
      )}
    </div>
  );
}

/** The count shows once it matters: near the limit, or past it. */
function LengthCount({ length, max }: { length: number; max: number }) {
  if (length < max * 0.9) return null;
  return (
    <span
      className={cn(
        "shrink-0 text-xs tabular-nums",
        length > max ? "text-red-600" : "text-gray-400",
      )}
    >
      {length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </span>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-red-600" role="alert">
      {children}
    </p>
  );
}

function TextField({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: TextSpec;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `org-profile-${spec.key}`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const max = ORG_PROFILE_LIMITS[spec.key];
  const length = normalize(value).length;
  const over = length > max;
  const describedBy =
    [spec.description ? descriptionId : null, over ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const common = {
    id,
    value,
    disabled,
    placeholder: spec.placeholder,
    "aria-describedby": describedBy,
    "aria-invalid": over || undefined,
  };
  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <FieldLabel htmlFor={id}>{spec.label}</FieldLabel>
        <LengthCount length={length} max={max} />
      </div>
      {spec.description ? (
        <p id={descriptionId} className="-mt-1 mb-2 text-xs text-gray-500">
          {spec.description}
        </p>
      ) : null}
      {spec.multiline ? (
        <textarea
          {...common}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            // No resize handle: the box grows with its text instead.
            "block min-h-24 max-h-96 resize-none py-2 [field-sizing:content] [overflow-wrap:anywhere]",
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
        <FieldError id={errorId}>
          {tooLongText(spec.errorName ?? spec.label, max)}
        </FieldError>
      ) : null}
    </div>
  );
}

/**
 * A select-like button that opens a menu; its text wraps rather than clips.
 * One line is as tall as a text input, and centred the same way.
 */
const PICKER_TRIGGER_CLASS = cn(
  "flex min-h-10 w-full items-center justify-between gap-2 py-2 text-left",
  SETTINGS_CONTROL_CLASS,
);

/** The city, typed, and the country, picked from the list. */
function HeadquartersField({
  city,
  country,
  disabled,
  onCity,
  onCountry,
}: {
  city: string;
  country: string;
  disabled: boolean;
  onCity: (value: string) => void;
  onCountry: (value: string) => void;
}) {
  const labelId = "org-profile-headquarters-label";
  const errorId = "org-profile-headquarters-error";
  const max = ORG_PROFILE_LIMITS.headquarters_city;
  const over = normalize(city).length > max;
  // A country saved some other way stays choosable, so opening the menu
  // does not lose it.
  const countries: readonly string[] =
    country && !(COUNTRY_OPTIONS as readonly string[]).includes(country)
      ? [country, ...COUNTRY_OPTIONS]
      : COUNTRY_OPTIONS;
  return (
    <div role="group" aria-labelledby={labelId} className="min-w-0">
      <FieldLabel as="p" id={labelId}>
        Headquarters
      </FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <SettingsTextInput
          type="text"
          aria-label="Headquarters city"
          placeholder="City"
          value={city}
          disabled={disabled}
          aria-describedby={over ? errorId : undefined}
          aria-invalid={over || undefined}
          onChange={(event) => onCity(event.target.value)}
        />
        <Dropdown>
          <DropdownTrigger asChild>
            <button
              type="button"
              aria-label="Headquarters country"
              disabled={disabled}
              className={PICKER_TRIGGER_CLASS}
            >
              <span
                className={cn(
                  "min-w-0 [overflow-wrap:anywhere]",
                  !country && "text-gray-400",
                )}
              >
                {country || "Country"}
              </span>
              <ChevronDown
                aria-hidden
                className="h-4 w-4 shrink-0 text-gray-400"
              />
            </button>
          </DropdownTrigger>
          <DropdownContent
            align="start"
            sideOffset={6}
            className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
          >
            <DropdownRadioGroup
              value={country || NO_COUNTRY}
              onValueChange={(value) => onCountry(value === NO_COUNTRY ? "" : value)}
            >
              <DropdownRadioItem value={NO_COUNTRY}>Not set</DropdownRadioItem>
              {countries.map((option) => (
                <DropdownRadioItem key={option} value={option}>
                  {option}
                </DropdownRadioItem>
              ))}
            </DropdownRadioGroup>
          </DropdownContent>
        </Dropdown>
      </div>
      {over ? (
        <FieldError id={errorId}>{tooLongText("Headquarters city", max)}</FieldError>
      ) : null}
    </div>
  );
}

/** Several jurisdictions, picked from countries and their subdivisions. */
function JurisdictionsField({
  value,
  disabled,
  onChange,
}: {
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const id = "org-profile-jurisdictions";
  const summaryId = `${id}-summary`;
  // Any saved some other way are listed first, so they can be unticked.
  const unknown = value.filter((item) => !JURISDICTION_ORDER.has(item));
  const options: JurisdictionOption[] = [
    ...unknown.map((item) => ({ value: item, label: item })),
    ...ORG_JURISDICTION_OPTIONS,
  ];
  const toggle = (option: string) =>
    onChange(
      inMenuOrder(
        value.includes(option)
          ? value.filter((item) => item !== option)
          : [...value, option],
      ),
    );
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id}>Jurisdictions</FieldLabel>
      <Dropdown>
        <DropdownTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-describedby={summaryId}
            className={PICKER_TRIGGER_CLASS}
          >
            <span
              id={summaryId}
              className={cn(
                "min-w-0 [overflow-wrap:anywhere]",
                value.length === 0 && "text-gray-400",
              )}
            >
              {value.length ? value.join(", ") : "Select jurisdictions"}
            </span>
            <ChevronDown
              aria-hidden
              className="h-4 w-4 shrink-0 text-gray-400"
            />
          </button>
        </DropdownTrigger>
        <DropdownContent
          align="start"
          sideOffset={6}
          className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          {value.length ? (
            <>
              <DropdownItem onSelect={() => onChange([])}>Clear all</DropdownItem>
              <DropdownSeparator />
            </>
          ) : null}
          {options.map((option) => (
            <DropdownCheckboxItem
              key={option.value}
              checked={value.includes(option.value)}
              onCheckedChange={() => toggle(option.value)}
              // Stays open so several can be picked in a row.
              onSelect={(event) => event.preventDefault()}
              className={option.nested ? "pl-6" : undefined}
            >
              {option.label}
            </DropdownCheckboxItem>
          ))}
        </DropdownContent>
      </Dropdown>
    </div>
  );
}
