"use client";
import { useEffect, useId, useRef, useState } from "react";
import type {
  IntakeDetails,
  IntakeMember,
  IntakeReceipt,
} from "@mike/contracts";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
  copyIntakeDocuments,
  getIntakeMembers,
  submitIntakeRequest,
  UploadBatchError,
  uploadIntakeDocuments,
} from "@/app/lib/mikeApi";
import { notifyPartialFailure } from "@/app/lib/userFacingError";
import { discardIntakeDraft } from "@/app/lib/intakeMemory";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormTextInput } from "@/app/components/ui/form-field";
import { cn } from "@/app/lib/utils";
import { GlassCardUI } from "@mike/ui";
import { PillButtonUI } from "@mike/ui";
import { DetailColumns } from "./IntakeDetail";
import {
  AssigneeField,
  FIELD_CLASS,
  INTAKE_TEXTAREA_CLASS,
  LABEL_CLASS,
  TargetDateField,
} from "./IntakeDetailsPanel";
import { IntakeDocumentDropZone } from "./IntakeDocumentDropZone";
import { useIntakeDraft, useIntakeMemory } from "./useIntakeMemory";
import {
  useIntakeDraftWarning,
  useIntakeOperation,
} from "./useIntakeOperation";
import { isIntakeOverdue } from "./intakeLabels";
import { INTAKE_REQUESTS_PATH } from "./intakeQuery";
import {
  IntakeDocumentPicker,
  type IntakePickedDocument,
} from "./IntakeDocumentPicker";

const EMAIL = /^[^@\s]+@[^@\s]+$/;

/** Names documents in a notice: "A.pdf and B.docx", or the first three and how many more. */
function nameDocuments(names: string[]) {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    more ? [...shown, `${more} more`] : shown,
  );
}

/** The new-request page for the current workspace: an organization or Personal. */
export function IntakeNewRequestPage() {
  const { accountId, workspaceId } = useWorkspace();
  const router = useRouter();
  if (!accountId || !workspaceId)
    return (
      <EmptyState title="Intake" description="Sign in to create requests." />
    );
  const orgId = workspaceId;
  return (
    <IntakeNewRequest
      key={`${accountId}:${orgId}`}
      orgId={orgId}
      onClose={() => router.push(INTAKE_REQUESTS_PATH)}
      onSaved={(id) => router.replace(`/intake/${id}?org=${orgId}`)}
    />
  );
}

/**
 * Creates a request for a named business requester, laid out like the
 * request page: the subject as the title, the request beside its details. The draft lives in intake
 * memory, so it survives navigation, and an uncertain save is replayed with
 * the same IDs until its outcome is known. Details are edited afterwards on
 * the request page.
 */
