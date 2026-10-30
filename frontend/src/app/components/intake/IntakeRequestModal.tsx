"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type {
  IntakeCategory,
  IntakeDetails,
  IntakeReceipt,
} from "@mike/contracts";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
  editIntakeRequest,
  submitIntakeRequest,
  uploadIntakeDocuments,
} from "@/app/lib/mikeApi";
import { notifyPartialFailure } from "@/app/lib/userFacingError";
import { discardIntakeDraft } from "@/app/lib/intakeMemory";
import { Modal } from "@/app/components/modals/Modal";
import { ModalSegmentedToggle } from "@/app/components/modals/ModalSegmentedToggle";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { FieldLabel, FormTextInput } from "@/app/components/ui/form-field";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";
import { IntakeDocumentDropZone } from "./IntakeDocumentDropZone";
import { useIntakeDraft, useIntakeMemory } from "./useIntakeMemory";
import {
  useIntakeDraftWarning,
  useIntakeOperation,
} from "./useIntakeOperation";
import {
  INTAKE_CATEGORY_LABELS,
  intakeTimezones,
  isKnownTimezone,
} from "./intakeLabels";

const CATEGORY_OPTIONS = (["general", "nda"] as const).map((value) => ({
  value,
  label: INTAKE_CATEGORY_LABELS[value],
}));
const EMAIL = /^[^@\s]+@[^@\s]+$/;

type Props = {
  orgId: string;
  onClose: () => void;
} & (
  | {
      mode: "create";
      onSaved: (requestId: string) => void;
    }
  | {
      mode: "edit";
      requestId: string;
      version: number;
      initial: IntakeDetails;
      onSaved: () => void;
    }
);

/**
 * Records a request for a named business requester, or edits one. The draft
 * lives in intake memory, so it survives navigation, and an uncertain save is
 * replayed with the same IDs until its outcome is known.
 */
