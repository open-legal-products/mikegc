"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, ExternalLink, Pencil } from "lucide-react";
import type {
  IntakeConversation,
  IntakeDetails,
  IntakeMember,
  IntakeRequest,
  IntakeSource,
  IntakeState,
} from "@mike/contracts";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import { FormTextInput } from "@/app/components/ui/form-field";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { cn } from "@/app/lib/utils";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownTrigger,
  DropdownSurface,
} from "@/shared/ui/dropdown";
import {
  DateCalendar,
  localDateValue,
  parseDateValue,
} from "@/app/components/ui/date-calendar";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import {
  INTAKE_STATE_DOT_CLASS,
  INTAKE_STATE_LABELS,
  formatIntakeDate,
  formatIntakeDateTime,
  intakeMemberName,
  intakeStateLabel,
  isIntakeOverdue,
} from "./intakeLabels";
import {
  INTAKE_CHANNEL_LABELS,
  INTAKE_SOURCE_LABELS,
  intakeConversationLink,
  isEmailConversation,
} from "./intakeConversation";
import { IntakeUnassigned } from "./IntakeUnassigned";
import { IntakeMikeGCMark, isMikeGCRequest } from "./IntakeActorAvatar";
import { parseIntakeDescription } from "./intakeDescription";

/**
 * Grey and flat like the playbook fields. A fixed starting height with no
 * resize handle; it grows with its text where supported.
 */
export const INTAKE_TEXTAREA_CLASS = `${SETTINGS_CONTROL_CLASS} block max-h-[28rem] min-h-32 resize-none py-2.5 leading-relaxed [field-sizing:content]`;
/**
 * Sidebar fields read as plain values, lined up with their labels, and show
 * a field background only when hovered or focused.
 */
export const PLAIN_FIELD_CLASS =
  "-mx-2 w-[calc(100%+1rem)] rounded-md border border-transparent bg-transparent px-2 text-sm text-gray-900 shadow-none outline-none placeholder:text-gray-400 transition-colors hover:bg-gray-100 focus:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-300/45 disabled:cursor-not-allowed disabled:opacity-60";
export const FIELD_CLASS = `${PLAIN_FIELD_CLASS} h-8`;
/** A field that opens a menu; long names wrap instead of truncating. */
const MENU_FIELD_CLASS = `${PLAIN_FIELD_CLASS} flex min-h-8 items-center justify-between gap-2 py-1 text-left [overflow-wrap:anywhere]`;
export const LABEL_CLASS = "mb-1.5 block text-xs font-medium text-gray-500";
const EMAIL = /^[^@\s]+@[^@\s]+$/;

export type IntakeStatusAction =
  "wait" | "resume" | "resolve" | "cancel" | "reopen";
const INTAKE_STATES: IntakeState[] = [
  "submitted",
  "in_review",
  "needs_information",
  "resolved",
  "cancelled",
];
/** The command that moves an open request into each status; New has none. */
const STATUS_ACTIONS: Record<IntakeState, IntakeStatusAction | null> = {
  submitted: null,
  in_review: "resume",
  needs_information: "wait",
  resolved: "resolve",
  cancelled: "cancel",
};

/**
 * Keeps a field's unsaved text until the saved value changes, so a save from
 * another field or a refresh never replaces what is being typed here.
 */
function useFieldDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

/**
 * The request's details as a sidebar. Each field saves when it is left or
 * Enter is pressed; Escape puts the saved value back.
 */