export function IntakeNewRequest({
  orgId,
  onClose,
  onSaved,
}: {
  orgId: string;
  onClose: () => void;
  onSaved: (requestId: string) => void;
}) {
  const { accountId } = useWorkspace();
  const memory = useIntakeMemory(orgId, "new-request");
  const [subject, setSubject] = useIntakeDraft(memory, "subject", "");
  const [description, setDescription] = useIntakeDraft(
    memory,
    "description",
    "",
  );
  const [requesterName, setRequesterName] = useIntakeDraft(
    memory,
    "requesterName",
    "",
  );
  const [requesterEmail, setRequesterEmail] = useIntakeDraft(
    memory,
    "requesterEmail",
    "",
  );
  const [date, setDate] = useIntakeDraft(memory, "date", "");
  // New requests are assigned to their creator unless someone else is chosen.
  const [assigneeId, setAssigneeId] = useIntakeDraft<string | null>(
    memory,
    "assigneeId",
    accountId ?? null,
  );
  const [members, setMembers] = useState<IntakeMember[]>([]);
  useEffect(() => {
    let current = true;
    // Without the list, the field still shows the current choice.
    getIntakeMembers(orgId).then(
      (list) => current && setMembers(list),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [orgId]);
  const [files, setFiles] = useIntakeDraft<File[]>(memory, "files", []);
  // Library documents chosen in Add documents, copied once the request exists.
  const [picked, setPicked] = useIntakeDraft<IntakePickedDocument[]>(
    memory,
    "picked",
    [],
  );
  const [picking, setPicking] = useState(false);
  const [dirty, setDirty] = useIntakeDraft(memory, "dirty", false);
  // Set from the moment the request is saved until its documents are added.
  // It is kept with the draft, so the form stays locked even if the page is
  // left and opened again meanwhile: the saved request is never sent twice.
  const [addingDocuments, setAddingDocuments] = useIntakeDraft(
    memory,
    "addingDocuments",
    false,
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /**
   * Documents upload, and library documents are copied, once the request
   * exists. A failure then must not read as a failed request: the request is
   * saved either way. Each returns the names of the documents not added.
   */
  async function uploadDocuments(requestId: string, pending: File[]) {
    if (!pending.length) return [];
    try {
      const outcomes = await uploadIntakeDocuments(
        orgId,
        requestId,
        pending.map((file) => ({ file })),
      );
      return outcomes
        .filter((outcome) => outcome.status !== "completed")
        .map((outcome) => outcome.filename);
    } catch (error) {
      // A later upload session can fail after earlier ones added documents;
      // those must not be named as missing.
      if (error instanceof UploadBatchError)
        return error.outcomes
          .filter((outcome) => outcome.status !== "completed")
          .map((outcome) => outcome.filename);
      return pending.map((file) => file.name);
    }
  }
  async function copyDocuments(
    requestId: string,
    chosen: IntakePickedDocument[],
  ) {
    const failed: string[] = [];
    // One at a time, so the notice can name exactly the ones that failed.
    for (const document of chosen) {
      try {
        await copyIntakeDocuments(orgId, requestId, [document.id]);
      } catch {
        failed.push(document.filename);
      }
    }
    return failed;
  }
  const operation = useIntakeOperation(
    (receipt: IntakeReceipt) => {
      const requestId = receipt.request_id;
      if (!requestId) return;
      const pending = files;
      const copies = picked;
      if (!pending.length && !copies.length) {
        discardIntakeDraft(memory);
        onSaved(requestId);
        return;
      }
      setAddingDocuments(true);
      void Promise.all([
        uploadDocuments(requestId, pending),
        copyDocuments(requestId, copies),
      ]).then(([notUploaded, notCopied]) => {
        const failed = [...notUploaded, ...notCopied];
        if (failed.length)
          notifyPartialFailure(
            `The request was saved, but ${nameDocuments(failed)} couldn't be added. Add ${failed.length === 1 ? "it" : "them"} from the request.`,
            { action: "add the documents" },
          );
        // Someone who left mid-upload is not pulled back to the request.
        // Read before discarding: the draft also holds the open dialog.
        const stillOpen = mounted.current;
        setAddingDocuments(false);
        discardIntakeDraft(memory);
        if (stillOpen) onSaved(requestId);
      });
    },
    undefined,
    memory,
  );
  const locked = operation.locked || addingDocuments;
  const draftGuard = useIntakeDraftWarning(dirty || locked);
  const ids = {
    documents: useId(),
    description: useId(),
    name: useId(),
    email: useId(),
    date: useId(),
  };
  const emailInvalid =
    !!requesterEmail.trim() && !EMAIL.test(requesterEmail.trim());
  const complete =
    !!subject.trim() &&
    !!description.trim() &&
    !!requesterName.trim() &&
    !emailInvalid;
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
      subject,
      description,
      requester_name: requesterName.trim(),
      requester_email: requesterEmail.trim() || null,
      // The team field is hidden for now; requests are created without one.
      requester_team: null,
      requested_by_date: date || null,
    };
    const body = {
      ...details,
      id: crypto.randomUUID(),
      command_id: crypto.randomUUID(),
      assignee_id: assigneeId,
    };
    void operation.execute(async () => {
      const receipt = await submitIntakeRequest(orgId, body);
      if (receipt.request_id !== body.id)
        throw new Error("Mismatched intake receipt");
      return receipt;
    }, "create the request");
  }

  const savingLabel = addingDocuments ? "Adding documents…" : "Creating…";
  const overdue =
    !!date &&
    isIntakeOverdue({
      state: "submitted",
      requested_by_date: date,
    });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        shrink
        breadcrumbs={[
          { label: "Intake", onClick: close, title: "Back to Intake" },
          { label: "Requests", onClick: close, title: "Back to requests" },
          { label: "New request" },
        ]}
      />
      <form
        className="@container flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DetailColumns
          title={
            <FormTextInput
              variant="minimal"
              aria-label="Subject"
              placeholder="Subject"
              maxLength={200}
              value={subject}
              disabled={locked}
              autoFocus
              onChange={(event) => change(setSubject)(event.target.value)}
              className="font-medium text-gray-900"
            />
          }
          details={
            <div className="space-y-4 p-4">
              <fieldset className="space-y-4">
                <legend className="sr-only">Requester</legend>
                <div>
                  <label htmlFor={ids.name} className={LABEL_CLASS}>
                    Requester
                  </label>
                  <input
                    id={ids.name}
                    placeholder="Who asked for this"
                    maxLength={200}
                    autoComplete="off"
                    value={requesterName}
                    disabled={locked}
                    onChange={(event) =>
                      change(setRequesterName)(event.target.value)
                    }
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor={ids.email} className={LABEL_CLASS}>
                    Requester email
                  </label>
                  <input
                    id={ids.email}
                    type="email"
                    placeholder="Optional"
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
                    className={FIELD_CLASS}
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
              </fieldset>
              <TargetDateField
                value={date || null}
                overdue={overdue}
                disabled={locked}
                onSave={(next) => change(setDate)(next ?? "")}
              />
              <AssigneeField
                assigneeId={assigneeId}
                // Until the members load, or if they cannot be, the default
                // still says who the request will go to.
                assigneeName={
                  assigneeId && assigneeId === accountId ? "Myself" : null
                }
                members={members}
                accountId={accountId ?? null}
                disabled={locked}
                onChange={change(setAssigneeId)}
              />
            </div>
          }
        >
          <GlassCardUI>
            <div className="divide-y divide-gray-100">
              <section className="space-y-2 px-5 py-4">
                <label
                  htmlFor={ids.description}
                  className="block text-sm font-medium text-gray-900"
                >
                  Request
                </label>
                <div className="rounded-lg bg-gray-100 transition-shadow focus-within:ring-2 focus-within:ring-gray-300/45">
                  <textarea
                    id={ids.description}
                    rows={5}
                    maxLength={20000}
                    placeholder="The question or request, as it came in"
                    value={description}
                    disabled={locked}
                    onChange={(event) =>
                      change(setDescription)(event.target.value)
                    }
                    className={cn(
                      INTAKE_TEXTAREA_CLASS,
                      "min-h-48 bg-transparent focus:border-transparent focus:ring-0",
                    )}
                  />
                </div>
              </section>
              <section className="space-y-2 px-5 py-4">
                <p
                  id={ids.documents}
                  className="text-sm font-medium text-gray-900"
                >
                  Documents
                </p>
                <IntakeDocumentDropZone
                  files={files}
                  labelledBy={ids.documents}
                  disabled={locked}
                  onAdd={(added) => change(setFiles)([...files, ...added])}
                  onRemove={(index) =>
                    change(setFiles)(files.filter((_, i) => i !== index))
                  }
                  picked={picked}
                  onBrowse={() => setPicking(true)}
                  onRemovePicked={(id) =>
                    change(setPicked)(picked.filter((d) => d.id !== id))
                  }
                />
                <IntakeDocumentPicker
                  open={picking}
                  onClose={() => setPicking(false)}
                  onPick={(chosen) =>
                    change(setPicked)([
                      ...picked,
                      ...chosen.filter(
                        (c) => !picked.some((p) => p.id === c.id),
                      ),
                    ])
                  }
                />
              </section>
            </div>
          </GlassCardUI>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {operation.uncertain && (
              <p role="status" className="mr-auto text-xs text-gray-500">
                Checking whether it was saved.
              </p>
            )}
            {operation.uncertain ? (
              <button
                type="button"
                disabled={operation.busy}
                onClick={() => void operation.execute()}
                className="rounded-md px-2 text-sm text-gray-500 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:text-gray-300"
              >
                Check again
              </button>
            ) : (
              <button
                type="button"
                disabled={locked}
                onClick={close}
                className="rounded-md px-2 text-sm text-gray-500 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:text-gray-300"
              >
                Cancel
              </button>
            )}
            <PillButtonUI
              tone="blue"
              size="sm"
              type="submit"
              disabled={!complete || locked}
              loading={operation.busy || addingDocuments}
            >
              {operation.busy || addingDocuments
                ? savingLabel
                : "Create request"}
            </PillButtonUI>
          </div>
        </DetailColumns>
      </form>
      {draftGuard.discardPopup}
    </div>
  );
}
