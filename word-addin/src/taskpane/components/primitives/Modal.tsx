import React, { type ReactNode } from "react";
import { ModalUI, PillButtonUI as PillButton, type PillButtonUITone } from "@mike/ui";
import { cn } from "../../../shared/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  parentLabel?: string;
  children: ReactNode;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon?: ReactNode;
    tone?: PillButtonUITone;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon?: ReactNode;
  };
  /** Back to the previous screen: a black pill, first at the footer's left. */
  backAction?: {
    label?: string;
    onClick: () => void;
    disabled?: boolean;
  };
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  parentLabel = "Assistant",
  children,
  primaryAction,
  secondaryAction,
  backAction,
  className,
}: ModalProps): React.ReactElement | null {
  return (
    <ModalUI
      open={open}
      onClose={onClose}
      breadcrumbs={[parentLabel, title]}
      ariaLabel={title}
      size="md"
      className={cn("h-[min(600px,calc(100vh-2rem))]", className)}
      backAction={
        backAction ? (
          <PillButton
            tone="black"
            size="normal"
            onClick={backAction.onClick}
            disabled={backAction.disabled}
          >
            {backAction.label ?? "Back"}
          </PillButton>
        ) : undefined
      }
      secondaryAction={
        secondaryAction ? (
          <PillButton
            tone="blue"
            size="normal"
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled}
          >
            {secondaryAction.icon}
            {secondaryAction.label}
          </PillButton>
        ) : undefined
      }
      primaryAction={
        primaryAction ? (
          <PillButton
            // Blue, as in the web app; red when it destroys something.
            tone={primaryAction.tone ?? "blue"}
            size="normal"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
          >
            {primaryAction.icon}
            {primaryAction.label}
          </PillButton>
        ) : undefined
      }
    >
      {children}
    </ModalUI>
  );
}