export function IntakeDetailsPanel({
  request,
  members,
  accountId,
  locked,
  onSave,
  onAssign,
  onStatus,
  onStatusMenuClosed,
  onStopAsking,
}: {
  request: IntakeRequest;
  members: IntakeMember[];
  accountId: string;
  /** Another change is being saved; menus wait for it. */
  locked: boolean;
  onSave: (patch: Partial<IntakeDetails>) => void;
  onAssign: (assigneeId: string | null) => void;
  onStatus: (action: IntakeStatusAction) => void;
  /** After Resolved is chosen and the menu closes, where focus goes next. */
  onStatusMenuClosed?: () => void;
  /** Stop MikeGC asking the requester for missing details. */
  onStopAsking?: () => void;
}) {
  const caps = request.capabilities;
  const editable = caps.edit;
  // Set when a status choice sends focus elsewhere, such as the note form.
  const focusLeaves = useRef(false);
  const overdue = isIntakeOverdue(request);
  const assigneeEmail =
    members.find((m) => m.user_id === request.assignee_id)?.email ?? null;
  const assignee = request.assignee_name ? (
    <Person
      name={request.assignee_name}
      email={assigneeEmail}
      photo={
        members.find((m) => m.user_id === request.assignee_id)?.profile_photo
      }
    />
  ) : (
    <IntakeUnassigned className="text-gray-400" />
  );
  return (
    // The fields label themselves; the name is for assistive technology.
    <aside aria-label="Details" className="space-y-4 px-5 py-4">
      {caps.wait ||
      caps.resume ||
      caps.resolve ||
      caps.cancel ||
      caps.reopen ? (
        <div>
          <p className={LABEL_CLASS}>Status</p>
          <Dropdown>
            <DropdownTrigger asChild>
              <button
                type="button"
                disabled={locked}
                aria-label={`Status: ${intakeStateLabel(request.state, request.clarify_stage)}`}
                className={MENU_FIELD_CLASS}
              >
                <StatusLabel
                  state={request.state}
                  clarifyStage={request.clarify_stage}
                />
                <ChevronDown
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-gray-400"
                />
              </button>
            </DropdownTrigger>
            <DropdownContent
              align="start"
              className="w-[var(--radix-dropdown-menu-trigger-width)]"
              onCloseAutoFocus={(event) => {
                // Resolving moves focus to the note form once the menu has
                // closed, rather than back to this field.
                if (!focusLeaves.current) return;
                focusLeaves.current = false;
                event.preventDefault();
                onStatusMenuClosed?.();
              }}
            >
              {caps.reopen ? (
                <DropdownItem onSelect={() => onStatus("reopen")}>
                  Reopen
                </DropdownItem>
              ) : (
                <DropdownRadioGroup
                  value={request.state}
                  onValueChange={(state) => {
                    const action = STATUS_ACTIONS[state as IntakeState];
                    if (state === request.state || !action) return;
                    focusLeaves.current = action === "resolve";
                    onStatus(action);
                  }}
                >
                  {INTAKE_STATES.map((state) => {
                    const action = STATUS_ACTIONS[state];
                    return (
                      <DropdownRadioItem
                        key={state}
                        value={state}
                        disabled={
                          state !== request.state && !(action && caps[action])
                        }
                      >
                        <StatusLabel state={state} />
                      </DropdownRadioItem>
                    );
                  })}
                </DropdownRadioGroup>
              )}
            </DropdownContent>
          </Dropdown>
        </div>
      ) : (
        <Fact label="Status">
          <StatusLabel
            state={request.state}
            clarifyStage={request.clarify_stage}
          />
        </Fact>
      )}
      {request.clarify_stage && (
        <ClarifyNotice
          rounds={request.clarify_rounds}
          maxRounds={request.clarify_max_rounds}
          locked={locked}
          onStop={caps.stop_asking ? onStopAsking : undefined}
        />
      )}
      {caps.assign ? (
        <AssigneeField
          assigneeId={request.assignee_id}
          assigneeName={request.assignee_name}
          members={members}
          accountId={accountId}
          disabled={locked}
          onChange={onAssign}
        />
      ) : (
        <Fact label="Reviewer">{assignee}</Fact>
      )}
      {editable ? (
        <>
          <div>
            <p className={LABEL_CLASS}>Requester</p>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Requester: ${request.requester_name}`}
                  className={MENU_FIELD_CLASS}
                >
                  <Person
                    name={request.requester_name}
                    email={request.requester_email}
                  />
                  <ChevronDown
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-gray-400"
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                aria-label="Requester"
                className="w-[max(var(--radix-popover-trigger-width),16rem)] space-y-3"
              >
                <DetailField
                  boxed
                  label="Name"
                  value={request.requester_name}
                  maxLength={200}
                  check={(name) => (name ? null : "Enter who asked for this.")}
                  onSave={(name) => onSave({ requester_name: name })}
                />
                <DetailField
                  boxed
                  label="Email"
                  type="email"
                  value={request.requester_email ?? ""}
                  maxLength={320}
                  check={(email) =>
                    !email || EMAIL.test(email)
                      ? null
                      : "Enter an email address like name@company.com."
                  }
                  onSave={(email) => onSave({ requester_email: email || null })}
                />
              </PopoverContent>
            </Popover>
          </div>
          <TargetDateField
            value={request.requested_by_date}
            overdue={overdue}
            onSave={(date) => onSave({ requested_by_date: date })}
          />
        </>
      ) : (
        <>
          <Fact label="Requester">
            <Person
              name={request.requester_name}
              email={request.requester_email}
            />
            {request.requester_email && (
              <span className="block text-xs text-gray-500">
                {request.requester_email}
              </span>
            )}
          </Fact>
          <Fact label="Target date">
            {request.requested_by_date ? (
              <span className={`block ${overdue ? "text-red-600" : ""}`}>
                {formatIntakeDate(request.requested_by_date)}
                {overdue && " · overdue"}
              </span>
            ) : (
              <span className="text-gray-400">None</span>
            )}
          </Fact>
        </>
      )}
      {request.conversation && (
        <ConversationFact conversation={request.conversation} />
      )}
      <Fact label="Created by">
        <Person
          name={request.created_by_name}
          photo={
            members.find((m) => m.user_id === request.created_by)?.profile_photo
          }
          avatar={isMikeGCRequest(request) ? <IntakeMikeGCMark /> : undefined}
          note={INTAKE_SOURCE_NOTES[request.source]}
        />
      </Fact>
      <Fact label="Created">{formatIntakeDateTime(request.created_at)}</Fact>
    </aside>
  );
}

/** Reads a typed target date, such as "2026-12-01" or "1 Dec 2026". */
function parseTypedDate(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = parseDateValue(trimmed);
    return date && localDateValue(date) === trimmed ? trimmed : undefined;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : localDateValue(parsed);
}

/** The target date, typed or chosen from the liquid-glass calendar. */
export function TargetDateField({
  value,
  overdue,
  disabled,
  onSave,
}: {
  value: string | null;
  overdue: boolean;
  /** While a save is pending, the date cannot change under it. */
  disabled?: boolean;
  onSave: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const selected = value ? parseDateValue(value) : undefined;
  const inputId = useId();
  const helpId = useId();
  // A saved date stays on screen until the request comes back with it, so
  // the field does not flash the old date while the save is in flight.
  const [saving, setSaving] = useState<{
    from: string | null;
    to: string | null;
  }>();
  if (saving && saving.from !== value) setSaving(undefined);
  const current = saving ? saving.to : value;
  const shown = draft ?? (current ? formatIntakeDate(current) : "");
  const save = (next: string | null) => {
    if (next === value) return;
    setSaving({ from: value, to: next });
    onSave(next);
  };
  const commit = () => {
    if (draft === null) return;
    const next = parseTypedDate(draft);
    if (next === undefined) {
      setInvalid(true);
      return;
    }
    setDraft(null);
    setInvalid(false);
    save(next);
  };
  return (
    <div>
      <label htmlFor={inputId} className={LABEL_CLASS}>
        Target date
      </label>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              MENU_FIELD_CLASS,
              "focus-within:bg-gray-100",
              invalid && "ring-1 ring-red-400",
            )}
          >
            <input
              id={inputId}
              type="text"
              value={shown}
              placeholder="None"
              disabled={disabled}
              aria-invalid={invalid || undefined}
              aria-describedby={
                invalid || (overdue && draft === null && !saving)
                  ? helpId
                  : undefined
              }
              onChange={(event) => {
                setDraft(event.target.value);
                setInvalid(false);
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // Enter confirms the date; inside a form it must not submit it.
                  event.preventDefault();
                  commit();
                }
                if (event.key === "Escape") {
                  setDraft(null);
                  setInvalid(false);
                }
              }}
              className={cn(
                "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-60",
                overdue && draft === null && !saving && "text-red-600",
              )}
            />
            {overdue && draft === null && !saving && (
              <span
                id={helpId}
                className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
              >
                Overdue
              </span>
            )}
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Choose target date"
                disabled={disabled}
                className="-mr-1 rounded-full p-0.5 text-gray-400 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          asChild
          align="start"
          className="w-[var(--radix-popover-trigger-width)] rounded-2xl"
          collisionPadding={16}
          aria-label="Target date calendar"
        >
          <DropdownSurface>
            <DateCalendar
              fill
              selected={selected}
              defaultMonth={selected ?? new Date()}
              startMonth={new Date(new Date().getFullYear() - 1, 0, 1)}
              endMonth={new Date(new Date().getFullYear() + 5, 11, 1)}
              onSelect={(date) => {
                setOpen(false);
                setDraft(null);
                setInvalid(false);
                save(localDateValue(date));
              }}
            />
            {value && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setDraft(null);
                  save(null);
                }}
                className="mt-1 w-full rounded-md py-1 text-center text-xs text-gray-500 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                Clear date
              </button>
            )}
          </DropdownSurface>
        </PopoverContent>
      </Popover>
      {invalid && (
        <p id={helpId} className="mt-1.5 text-xs text-red-600">
          Enter a date such as {formatIntakeDate(localDateValue(new Date()))}.
        </p>
      )}
    </div>
  );
}

/** A status with its colour dot, matching the intake table. */
function StatusLabel({
  state,
  clarifyStage,
}: {
  state: IntakeState;
  /** Waiting on requester says when MikeGC asked. */
  clarifyStage?: IntakeRequest["clarify_stage"];
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${INTAKE_STATE_DOT_CLASS[state]}`}
      />
      {clarifyStage
        ? intakeStateLabel(state, clarifyStage)
        : INTAKE_STATE_LABELS[state]}
    </span>
  );
}

/**
 * MikeGC asked the requester for missing details and is waiting for the
 * answer. Stop asking hands the request back to Legal as it stands.
 */
function ClarifyNotice({
  rounds,
  maxRounds,
  locked,
  onStop,
}: {
  rounds: number;
  maxRounds: number;
  locked: boolean;
  onStop?: () => void;
}) {
  const round = Math.min(Math.max(rounds, 1), maxRounds);
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-500">
        MikeGC is waiting for the requester&apos;s answer (round {round} of{" "}
        {maxRounds}).
      </p>
      {onStop && (
        <TextButtonUI
          size="xs"
          className="-ml-2"
          disabled={locked}
          onClick={onStop}
        >
          Stop asking
        </TextButtonUI>
      )}
    </div>
  );
}

