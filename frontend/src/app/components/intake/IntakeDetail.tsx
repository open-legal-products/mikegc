"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useIntakeMemory, useIntakeDraft } from "./useIntakeMemory";
import type {
  IntakeAction,
  IntakeCommand,
  IntakeDocument,
  IntakeEvent,
  IntakeMember,
  IntakeMessage,
  IntakeRequest,
} from "@mike/contracts";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { useItemWorkspace } from "@/app/hooks/useItemWorkspace";
import {
  commandIntakeRequest,
  getIntakeDocuments,
  getIntakeEvents,
  getIntakeMembers,
  getIntakeMessages,
  getIntakeRequest,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { notifySuccess } from "@/shared/lib/errorNotifier";
import { PageHeader } from "@/app/components/shared/PageHeader";
import {
  SkeletonLine,
  TableEmptyState,
} from "@/app/components/shared/TablePrimitive";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FieldLabel } from "@/app/components/ui/form-field";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { IntakeSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { TextSlabUI } from "@/shared/ui/TextSlabUI";
import {
  intakeError,
  useIntakeDraftWarning,
  useIntakeOperation,
} from "./useIntakeOperation";
import { IntakeDocuments } from "./IntakeDocuments";
import { IntakeReasonModal } from "./IntakeReasonModal";
import { IntakeRequestModal } from "./IntakeRequestModal";
import {
  INTAKE_CATEGORY_LABELS,
  INTAKE_MESSAGE_LABELS,
  INTAKE_STATE_LABELS,
  formatIntakeDate,
  formatIntakeDateTime,
  intakeMemberName,
  isIntakeOverdue,
} from "./intakeLabels";

/** Quiet refreshes when the window regains focus are at most this frequent. */
const FOCUS_REFRESH_MS = 30_000;

/** Scope a deep-linked request to its organization before mounting retained drafts. */
export function IntakeDetail({
  orgId,
  requestId,
}: {
  orgId: string;
  requestId: string;
}) {
  const { accountId, workspaceId } = useWorkspace();
  useItemWorkspace(requestId, orgId);
  if (!accountId || workspaceId !== orgId)
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <TableEmptyState>
          <EmptyState
            icon={<IntakeSkeuoIcon />}
            title="Intake"
            description="Open this request in its organization's workspace."
          />
        </TableEmptyState>
      </div>
    );
  return (
    <Detail
      key={`${accountId}:${orgId}:${requestId}`}
      orgId={orgId}
      requestId={requestId}
      accountId={accountId}
    />
  );
}
/** Read the complete note or event history using the API's 100-row pages. */
async function allPages<T>(read: (offset: number) => Promise<T[]>) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await read(offset);
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}
type Closing = "resolve" | "cancel";
/** Which retained draft a successful command has consumed. */
type Consumed = "note" | "reason" | null;
/** Show the current request and gate commands on its server-provided capabilities. */
export function Detail({
  orgId,
  requestId,
  accountId,
}: {
  orgId: string;
  requestId: string;
  accountId: string;
}) {
  const router = useRouter();
  const memory = useIntakeMemory(orgId, requestId);
  const [request, setRequest] = useState<IntakeRequest | null>(null);
  const [messages, setMessages] = useState<IntakeMessage[]>([]);
  const [events, setEvents] = useState<IntakeEvent[]>([]);
  const [documents, setDocuments] = useState<IntakeDocument[]>([]);
  const [members, setMembers] = useState<IntakeMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useIntakeDraft(memory, "note", "");
  const [reason, setReason] = useIntakeDraft(memory, "reason", "");
  const [closing, setClosing] = useIntakeDraft<Closing | null>(
    memory,
    "closing",
    null,
  );
  const [consumes, setConsumes] = useIntakeDraft<Consumed>(
    memory,
    "consumes",
    null,
  );
  const [editing, setEditing] = useState(false);
  const [assignee, setAssignee] = useState("");
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    try {
      const r = await getIntakeRequest(orgId, requestId);
      const [m, e, d, roster] = await Promise.all([
        allPages((offset) => getIntakeMessages(orgId, requestId, offset)),
        allPages((offset) => getIntakeEvents(orgId, requestId, offset)),
        getIntakeDocuments(orgId, requestId),
        r.capabilities.assign ? getIntakeMembers(orgId) : Promise.resolve([]),
      ]);
      if (generation !== epoch.current) return;
      setRequest(r);
      setMessages(m);
      setEvents(e);
      setDocuments(d);
      setMembers(roster);
      setAssignee(r.assignee_id ?? "");
      setError(null);
    } catch (e) {
      if (generation === epoch.current) {
        setRequest(null);
        setMessages([]);
        setEvents([]);
        setDocuments([]);
        setMembers([]);
        setError(intakeError(e, "load the request"));
      }
    }
  }, [orgId, requestId]);
  const invalidate = useCallback(() => {
    epoch.current++;
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh sets state only after its first request resolves
    void refresh();
    return invalidate;
  }, [refresh, invalidate]);
  // Coming back to the window refreshes in place: the request stays on
  // screen and drafts are untouched.
  const lastFocusRefresh = useRef(0);
  useEffect(() => {
    const focus = () => {
      if (Date.now() - lastFocusRefresh.current < FOCUS_REFRESH_MS) return;
      lastFocusRefresh.current = Date.now();
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  const operation = useIntakeOperation(
    () => {
      if (consumes === "note") setNote("");
      if (consumes === "reason") {
        setReason("");
        setClosing(null);
      }
      setConsumes(null);
      void refresh();
    },
    (rejection) => {
      const status =
        rejection && typeof rejection === "object" && "status" in rejection
          ? Number(rejection.status)
          : 0;
      // Hide what this account may no longer read until the reload decides.
      // Other failures refresh in place, keeping any open dialog and draft.
      if ([401, 403, 404].includes(status)) {
        setRequest(null);
        setMessages([]);
        setEvents([]);
        setDocuments([]);
        setMembers([]);
      }
      void refresh();
    },
    memory,
  );
  useIntakeDraftWarning(!!note || !!reason || operation.locked);
  /** Capture the displayed request version; recovery reuses the same command. */
  function command(
    action: IntakeAction,
    label: string,
    fields: Pick<IntakeCommand, "body" | "assignee_id"> = {},
    consumed: Consumed = null,
  ) {
    if (!request) return;
    const input: IntakeCommand = {
      command_id: crypto.randomUUID(),
      // Notes leave the request unchanged, so they carry no version.
      ...(action === "notes" ? {} : { expected_version: request.version }),
      ...fields,
    };
    setConsumes(consumed);
    void operation.execute(async () => {
      const receipt = await commandIntakeRequest(
        orgId,
        requestId,
        action,
        input,
      );
      if (receipt.request_id !== requestId)
        throw new Error("Mismatched intake receipt");
      return receipt;
    }, label);
  }
  const caps = request?.capabilities;
  const pinned = request
    ? [...messages]
        .reverse()
        .find((m) =>
          request.state === "resolved"
            ? m.kind === "resolution"
            : request.state === "cancelled" && m.kind === "cancel_reason",
        )
    : undefined;
  const memberOptions = [
    { value: "", label: "Unassigned" },
    ...members.map((m) => ({
      value: m.user_id,
      label: m.user_id === accountId ? `${intakeMemberName(m)} (you)` : intakeMemberName(m),
    })),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        shrink
        breadcrumbs={[
          {
            label: "Intake",
            onClick: () => router.push("/intake"),
            title: "Back to Intake",
          },
          {
            label: request?.subject,
            loading: !request && !error,
            cursor: "text",
          },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-3 pb-6 md:mx-6.5 [overflow-wrap:anywhere]">
          {error ? (
            <TableEmptyState>
              <EmptyState
                tone="error"
                title="Unable to load request"
                description={<span role="alert">{error}</span>}
                action={
                  <PillButtonUI
                    tone="black"
                    size="sm"
                    onClick={() => void refresh()}
                  >
                    Try again
                  </PillButtonUI>
                }
              />
            </TableEmptyState>
          ) : !request || !caps ? (
            <DetailSkeleton />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0 space-y-4">
                <GlassCardUI>
                  <div className="space-y-3 p-5">
                    <h1 className="font-serif text-2xl text-gray-900">
                      {request.subject}
                    </h1>
                    <p className="text-xs text-gray-500">
                      Recorded by {request.created_by_name} ·{" "}
                      {formatIntakeDateTime(request.created_at)}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                      {request.description}
                    </p>
                  </div>
                </GlassCardUI>

                {pinned && (
                  <GlassCardUI>
                    <section
                      aria-labelledby="intake-outcome"
                      className="space-y-3 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2
                          id="intake-outcome"
                          className="text-sm font-medium text-gray-900"
                        >
                          {request.state === "resolved"
                            ? "Resolution"
                            : "Cancellation reason"}
                        </h2>
                        <PillButtonUI
                          tone="white"
                          size="sm"
                          onClick={() =>
                            navigator.clipboard.writeText(pinned.body).then(
                              () => notifySuccess("Copied"),
                              (e) => notifyError(e, { action: "copy the text" }),
                            )
                          }
                        >
                          Copy
                        </PillButtonUI>
                      </div>
                      <TextSlabUI className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                        {pinned.body}
                      </TextSlabUI>
                      <p className="text-xs text-gray-500">
                        {pinned.author_name} ·{" "}
                        {formatIntakeDateTime(pinned.created_at)}
                      </p>
                    </section>
                  </GlassCardUI>
                )}

                <IntakeDocuments
                  orgId={orgId}
                  requestId={requestId}
                  documents={documents}
                  onChanged={() => void refresh()}
                />

                <section aria-labelledby="intake-activity" className="space-y-2">
                  <h2
                    id="intake-activity"
                    className="text-sm font-medium text-gray-900"
                  >
                    Notes
                  </h2>
                  {messages.length === 0 ? (
                    <p className="text-sm text-gray-500">No notes yet.</p>
                  ) : (
                    messages.map((m) => (
                      <GlassCardUI key={m.id}>
                        <div className="space-y-2 p-4">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                            <UserAvatar size="sm" name={m.author_name} />
                            <span className="font-medium text-gray-700">
                              {m.author_name}
                            </span>
                            <span>{INTAKE_MESSAGE_LABELS[m.kind]}</span>
                            <time dateTime={m.created_at}>
                              {formatIntakeDateTime(m.created_at)}
                            </time>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                            {m.body}
                          </p>
                        </div>
                      </GlassCardUI>
                    ))
                  )}
                </section>

                {caps.note && (
                  <GlassCardUI>
                    <div className="space-y-3 p-4">
                      <FieldLabel htmlFor="intake-note">Add a note</FieldLabel>
                      <ModalTextarea
                        id="intake-note"
                        className="min-h-24"
                        maxLength={20000}
                        placeholder="What happened, what the requester said, what was sent"
                        value={note}
                        disabled={operation.locked}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-gray-500">
                          Notes are visible to everyone in your organization.
                        </p>
                        <PillButtonUI
                          tone="black"
                          size="sm"
                          disabled={!note.trim() || operation.locked}
                          onClick={() =>
                            command("notes", "add the note", { body: note }, "note")
                          }
                        >
                          Add note
                        </PillButtonUI>
                      </div>
                    </div>
                  </GlassCardUI>
                )}
              </div>

              <aside className="min-w-0 space-y-4" aria-label="Request details">
                <GlassCardUI>
                  <dl>
                    <DetailRow label="Status">
                      {INTAKE_STATE_LABELS[request.state]}
                    </DetailRow>
                    <DetailRow label="Type">
                      {INTAKE_CATEGORY_LABELS[request.category]}
                    </DetailRow>
                    <DetailRow label="Requester">
                      <span className="block">{request.requester_name}</span>
                      {request.requester_email && (
                        <span className="block text-xs text-gray-500">
                          {request.requester_email}
                        </span>
                      )}
                      {request.requester_team && (
                        <span className="block text-xs text-gray-500">
                          {request.requester_team}
                        </span>
                      )}
                    </DetailRow>
                    <DetailRow
                      label={
                        caps.assign ? (
                          <label htmlFor="intake-assignee">Assigned lawyer</label>
                        ) : (
                          "Assigned lawyer"
                        )
                      }
                    >
                      {caps.assign ? (
                        <div className="space-y-2">
                          <ModalSelect
                            id="intake-assignee"
                            variant="flat"
                            value={assignee}
                            placeholder="Unassigned"
                            disabled={operation.locked}
                            options={memberOptions}
                            onChange={setAssignee}
                          />
                          <div className="flex flex-wrap gap-2">
                            {assignee !== (request.assignee_id ?? "") && (
                              <PillButtonUI
                                tone="black"
                                size="sm"
                                disabled={operation.locked}
                                onClick={() =>
                                  command("assignment", "assign the request", {
                                    assignee_id: assignee || null,
                                  })
                                }
                              >
                                Save assignment
                              </PillButtonUI>
                            )}
                            {request.assignee_id !== accountId &&
                              assignee === (request.assignee_id ?? "") && (
                                <PillButtonUI
                                  tone="white"
                                  size="sm"
                                  disabled={operation.locked}
                                  onClick={() =>
                                    command("assignment", "assign the request", {
                                      assignee_id: accountId,
                                    })
                                  }
                                >
                                  Assign to me
                                </PillButtonUI>
                              )}
                          </div>
                        </div>
                      ) : (
                        (request.assignee_name ?? (
                          <span className="text-gray-400">Unassigned</span>
                        ))
                      )}
                    </DetailRow>
                    {request.requested_by_date && (
                      <DetailRow label="Target date">
                        <span className="block">
                          {formatIntakeDate(request.requested_by_date)}
                        </span>
                        {isIntakeOverdue(request) && (
                          <span className="block text-xs text-red-600">
                            Overdue
                          </span>
                        )}
                        {request.timezone && (
                          <span className="block text-xs text-gray-500">
                            {request.timezone} · not a legal deadline
                          </span>
                        )}
                      </DetailRow>
                    )}
                    <DetailRow label="Updated">
                      {formatIntakeDateTime(request.updated_at)}
                    </DetailRow>
                  </dl>
                  {(caps.edit ||
                    caps.wait ||
                    caps.resume ||
                    caps.resolve ||
                    caps.cancel ||
                    caps.reopen) && (
                    <div className="flex flex-wrap gap-2 border-t border-gray-100 p-4">
                      {caps.resolve && (
                        <PillButtonUI
                          tone="black"
                          size="sm"
                          disabled={operation.locked}
                          onClick={() => setClosing("resolve")}
                        >
                          Resolve
                        </PillButtonUI>
                      )}
                      {caps.wait && (
                        <PillButtonUI
                          tone="white"
                          size="sm"
                          disabled={operation.locked}
                          onClick={() =>
                            command("wait", "mark the request as waiting")
                          }
                        >
                          Mark waiting on requester
                        </PillButtonUI>
                      )}
                      {caps.resume && (
                        <PillButtonUI
                          tone="white"
                          size="sm"
                          disabled={operation.locked}
                          onClick={() => command("resume", "resume the request")}
                        >
                          Resume
                        </PillButtonUI>
                      )}
                      {caps.reopen && (
                        <PillButtonUI
                          tone="white"
                          size="sm"
                          disabled={operation.locked}
                          onClick={() => command("reopen", "reopen the request")}
                        >
                          Reopen
                        </PillButtonUI>
                      )}
                      {caps.edit && (
                        <PillButtonUI
                          tone="white"
                          size="sm"
                          disabled={operation.locked}
                          onClick={() => setEditing(true)}
                        >
                          Edit details
                        </PillButtonUI>
                      )}
                      {caps.cancel && (
                        <PillButtonUI
                          tone="danger"
                          size="sm"
                          disabled={operation.locked}
                          onClick={() => setClosing("cancel")}
                        >
                          Cancel request
                        </PillButtonUI>
                      )}
                    </div>
                  )}
                </GlassCardUI>

                {events.length > 0 && (
                  <section aria-labelledby="intake-history" className="space-y-2">
                    <h2
                      id="intake-history"
                      className="text-sm font-medium text-gray-900"
                    >
                      History
                    </h2>
                    <GlassCardUI>
                      <ol>
                        {events.map((e) => (
                          <li
                            key={e.id}
                            className="border-t border-gray-100 px-4 py-2.5 first:border-t-0"
                          >
                            <p className="text-sm text-gray-700">
                              {describeEvent(e)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {e.actor_name ?? "Automatically"} ·{" "}
                              <time dateTime={e.created_at}>
                                {formatIntakeDateTime(e.created_at)}
                              </time>
                            </p>
                          </li>
                        ))}
                      </ol>
                    </GlassCardUI>
                  </section>
                )}
              </aside>
            </div>
          )}
          {operation.uncertain && !closing && (
            <div
              className="mt-4 flex flex-wrap items-center gap-3"
              role="status"
            >
              <span className="text-sm text-gray-500">
                Checking whether it was saved. Your text is kept here.
              </span>
              <PillButtonUI
                tone="white"
                size="sm"
                disabled={operation.busy}
                onClick={() => void operation.execute()}
              >
                Check again
              </PillButtonUI>
            </div>
          )}
        </div>
      </div>
      {closing && request && (
        <IntakeReasonModal
          title={closing === "resolve" ? "Resolve request" : "Cancel request"}
          label={
            closing === "resolve"
              ? "Resolution"
              : "Why is this being cancelled?"
          }
          hint={
            closing === "resolve"
              ? "Record the advice given or the outcome. It is pinned to the request."
              : "The reason is recorded on the request. Anyone can reopen it later."
          }
          confirmLabel={closing === "resolve" ? "Resolve" : "Cancel request"}
          confirmVariant={closing === "resolve" ? "primary" : "danger"}
          value={reason}
          onChange={setReason}
          busy={operation.busy}
          locked={operation.locked}
          status={
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
          onConfirm={() =>
            command(
              closing,
              closing === "resolve" ? "resolve the request" : "cancel the request",
              { body: reason },
              "reason",
            )
          }
          onClose={() => setClosing(null)}
        />
      )}
      {editing && request && (
        <IntakeRequestModal
          mode="edit"
          orgId={orgId}
          requestId={request.id}
          version={request.version}
          initial={request}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** One line of history; automatic changes name who left rather than an actor. */
function describeEvent(e: IntakeEvent): string {
  switch (e.kind) {
    case "submitted":
      return e.assignee_name
        ? `Recorded and assigned to ${e.assignee_name}`
        : "Recorded";
    case "assign":
      return e.assignee_name ? `Assigned to ${e.assignee_name}` : "Unassigned";
    case "wait":
      return "Marked waiting on requester";
    case "resume":
      return "Resumed";
    case "resolve":
      return "Resolved";
    case "cancel":
      return "Cancelled";
    case "reopen":
      return "Reopened";
    case "edited":
      return "Details edited";
    case "document_added":
      return "Document added";
    case "assignee_left":
      return `Unassigned because ${e.assignee_name ?? "the assigned lawyer"} left the organization`;
    // Events recorded before intake became an internal tracker.
    case "ask":
      return "Asked for information";
    case "reply":
      return "Requester replied";
    case "publish":
      return "Answered and resolved";
    case "reviewer_removed":
      return "Unassigned when the lawyer left the Legal team";
    default:
      return e.kind.replaceAll("_", " ");
  }
}

function DetailRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1 border-t border-gray-100 px-4 py-3 first:border-t-0">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading request…
      </span>
      <div
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"
        aria-hidden="true"
      >
        <GlassCardUI>
          <div className="space-y-3 p-5">
            <SkeletonLine className="h-5 w-64" />
            <SkeletonLine className="w-32" />
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-5/6" />
          </div>
        </GlassCardUI>
        <GlassCardUI>
          {["w-20", "w-24", "w-28", "w-24", "w-20"].map((width, row) => (
            <div
              key={row}
              className="space-y-2 border-t border-gray-100 px-4 py-3 first:border-t-0"
            >
              <SkeletonLine className="w-16" />
              <SkeletonLine className={width} />
            </div>
          ))}
          <div className="flex gap-2 border-t border-gray-100 p-4">
            <SkeletonLine className="h-7 w-20" />
            <SkeletonLine className="h-7 w-24" />
          </div>
        </GlassCardUI>
      </div>
    </>
  );
}