export function IntakeRequestModal(props: Props) {
  const { orgId, onClose } = props;
  const { accountId } = useWorkspace();
  const editing = props.mode === "edit";
  const memory = useIntakeMemory(
    orgId,
    editing ? `edit:${props.requestId}:${props.version}` : "new-request",
  );
  const initial = editing ? props.initial : null;
  const [category, setCategory] = useIntakeDraft<IntakeCategory>(
    memory,
    "category",
    initial?.category ?? "general",
  );
  const [subject, setSubject] = useIntakeDraft(
    memory,
    "subject",
    initial?.subject ?? "",
  );
  const [description, setDescription] = useIntakeDraft(
    memory,
    "description",
    initial?.description ?? "",
  );
  const [requesterName, setRequesterName] = useIntakeDraft(
    memory,
    "requesterName",
    initial?.requester_name ?? "",
  );
  const [requesterEmail, setRequesterEmail] = useIntakeDraft(
    memory,
    "requesterEmail",
    initial?.requester_email ?? "",
  );
  const [requesterTeam, setRequesterTeam] = useIntakeDraft(
    memory,
    "requesterTeam",
    initial?.requester_team ?? "",
  );
  const [date, setDate] = useIntakeDraft(
    memory,
    "date",
    initial?.requested_by_date ?? "",
  );
  const [timezone, setTimezone] = useIntakeDraft(
    memory,
    "timezone",
    () => initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [assignToMe, setAssignToMe] = useIntakeDraft(
    memory,
    "assignToMe",
    true,
  );
  const [files, setFiles] = useIntakeDraft<File[]>(memory, "files", []);
  const [dirty, setDirty] = useIntakeDraft(memory, "dirty", false);
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /**
   * Contract review documents upload once the request exists. A failure then
   * must not read as a failed request: the request is saved either way.
   */
  async function uploadDocuments(requestId: string, pending: File[]) {
    setUploading(true);
    const failed = await uploadIntakeDocuments(
      orgId,
      requestId,
      pending.map((file) => ({ file })),
    ).then(
      (outcomes) =>
        outcomes.filter((outcome) => outcome.status !== "completed").length,
      () => pending.length,
    );
    if (failed)
      notifyPartialFailure(
        failed === pending.length
          ? "The request was saved, but its documents couldn't be uploaded. Add them from the request."
          : `The request was saved, but ${failed} of ${pending.length} documents couldn't be uploaded. Add them from the request.`,
        { action: "upload the documents" },
      );
    if (mounted.current) setUploading(false);
  }
  const operation = useIntakeOperation(
    (receipt: IntakeReceipt) => {
      if (props.mode === "edit") {
        discardIntakeDraft(memory);
        props.onSaved();
        return;
      }
      const requestId = receipt.request_id;
      if (!requestId) return;
      const pending = files;
      if (!pending.length) {
        discardIntakeDraft(memory);
        props.onSaved(requestId);
        return;
      }
      const onSaved = props.onSaved;
      void uploadDocuments(requestId, pending).then(() => {
        // Someone who left mid-upload is not pulled back to the request.
        // Read before discarding: the draft also holds the open dialog.
        const stillOpen = mounted.current;
        discardIntakeDraft(memory);
        if (stillOpen) onSaved(requestId);
      });
    },
    undefined,
    memory,
  );
  const locked = operation.locked || uploading;
  const draftGuard = useIntakeDraftWarning(dirty || locked);
  const timezones = useMemo(() => intakeTimezones(), []);
  const ids = {
    type: useId(),
    subject: useId(),
    documents: useId(),
    description: useId(),
    name: useId(),
    email: useId(),
    team: useId(),
    date: useId(),
    timezone: useId(),
    timezones: useId(),
    assign: useId(),
  };
  const emailInvalid =
    !!requesterEmail.trim() && !EMAIL.test(requesterEmail.trim());
  const timezoneInvalid =
    !!date && !!timezone.trim() && !isKnownTimezone(timezone.trim());
  const complete =
    !!subject.trim() &&
    !!description.trim() &&
    !!requesterName.trim() &&
    !emailInvalid &&
    (!date || (!!timezone.trim() && !timezoneInvalid));
  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setDirty(true);
      set(value);
    };

  function close() {
    if (locked) return;
    draftGuard.requestDiscard(() => {
      if (discardIntakeDraft(memory)) onClose();
    });
  }

  function submit() {
    if (!complete || locked) return;
    const details: IntakeDetails = {
      category,
      subject,
      description,
      requester_name: requesterName.trim(),
      requester_email: requesterEmail.trim() || null,
      requester_team: requesterTeam.trim() || null,
      requested_by_date: date || null,
      timezone: date ? timezone.trim() : null,
    };
    if (props.mode === "edit") {
      const body = {
        ...details,
        command_id: crypto.randomUUID(),
        expected_version: props.version,
      };
      void operation.execute(async () => {
        const receipt = await editIntakeRequest(orgId, props.requestId, body);
        if (receipt.request_id !== props.requestId)
          throw new Error("Mismatched intake receipt");
        return receipt;
      }, "save the request details");
      return;
    }
    const body = {
      ...details,
      id: crypto.randomUUID(),
      command_id: crypto.randomUUID(),
      assignee_id: assignToMe && accountId ? accountId : null,
    };
    void operation.execute(async () => {
      const receipt = await submitIntakeRequest(orgId, body);
      if (receipt.request_id !== body.id)
        throw new Error("Mismatched intake receipt");
      return receipt;
    }, "record the request");
  }

  const savingLabel = uploading
    ? "Uploading documents…"
    : editing
      ? "Saving…"
      : "Recording…";
  return (
    <>
      <Modal
        open
        onClose={close}
        breadcrumbs={["Intake", editing ? "Edit details" : "New request"]}
        footerStatus={
          operation.uncertain ? (
            <span role="status">Checking whether it was saved.</span>
          ) : undefined
        }
        secondaryAction={
          operation.uncertain
            ? {
                label: "Check again",
                onClick: () => void operation.execute(),
                disabled: operation.busy,
              }
            : undefined
        }
        primaryAction={{
          label: operation.busy || uploading
            ? savingLabel
            : editing
              ? "Save details"
              : "Record request",
          icon: operation.busy || uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : undefined,
          onClick: submit,
          disabled: !complete || locked,
        }}
        cancelAction={{
          label: "Cancel",
          onClick: close,
          disabled: locked,
        }}
      >
        <form
          data-modal-scroll="vertical"
          className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div role="group" aria-labelledby={ids.type}>
            <FieldLabel as="p" id={ids.type}>
              Request type
            </FieldLabel>
            <ModalSegmentedToggle
              value={category}
              onChange={change(setCategory)}
              options={CATEGORY_OPTIONS}
              disabled={locked}
            />
          </div>
          {!editing && (
            <div>
              <FieldLabel as="p" id={ids.documents}>
                Documents (optional)
              </FieldLabel>
              <IntakeDocumentDropZone
                files={files}
                labelledBy={ids.documents}
                disabled={locked}
                onAdd={(added) => change(setFiles)([...files, ...added])}
                onRemove={(index) =>
                  change(setFiles)(files.filter((_, i) => i !== index))
                }
              />
            </div>
          )}
          <div>
            <FieldLabel htmlFor={ids.subject}>Subject</FieldLabel>
            <FormTextInput
              id={ids.subject}
              variant="minimal"
              placeholder="Summarize what they need"
              maxLength={200}
              value={subject}
              disabled={locked}
              autoFocus
              onChange={(event) => change(setSubject)(event.target.value)}
            />
          </div>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="sr-only">Requester</legend>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor={ids.name}>Requester</FieldLabel>
              <FormTextInput
                id={ids.name}
                variant="minimal"
                placeholder="Who asked for this"
                maxLength={200}
                autoComplete="off"
                value={requesterName}
                disabled={locked}
                onChange={(event) =>
                  change(setRequesterName)(event.target.value)
                }
              />
            </div>
            <div>
              <FieldLabel htmlFor={ids.email}>Email (optional)</FieldLabel>
              <FormTextInput
                id={ids.email}
                variant="minimal"
                type="email"
                maxLength={320}
                autoComplete="off"
                value={requesterEmail}
                aria-invalid={emailInvalid}
                aria-describedby={
                  emailInvalid ? `${ids.email}-error` : undefined
                }
                disabled={locked}
                onChange={(event) =>
                  change(setRequesterEmail)(event.target.value)
                }
              />
              {emailInvalid && (
                <p
                  id={`${ids.email}-error`}
                  className="mt-1 text-xs text-red-600"
                >
                  Enter an email address like name@company.com.
                </p>
              )}
            </div>
            <div>
              <FieldLabel htmlFor={ids.team}>Team (optional)</FieldLabel>
              <FormTextInput
                id={ids.team}
                variant="minimal"
                placeholder="e.g. Procurement"
                maxLength={200}
                value={requesterTeam}
                disabled={locked}
                onChange={(event) =>
                  change(setRequesterTeam)(event.target.value)
                }
              />
            </div>
          </fieldset>
          <div>
            <FieldLabel htmlFor={ids.description}>
              What do they need?
            </FieldLabel>
            <ModalTextarea
              id={ids.description}
              className="min-h-32"
              placeholder="The question or request, as it came in"
              maxLength={20000}
              value={description}
              disabled={locked}
              onChange={(event) => change(setDescription)(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor={ids.date}>Target date (optional)</FieldLabel>
              <FormTextInput
                id={ids.date}
                type="date"
                value={date}
                disabled={locked}
                onChange={(event) => change(setDate)(event.target.value)}
              />
            </div>
            {date && (
              <div>
                <FieldLabel htmlFor={ids.timezone}>Timezone</FieldLabel>
                <FormTextInput
                  id={ids.timezone}
                  list={ids.timezones}
                  autoComplete="off"
                  value={timezone}
                  aria-invalid={timezoneInvalid}
                  aria-describedby={
                    timezoneInvalid ? `${ids.timezone}-error` : undefined
                  }
                  disabled={locked}
                  onChange={(event) => change(setTimezone)(event.target.value)}
                />
                <datalist id={ids.timezones}>
                  {timezones.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
                {timezoneInvalid && (
                  <p
                    id={`${ids.timezone}-error`}
                    className="mt-1 text-xs text-red-600"
                  >
                    Choose a timezone from the list, such as Europe/London.
                  </p>
                )}
              </div>
            )}
          </div>
          {!editing && (
            <label
              htmlFor={ids.assign}
              className="flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-700"
            >
              <input
                id={ids.assign}
                type="checkbox"
                className={TABLE_CHECKBOX_CLASS}
                checked={assignToMe}
                disabled={locked}
                onChange={(event) =>
                  change(setAssignToMe)(event.target.checked)
                }
              />
              Assign to me
            </label>
          )}
          <p className="text-xs text-gray-500">
            A target date helps the team plan. It is not a legal deadline.
            Everyone in your organization can see this request. Your draft is
            kept while you move around the app, but closing or reloading the tab
            can lose it.
          </p>
        </form>
      </Modal>
      {draftGuard.discardPopup}
    </>
  );
}