/**
 * The thread the request came from, where messages to the requester go: a
 * Slack or Teams channel with a link to the thread, or for email just
 * Gmail or Outlook.
 */
function ConversationFact({
  conversation,
}: {
  conversation: IntakeConversation;
}) {
  const link = intakeConversationLink(conversation);
  const channel = conversation.channel_name?.replace(/^#/, "");
  if (isEmailConversation(conversation))
    return (
      <Fact label="Conversation">
        {INTAKE_CHANNEL_LABELS[conversation.source]}
      </Fact>
    );
  const name =
    conversation.source === "slack"
      ? channel
        ? `Slack thread in #${channel}`
        : "Slack thread"
      : channel
        ? `Teams thread in ${channel}`
        : "Teams thread";
  return (
    <Fact label="Conversation">
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-blue-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          {name}
          <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span className="block">{name}</span>
      )}
      {conversation.source === "teams" && conversation.team_name && (
        <span className="block text-xs text-gray-500">
          {conversation.team_name}
        </span>
      )}
    </Fact>
  );
}

/** A labelled value that cannot be edited here. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={LABEL_CLASS}>{label}</p>
      <div className="text-sm text-gray-900 [overflow-wrap:anywhere]">
        {children}
      </div>
    </div>
  );
}

/** Where a request came from, after its creator; a member's own has none. */
const INTAKE_SOURCE_NOTES: Record<IntakeSource, string | null> = {
  manual: null,
  slack: `from ${INTAKE_SOURCE_LABELS.slack}`,
  outlook: `from ${INTAKE_SOURCE_LABELS.outlook}`,
  gmail: `from ${INTAKE_SOURCE_LABELS.gmail}`,
  teams: `from ${INTAKE_SOURCE_LABELS.teams}`,
};

