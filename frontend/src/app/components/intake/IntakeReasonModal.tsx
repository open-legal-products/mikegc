"use client";
import { useId, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Modal, type ModalAction } from "@/app/components/modals/Modal";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { FieldLabel } from "@/app/components/ui/form-field";

/**
 * Collects the reason a cancellation carries; it can't be sent without one.
 * Resolving has its own dialog, which asks first whether to reply.
 */
export function IntakeReasonModal({
  title,
  label,
  hint,
  confirmLabel,
  confirmVariant = "primary",
  value,
  onChange,
  busy,
  locked,
  onConfirm,
  onClose,
  status,
  secondaryAction,
}: {
  title: string;
  label: string;
  hint?: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  /** True while a command is pending or unconfirmed. */
  locked: boolean;
  onConfirm: () => void;
  onClose: () => void;
  status?: ReactNode;
  secondaryAction?: ModalAction;
}) {
  const id = useId();
  return (
    <Modal
      open
      size="sm"
      // As tall as the form, not the default modal height.
      className="h-auto max-h-[calc(100vh-2rem)]"
      onClose={() => !locked && onClose()}
      breadcrumbs={["Intake", title]}
      footerStatus={status}
      secondaryAction={secondaryAction}
      primaryAction={{
        label: confirmLabel,
        variant: confirmVariant,
        icon: busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined,
        onClick: onConfirm,
        disabled: locked || !value.trim(),
      }}
      // Back closes the dialog; there is no separate Cancel.
      backAction={{ label: "Back", onClick: onClose, disabled: locked }}
      cancelAction={false}
    >
      <form
        className="space-y-2 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!locked && value.trim()) onConfirm();
        }}
      >
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <ModalTextarea
          id={id}
          className="min-h-32"
          maxLength={20000}
          value={value}
          disabled={locked}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
        />
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </form>
    </Modal>
  );
}
