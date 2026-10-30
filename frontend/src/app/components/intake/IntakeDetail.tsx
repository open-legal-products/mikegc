"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { EmptyState } from "@/app/components/ui/empty-state";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { IntakeSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { RowActions } from "@/app/components/shared/RowActions";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from "@/shared/ui/dropdown";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { TextSlabUI } from "@/shared/ui/TextSlabUI";
import {
  intakeError,
  useIntakeDraftWarning,
  useIntakeOperation,
} from "./useIntakeOperation";
import { IntakeDocuments, useIntakeDocumentUpload } from "./IntakeDocuments";
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
  const upload = useIntakeDocumentUpload(
    orgId,
    requestId,
    () => void refresh(),
  );
  // Files dropped anywhere on the page are added to the request.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const pinned = request
    ? [...messages]
        .reverse()
        .find((m) =>
          request.state === "resolved"
            ? m.kind === "resolution"
            : request.state === "cancelled" && m.kind === "cancel_reason",
        )
    : undefined;
  // Notes and changes read as one story, oldest first.
  const timeline = [
    ...events.map((event) => ({
      key: `e${event.id}`,
      at: event.created_at,
      event,
    })),
    ...messages.map((message) => ({
      key: `m${message.id}`,
      at: message.created_at,
      message,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const assign = (assigneeId: string | null) =>
    command("assignment", "assign the request", { assignee_id: assigneeId });
  const others = members.filter(
    (m) => m.user_id !== accountId && m.user_id !== request?.assignee_id,
  );
  const hasMenu =
    !!caps && (caps.wait || caps.resume || caps.edit || caps.cancel);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        shrink
        actions={
          request && caps
            ? [
                (caps.resolve || caps.reopen) && {
                  type: "custom",
                  render: caps.resolve ? (
                    <PillButtonUI
                      tone="black"
                      size="sm"
                      disabled={operation.locked}
                      onClick={() => setClosing("resolve")}
                    >
                      Resolve
                    </PillButtonUI>
                  ) : caps.reopen ? (
                    <PillButtonUI
                      tone="black"
                      size="sm"
                      disabled={operation.locked}
                      onClick={() => command("reopen", "reopen the request")}
                    >
                      Reopen
                    </PillButtonUI>
                  ) : null,
                },
                hasMenu &&
                  !operation.locked && {
                    type: "custom",
                    render: (
                      <RowActions
                        ariaLabel="More actions"
                        renderItems={(close) => (
                          <>
                            {caps.wait && (
                              <DropdownItem
                                onSelect={() => {
                                  close();
                                  command(
                                    "wait",
                                    "mark the request as waiting",
                                  );
                                }}
                              >
                                Mark waiting on requester
                              </DropdownItem>
                            )}
                            {caps.resume && (
                              <DropdownItem
                                onSelect={() => {
                                  close();
                                  command("resume", "resume the request");
                                }}
                              >
                                Resume
                              </DropdownItem>
                            )}
                            {caps.edit && (
                              <DropdownItem
                                onSelect={() => {
                                  close();
                                  setEditing(true);
                                }}
                              >
                                Edit details
                              </DropdownItem>
                            )}
                            <DropdownItem
                              onSelect={() => {
                                close();
                                const link = new URL(
                                  `/intake/${requestId}?org=${orgId}`,
                                  window.location.origin,
                                ).href;
                                navigator.clipboard.writeText(link).then(
                                  () => notifySuccess("Link copied"),
                                  (e) =>
                                    notifyError(e, { action: "copy the link" }),
                                );
                              }}
                            >
                              Copy link
                            </DropdownItem>
                            {caps.cancel && (
                              <>
                                <DropdownSeparator />
                                <DropdownItem
                                  variant="destructive"
                                  onSelect={() => {
                                    close();
                                    setClosing("cancel");
                                  }}
                                >
                                  Cancel request
                                </DropdownItem>
                              </>
                            )}
                          </>
                        )}
                      />
                    ),
                  },
              ]
            : undefined
        }
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
      <div
        className="relative min-h-0 flex-1 overflow-y-auto"
        onDragEnter={(event) => {
          if (!request || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!request || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          if (!request) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void upload.add(Array.from(event.dataTransfer.files));
        }}
      >
        {dragging && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl bg-white/70 text-sm text-gray-700 ring-2 ring-inset ring-blue-500/40"
          >
            Drop documents to add them to this request
          </div>
        )}
        <div className="mx-auto w-full max-w-3xl px-3 pb-8 md:px-6.5 [overflow-wrap:anywhere]">
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
            <div className="space-y-6 pt-2">
              <section aria-label="Request summary" className="space-y-2">
                {/* The page header shows the subject; this names the page for assistive technology. */}
                <h1 className="sr-only">{request.subject}</h1>
                <ul className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-sm text-gray-600 [&>li:not(:last-child)]:after:ml-1.5 [&>li:not(:last-child)]:after:text-gray-400 [&>li:not(:last-child)]:after:content-['·']">
                  <li className="font-medium text-gray-900">
                    {request.requester_name}
                  </li>
                  {request.requester_team && <li>{request.requester_team}</li>}
                  {request.requester_email && (
                    <li>{request.requester_email}</li>
                  )}
                  <li>{INTAKE_CATEGORY_LABELS[request.category]}</li>
                  {request.requested_by_date && (
                    <li
                      title={
                        request.timezone
                          ? `${request.timezone} · not a legal deadline`
                          : "Not a legal deadline"
                      }
                      className={
                        isIntakeOverdue(request) ? "text-red-600" : undefined
                      }
                    >
                      Due {formatIntakeDate(request.requested_by_date)}
                      {isIntakeOverdue(request) && ", overdue"}
                    </li>
                  )}
                </ul>
                <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-gray-600">
                  <span className="font-medium text-gray-900">
                    {INTAKE_STATE_LABELS[request.state]}
                  </span>
                  <span aria-hidden="true" className="text-gray-400">
                    ·
                  </span>
                  {caps.assign ? (
                    <Dropdown>
                      <DropdownTrigger asChild>
                        <button
                          type="button"
                          disabled={operation.locked}
                          className="inline-flex items-center gap-1 rounded-md text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed"
                        >
                          {request.assignee_name
                            ? `Assigned to ${request.assignee_name}`
                            : "Unassigned"}
                          <ChevronDown aria-hidden="true" className="h-3 w-3" />
                        </button>
                      </DropdownTrigger>
                      <DropdownContent align="start" className="w-56">
                        {request.assignee_id !== accountId && (
                          <DropdownItem onSelect={() => assign(accountId)}>
                            Assign to me
                          </DropdownItem>
                        )}
                        {request.assignee_id && (
                          <DropdownItem onSelect={() => assign(null)}>
                            Unassign
                          </DropdownItem>
                        )}
                        {others.length > 0 && <DropdownSeparator />}
                        {others.map((m) => (
                          <DropdownItem
                            key={m.user_id}
                            onSelect={() => assign(m.user_id)}
                          >
                            {intakeMemberName(m)}
                          </DropdownItem>
                        ))}
                      </DropdownContent>
                    </Dropdown>
                  ) : (
                    <span>
                      {request.assignee_name
                        ? `Assigned to ${request.assignee_name}`
                        : "Unassigned"}
                    </span>
                  )}
                </div>
              </section>

              {pinned && (
                <section aria-labelledby="intake-outcome" className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2
                      id="intake-outcome"
                      className="text-sm font-medium text-gray-900"
                    >
                      {request.state === "resolved"
                        ? "Resolution"
                        : "Cancellation reason"}
                    </h2>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(pinned.body).then(
                          () => notifySuccess("Copied"),
                          (e) => notifyError(e, { action: "copy the text" }),
                        )
                      }
                      className="rounded-md text-xs text-gray-500 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    >
                      Copy
                    </button>
                  </div>
                  <TextSlabUI className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                    {pinned.body}
                  </TextSlabUI>
                  <p className="text-xs text-gray-500">
                    {pinned.author_name} ·{" "}
                    {formatIntakeDateTime(pinned.created_at)}
                  </p>
                </section>
              )}

              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {request.description}
              </p>

              <IntakeDocuments
                documents={documents}
                uploading={upload.uploading}
                warning={upload.warning}
                onAdd={(files) => void upload.add(files)}
              />

              <section aria-labelledby="intake-activity" className="space-y-3">
                <h2
                  id="intake-activity"
                  className="text-sm font-medium text-gray-900"
                >
                  Activity
                </h2>
                <ol className="space-y-3">
                  {timeline.map((entry) =>
                    "event" in entry ? (
                      <li
                        key={entry.key}
                        className="flex flex-wrap gap-x-1.5 text-xs text-gray-500"
                      >
                        <span className="text-gray-700">
                          {describeEvent(entry.event)}
                        </span>
                        <span>
                          {entry.event.actor_name ?? "Automatically"} ·{" "}
                          <time dateTime={entry.at}>
                            {formatIntakeDateTime(entry.at)}
                          </time>
                        </span>
                      </li>
                    ) : (
                      <li key={entry.key} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                          <UserAvatar
                            size="sm"
                            name={entry.message.author_name}
                          />
                          <span className="font-medium text-gray-700">
                            {entry.message.author_name}
                          </span>
                          <span>
                            {INTAKE_MESSAGE_LABELS[entry.message.kind]}
                          </span>
                          <time dateTime={entry.at}>
                            {formatIntakeDateTime(entry.at)}
                          </time>
                        </div>
                        <p className="whitespace-pre-wrap pl-7 text-sm leading-relaxed text-gray-700">
                          {entry.message.body}
                        </p>
                      </li>
                    ),
                  )}
                </ol>
                {caps.note && (
                  <div className="space-y-2 pt-1">
                    <label htmlFor="intake-note" className="sr-only">
                      Add a note
                    </label>
                    <ModalTextarea
                      id="intake-note"
                      className="min-h-20"
                      maxLength={20000}
                      placeholder="Add a note: what happened, what the requester said, what was sent"
                      value={note}
                      disabled={operation.locked}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-gray-500">
                        Visible to everyone in your organization.
                      </p>
                      <PillButtonUI
                        tone="black"
                        size="sm"
                        disabled={!note.trim() || operation.locked}
                        onClick={() =>
                          command(
                            "notes",
                            "add the note",
                            { body: note },
                            "note",
                          )
                        }
                      >
                        Add note
                      </PillButtonUI>
                    </div>
                  </div>
                )}
              </section>
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
              closing === "resolve"
                ? "resolve the request"
                : "cancel the request",
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

/** Matches the loaded page: header, facts, description, documents, activity. */
function DetailSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading request…
      </span>
      <div className="space-y-6 pt-2" aria-hidden="true">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <SkeletonLine className="h-6 w-72" />
            <SkeletonLine className="h-7 w-20" />
          </div>
          <SkeletonLine className="w-80" />
          <SkeletonLine className="w-48" />
        </div>
        <div className="space-y-2">
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-5/6" />
        </div>
        <div className="flex gap-1.5">
          <SkeletonLine className="w-20" />
          <SkeletonLine className="h-5 w-32" />
        </div>
        <div className="space-y-3">
          <SkeletonLine className="w-16" />
          <SkeletonLine className="w-64" />
          <SkeletonLine className="w-3/4" />
          <SkeletonLine className="h-20 w-full" />
        </div>
      </div>
    </>
  );
}