/** A person's avatar beside their name; the name labels the avatar. */
function Person({
  name,
  email,
  photo,
  label,
  avatar,
  note,
}: {
  name: string;
  email?: string | null;
  photo?: string | null;
  /** Shown in place of the name, such as "Myself"; the avatar keeps it. */
  label?: string;
  /** A mark in place of the avatar, such as MikeGC's. */
  avatar?: ReactNode;
  /** Muted text after the name, such as "from email". */
  note?: string | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {avatar ?? (
        <span aria-hidden="true" className="flex">
          <UserAvatar size="sm" name={name} email={email} photo={photo} />
        </span>
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {label ?? name}
        {note && <span className="text-gray-500"> {note}</span>}
      </span>
    </span>
  );
}

/**
 * Chooses who a request is assigned to: Unassigned or any member, each shown
 * with their avatar. The viewer is listed first, as Myself.
 */
export function AssigneeField({
  assigneeId,
  assigneeName,
  members,
  accountId,
  disabled,
  onChange,
}: {
  assigneeId: string | null;
  /** Shown while the members are loading or after the assignee has left. */
  assigneeName: string | null;
  members: IntakeMember[];
  accountId: string | null;
  disabled?: boolean;
  onChange: (assigneeId: string | null) => void;
}) {
  const current = members.find((m) => m.user_id === assigneeId);
  const name = current ? intakeMemberName(current) : assigneeName;
  // The viewer comes first, then everyone else in the server's name order.
  const ordered = [
    ...members.filter((m) => m.user_id === accountId),
    ...members.filter((m) => m.user_id !== accountId),
  ];
  return (
    <div>
      <p className={LABEL_CLASS}>Reviewer</p>
      <Dropdown>
        <DropdownTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Reviewer: ${assigneeId && name ? name : "Unassigned"}`}
            className={MENU_FIELD_CLASS}
          >
            {assigneeId && name ? (
              <Person
                name={name}
                email={current?.email}
                photo={current?.profile_photo}
              />
            ) : (
              <IntakeUnassigned className="text-gray-400" />
            )}
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-gray-400"
            />
          </button>
        </DropdownTrigger>
        <DropdownContent
          align="start"
          className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          <DropdownRadioGroup
            value={assigneeId ?? ""}
            onValueChange={(value) => {
              const next = value || null;
              if (next !== assigneeId) onChange(next);
            }}
          >
            <DropdownRadioItem value="">
              <IntakeUnassigned className="text-gray-500" />
            </DropdownRadioItem>
            {ordered.map((m) => (
              <DropdownRadioItem key={m.user_id} value={m.user_id}>
                <Person
                  name={intakeMemberName(m)}
                  email={m.email}
                  photo={m.profile_photo}
                  label={m.user_id === accountId ? "Myself" : undefined}
                />
              </DropdownRadioItem>
            ))}
          </DropdownRadioGroup>
        </DropdownContent>
      </Dropdown>
    </div>
  );
}

/** An input that saves its trimmed value when left or on Enter. */
function DetailField({
  label,
  value,
  onSave,
  check,
  help,
  type = "text",
  maxLength,
  placeholder,
  list,
  boxed,
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  /** Says what is wrong with a value that cannot be saved. */
  check?: (value: string) => string | null;
  help?: ReactNode;
  type?: "text" | "email" | "date";
  maxLength?: number;
  placeholder?: string;
  list?: string;
  /** A grey input, for fields inside a popover rather than the sidebar. */
  boxed?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useFieldDraft(value);
  const [tried, setTried] = useState(false);
  const problem = tried ? (check?.(draft.trim()) ?? null) : null;
  const described = [problem && `${id}-error`, help && `${id}-help`]
    .filter(Boolean)
    .join(" ");

  function commit() {
    const next = draft.trim();
    if (next === value) {
      setDraft(value);
      setTried(false);
      return;
    }
    setTried(true);
    if (check?.(next)) return;
    setTried(false);
    onSave(next);
  }

  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        list={list}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={!!problem}
        aria-describedby={described || undefined}
        className={boxed ? `${SETTINGS_CONTROL_CLASS} h-9` : FIELD_CLASS}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            setDraft(value);
            setTried(false);
          }
        }}
      />
      {problem && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600">
          {problem}
        </p>
      )}
      {help && (
        <p id={`${id}-help`} className="mt-1.5 text-xs text-gray-500">
          {help}
        </p>
      )}
    </div>
  );
}

/**
 * The request's subject as the page title. Where it can be edited it is an
 * input that looks like the title until hovered or focused.
 */
export function IntakeSubjectInput({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (subject: string) => void;
  /** Sets the title's type, such as the page's serif heading. */
  className?: string;
}) {
  const [draft, setDraft] = useFieldDraft(value);
  function commit() {
    const next = draft.trim();
    // A request always has a subject; clearing it puts the saved one back.
    if (!next || next === value) setDraft(value);
    else onSave(next);
  }
  return (
    <FormTextInput
      variant="minimal"
      aria-label="Subject"
      value={draft}
      maxLength={200}
      autoComplete="off"
      title={value}
      className={cn("min-w-0 truncate text-gray-900", className)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
        }
      }}
    />
  );
}

/** The longest description the server saves. */
const DESCRIPTION_MAX = 20000;

/**
 * The request's description, with Edit to change it in place. The editor
 * stays open with its text until the saved description matches it. The
 * original message MikeGC appended under its summary reads in Messages;
 * Edit changes only the summary and keeps the message as it was.
 */
export function IntakeDescription({
  value,
  editable,
  locked,
  onSave,
}: {
  value: string;
  editable: boolean;
  locked: boolean;
  onSave: (description: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(value);
  const original = parseIntakeDescription(value);
  const text = original ? original.summary : value;
  // The message saved under the summary counts toward the description's
  // 20,000 characters, so the summary gets what it leaves.
  const summaryMax = original
    ? Math.max(0, DESCRIPTION_MAX - original.original.length - 2)
    : DESCRIPTION_MAX;
  if (saved !== value) {
    setSaved(value);
    if (draft !== null && draft.trim() === text) setDraft(null);
  }
  const editing = draft !== null;
  return (
    <section aria-labelledby="intake-request" className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="intake-request" className="text-sm font-medium text-gray-900">
          Request
        </h2>
        {editable && !editing && (
          <button
            type="button"
            aria-label="Edit request"
            onClick={() => setDraft(text)}
            title="Edit request"
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {editing ? (
        // The actions sit inside the box, under the text, like the note box.
        <div className="rounded-lg bg-gray-100 transition-shadow focus-within:ring-2 focus-within:ring-gray-300/45">
          <textarea
            aria-labelledby="intake-request"
            rows={5}
            maxLength={summaryMax}
            autoFocus
            value={draft}
            className={cn(
              INTAKE_TEXTAREA_CLASS,
              "min-h-48 bg-transparent focus:border-transparent focus:ring-0",
            )}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(null);
            }}
          />
          <div className="flex items-center justify-end gap-1 px-2 pb-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-md px-2 text-sm text-gray-500 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim() || draft.trim() === text || locked}
              onClick={() =>
                onSave(
                  original
                    ? `${draft.trim()}\n\n${original.original}`
                    : draft.trim(),
                )
              }
              className="rounded-md px-2 text-sm font-medium text-gray-900 transition-colors hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:text-gray-400"
            >
              Submit
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {text}
        </p>
      )}
    </section>
  );
}
