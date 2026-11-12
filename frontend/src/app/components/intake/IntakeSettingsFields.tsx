"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Copy, Info } from "lucide-react";
import { SAVED_KEY_MASK } from "@/app/components/settings/savedKeyMask";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsTextInput } from "@/app/components/settings/SettingsTextInput";
import { notifyError } from "@/app/lib/userFacingError";
import { cn } from "@/app/lib/utils";
import { TextButtonUI } from "@mike/ui";
import { TextSlabUI } from "@mike/ui";
import { ToggleSwitchUI } from "@mike/ui";

/**
 * The fields intake's settings are built from, on the page's cards and in
 * the channel modals alike.
 */

/** Settings' field label, and its label and description beside a switch. */
export const LABEL_CLASS = "mb-2 block text-sm font-medium text-gray-700";
export const ROW_LABEL_CLASS = "text-sm font-medium text-gray-700";
export const ROW_DESCRIPTION_CLASS = "text-sm text-gray-500";
export const HINT_CLASS = "mt-1 text-xs text-gray-500";
export const ERROR_CLASS = "mt-1 text-xs text-red-600";

/**
 * A setting turned on or off, named by its visible label: a row of a card,
 * or `bare` inside a modal, where it is one block among others.
 */
export function ToggleRow({
  label,
  description,
  checked,
  disabled,
  bare = false,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  bare?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const content = (
    <>
      <div className="min-w-0 space-y-1">
        <p id={labelId} className={ROW_LABEL_CLASS}>
          {label}
        </p>
        {description && (
          <p id={descriptionId} className={ROW_DESCRIPTION_CLASS}>
            {description}
          </p>
        )}
      </div>
      <ToggleSwitchUI
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        className="shrink-0"
      />
    </>
  );
  return bare ? (
    <div className="flex min-w-0 items-start justify-between gap-4">
      {content}
    </div>
  ) : (
    <SettingsRow>{content}</SettingsRow>
  );
}

/**
 * A value to paste elsewhere, such as a webhook URL: shown whole, wrapping
 * rather than scrolling, with a button that copies it.
 */
export function CopyValue({
  label,
  name,
  value,
  multiline = false,
  children,
}: {
  label: string;
  /** What the copy button copies, for its accessible name. */
  name: string;
  value: string;
  /** Keep the value's line breaks and indents, as for JSON. */
  multiline?: boolean;
  children?: ReactNode;
}) {
  // The button says Copied, with a tick, for a moment after copying.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className={ROW_LABEL_CLASS}>{label}</p>
        <TextButtonUI
          size="xs"
          // Names what it copies; the visible word starts the name.
          aria-label={`${copied ? "Copied" : "Copy"} ${name}`}
          onClick={() =>
            // Inside the promise, so a browser without clipboard access
            // reports it like any other failure.
            Promise.resolve()
              .then(() => navigator.clipboard.writeText(value))
              .then(
                () => setCopied(true),
                (e) => notifyError(e, { action: `copy the ${name}` }),
              )
          }
        >
          {copied ? (
            <Check aria-hidden="true" className="h-3 w-3" />
          ) : (
            <Copy aria-hidden="true" className="h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </TextButtonUI>
      </div>
      <TextSlabUI>
        <code
          className={cn(
            "block font-mono text-xs text-gray-900 [overflow-wrap:anywhere]",
            multiline && "whitespace-pre-wrap",
          )}
        >
          {value}
        </code>
      </TextSlabUI>
      {children}
    </div>
  );
}

/** A note under a setting: what it needs, or why it isn't working. */
export function SettingsNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <TextSlabUI
      className={cn(
        "flex items-start gap-2 text-xs",
        tone === "error" ? "text-red-700" : "text-gray-700",
      )}
    >
      <Info
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          tone === "error" ? "text-red-600" : "text-gray-500",
        )}
      />
      <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
        {children}
      </div>
    </TextSlabUI>
  );
}

/** A text field labelled above it, with an optional hint below. */
export function TextField({
  label,
  value,
  placeholder,
  hint,
  type = "text",
  maxLength,
  autoComplete = "off",
  disabled = false,
  onChange,
  onEnter,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: ReactNode;
  type?: "text" | "email" | "password";
  maxLength?: number;
  autoComplete?: string;
  /** Shown but not editable, such as a value another channel supplies. */
  disabled?: boolean;
  onChange: (value: string) => void;
  /** Enter does this rather than submitting a form, such as saving. */
  onEnter?: () => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <SettingsTextInput
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        autoComplete={autoComplete}
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onEnter?.();
        }}
      />
      {hint && (
        <p id={`${id}-hint`} className={HINT_CLASS}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A write-only secret: never shown, and kept as saved when left empty. As in
 * the BYOK settings, a saved one shows as a fixed-length mask until the
 * field is focused, which empties it for a replacement; left empty, the mask
 * comes back.
 */
export function SecretField({
  label,
  saved,
  value,
  placeholder,
  disabled = false,
  onChange,
  onEnter,
}: {
  label: string;
  saved: boolean;
  value: string;
  placeholder: string;
  /** Shown masked and not editable, such as a secret another channel supplies. */
  disabled?: boolean;
  onChange: (value: string) => void;
  /** Enter does this rather than submitting a form, such as saving. */
  onEnter?: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const masked = saved && (disabled || (!editing && !value));
  return (
    <div>
      <label htmlFor={id} className={cn(ROW_LABEL_CLASS, "mb-2 block")}>
        {label}
      </label>
      <SettingsTextInput
        id={id}
        type="password"
        // Not a sign-in: keep the browser from filling a saved password.
        autoComplete="new-password"
        spellCheck={false}
        value={masked ? SAVED_KEY_MASK : value}
        readOnly={masked}
        disabled={disabled}
        placeholder={saved ? "Paste a new one to replace it" : placeholder}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onEnter?.();
        }}
      />
    </div>
  );
}
