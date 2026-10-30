"use client";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  IntakeMember,
  IntakeRequestSummary,
  IntakeCategory,
  IntakeState,
} from "@mike/contracts";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { notifyPartialFailure, notifyError } from "@/app/lib/userFacingError";
import { notifySuccess } from "@/shared/lib/errorNotifier";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import {
  commandIntakeRequest,
  getIntakeMembers,
  listIntakeRequests,
  type IntakeListQuery,
} from "@/app/lib/mikeApi";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { PAGE_HEADER_TITLE_CLASS } from "@/app/components/shared/pageHeaderStyles";
import { TableToolbar } from "@/app/components/shared/TableToolbar";
import {
  PersonFilter,
  localPeople,
  type PersonOption,
} from "@/app/components/shared/PersonFilter";
import { TableLoadMoreRow } from "@/app/components/shared/TableLoadMoreRow";
import { RowActions } from "@/app/components/shared/RowActions";
import { SelectionActionsMenu } from "@/app/components/shared/SelectionActionsMenu";
import {
  rowActionSelectionIds,
  SkeletonCheckbox,
  SkeletonLine,
  TABLE_CHECKBOX_CLASS,
  TableBody,
  TableCell,
  TableEmptyState,
  TableFilters,
  TableHeaderCell,
  TableHeaderRow,
  TablePrimaryCell,
  TableRow,
  TableScrollArea,
  TableStickyCell,
} from "@/app/components/shared/TablePrimitive";
import { IntakeSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { formatDate } from "@/app/components/projects/ProjectPageParts";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { DropdownItem, DropdownSeparator } from "@/shared/ui/dropdown";
import { IntakeRequestModal } from "./IntakeRequestModal";
import { IntakeReasonModal } from "./IntakeReasonModal";
import { useIntakeDraft, useIntakeMemory } from "./useIntakeMemory";
import { intakeError } from "./useIntakeOperation";
import {
  INTAKE_CATEGORY_LABELS,
  INTAKE_STATE_LABELS,
  formatIntakeDate,
  isIntakeOverdue,
} from "./intakeLabels";

type IntakeView = "all" | "mine";

const VIEWS: { id: IntakeView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Assigned to me" },
];

const STATE_OPTIONS = (Object.keys(INTAKE_STATE_LABELS) as IntakeState[]).map(
  (value) => ({ value, label: INTAKE_STATE_LABELS[value] }),
);
const CATEGORY_OPTIONS = (["nda", "general"] as IntakeCategory[]).map(
  (value) => ({ value, label: INTAKE_CATEGORY_LABELS[value] }),
);
/** Quiet refreshes when the window regains focus are at most this frequent. */
const FOCUS_REFRESH_MS = 30_000;

/** Mount the queue only for the signed-in account and its active organization. */
export function IntakeInbox() {
  const { accountId, activeOrganization } = useWorkspace();
  if (!accountId || !activeOrganization)
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <TableEmptyState>
          <EmptyState
            icon={<IntakeSkeuoIcon />}
            title="Intake"
            description="Switch to an organization workspace to track requests."
          />
        </TableEmptyState>
      </div>
    );
  return (
    <Inbox
      key={`${accountId}:${activeOrganization.id}`}
      orgId={activeOrganization.id}
      accountId={accountId}
    />
  );
}

type Page = {
  key: string;
  rows: IntakeRequestSummary[];
  next: string | null;
  /** How many pages are on screen; quiet refreshes only replace the first. */
  pages: number;
};

/** The Legal team's queue, with filters, keyset paging and row actions. */
export function Inbox({
  orgId,
  accountId,
}: {
  orgId: string;
  accountId: string;
}) {
  const router = useRouter();
  const memory = useIntakeMemory(orgId, "new-request");
  const [members, setMembers] = useState<IntakeMember[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [state, setState] = useState<IntakeState | null>(null);
  const [category, setCategory] = useState<IntakeCategory | null>(null);
  const [view, setView] = useState<IntakeView>("all");
  const [assignee, setAssignee] = useState<PersonOption | null>(null);
  const [sortByTarget, setSortByTarget] = useState(false);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useIntakeDraft(memory, "creating", false);
  const [cancelTargets, setCancelTargets] = useState<
    IntakeRequestSummary[] | null
  >(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const query = useMemo<IntakeListQuery>(
    () => ({
      search: debouncedSearch,
      state: state ?? undefined,
      category: category ?? undefined,
      assignee: view === "mine" ? "me" : assignee?.user_id,
      sort: sortByTarget ? "target" : "updated",
    }),
    [debouncedSearch, state, category, view, assignee, sortByTarget],
  );
  // Rows, errors and selection are stored against the query that produced
  // them, so a change shows the loading state at once and a late response
  // for an earlier query is never drawn.
  const queryKey = JSON.stringify(query);
  const [page, setPage] = useState<Page | null>(null);
  const [listError, setListError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const rows = page?.key === queryKey ? page.rows : null;
  const error = listError?.key === queryKey ? listError.message : null;
  const [selection, setSelection] = useState({
    key: queryKey,
    ids: [] as string[],
  });
  const selectedIds = selection.key === queryKey ? selection.ids : [];
  const setSelectedIds = (update: (ids: string[]) => string[]) =>
    setSelection((current) => ({
      key: queryKey,
      ids: update(current.key === queryKey ? current.ids : []),
    }));
  const allSelected =
    !!rows && rows.length > 0 && rows.every((r) => selectedIds.includes(r.id));

  useEffect(() => {
    let active = true;
    getIntakeMembers(orgId)
      .then((m) => {
        if (active) setMembers(m);
      })
      .catch(() => {
        // The queue still works without names: the lawyer filter falls back
        // to Unassigned and Assigned to me, and a failed list shows its own error.
        if (active) setMembers([]);
      });
    return () => {
      active = false;
    };
  }, [orgId, reload]);

  useEffect(() => {
    let active = true;
    // `reload` refetches the first page in place: the rows on screen stay
    // until the fresh ones arrive.
    listIntakeRequests(orgId, JSON.parse(queryKey) as IntakeListQuery)
      .then((result) => {
        if (!active) return;
        setPage({
          key: queryKey,
          rows: result.requests,
          next: result.next_cursor,
          pages: 1,
        });
        setListError(null);
        setLoadMoreError(false);
      })
      .catch((e) => {
        if (active) setListError({ key: queryKey, message: intakeError(e) });
      });
    return () => {
      active = false;
    };
  }, [orgId, queryKey, reload]);

  const refresh = useCallback(() => setReload((x) => x + 1), []);
  // Coming back to the window refreshes quietly, but never drops rows the
  // user scrolled to: with several pages loaded it waits for an explicit action.
  const lastFocusRefresh = useRef(0);
  const pagesOnScreen = page?.key === queryKey ? page.pages : 0;
  useEffect(() => {
    const focus = () => {
      if (pagesOnScreen > 1) return;
      if (Date.now() - lastFocusRefresh.current < FOCUS_REFRESH_MS) return;
      lastFocusRefresh.current = Date.now();
      refresh();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh, pagesOnScreen]);

  async function loadMore() {
    if (!page || page.key !== queryKey || !page.next || loadingMore) return;
    const key = queryKey;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const result = await listIntakeRequests(orgId, {
        ...query,
        cursor: page.next,
      });
      setPage((current) => {
        if (current?.key !== key) return current;
        const seen = new Set(current.rows.map((r) => r.id));
        return {
          key,
          rows: [
            ...current.rows,
            ...result.requests.filter((r) => !seen.has(r.id)),
          ],
          next: result.next_cursor,
          pages: current.pages + 1,
        };
      });
    } catch {
      // The load-more row shows the failure and offers a retry.
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered =
    !!debouncedSearch ||
    !!state ||
    !!category ||
    view === "mine" ||
    !!assignee;
  const failure = error;
  const hrefFor = (request: IntakeRequestSummary) =>
    `/intake/${request.id}?org=${orgId}`;
  const people: PersonOption[] = members.map((m) => ({
    ...m,
    profile_photo: null,
  }));

  async function assignToMe(request: IntakeRequestSummary) {
    try {
      await commandIntakeRequest(orgId, request.id, "assignment", {
        command_id: crypto.randomUUID(),
        expected_version: request.version,
        assignee_id: accountId,
      });
      notifySuccess("Assigned to you");
    } catch (e) {
      notifyError(e, { action: "assign the request" });
    }
    refresh();
  }

  function renderActions(
    request: IntakeRequestSummary | undefined,
    close: () => void,
  ) {
    const ids = request
      ? rowActionSelectionIds(request.id, selectedIds)
      : selectedIds;
    const targets = (rows ?? []).filter((r) => ids.includes(r.id));
    const cancellable = targets.filter((r) => r.capabilities.cancel);
    const single = targets.length === 1 ? targets[0] : null;
    return (
      <>
        {single && (
          <DropdownItem
            onSelect={() => {
              close();
              router.push(hrefFor(single));
            }}
          >
            Open
          </DropdownItem>
        )}
        {single?.capabilities.assign && single.assignee_id !== accountId && (
          <DropdownItem
            onSelect={() => {
              close();
              void assignToMe(single);
            }}
          >
            Assign to me
          </DropdownItem>
        )}
        <DropdownItem
          onSelect={() => {
            close();
            const links = targets
              .map((r) => new URL(hrefFor(r), window.location.origin).href)
              .join("\n");
            navigator.clipboard.writeText(links).then(
              () =>
                notifySuccess(
                  targets.length === 1 ? "Link copied" : "Links copied",
                ),
              (e) => notifyError(e, { action: "copy the link" }),
            );
          }}
        >
          {targets.length > 1 ? `Copy ${targets.length} links` : "Copy link"}
        </DropdownItem>
        {cancellable.length > 0 && (
          <>
            <DropdownSeparator />
            <DropdownItem
              variant="destructive"
              onSelect={() => {
                close();
                setCancelReason("");
                setCancelTargets(cancellable);
              }}
            >
              {cancellable.length > 1
                ? `Cancel ${cancellable.length} requests`
                : "Cancel request"}
            </DropdownItem>
          </>
        )}
      </>
    );
  }

  async function cancelRequests(targets: IntakeRequestSummary[]) {
    setCancelling(true);
    const failed: IntakeRequestSummary[] = [];
    let lastError: unknown = null;
    for (const request of targets) {
      try {
        await commandIntakeRequest(orgId, request.id, "cancel", {
          command_id: crypto.randomUUID(),
          expected_version: request.version,
          body: cancelReason,
        });
      } catch (e) {
        failed.push(request);
        lastError = e;
      }
    }
    setCancelling(false);
    setCancelTargets(null);
    setSelectedIds(() => []);
    refresh();
    if (failed.length === targets.length && lastError)
      notifyError(lastError, {
        action:
          targets.length === 1 ? "cancel the request" : "cancel the requests",
      });
    else if (failed.length > 0)
      notifyPartialFailure(
        `${failed.length} of ${targets.length} requests couldn't be cancelled. They may have changed; reload and try again.`,
        { action: "cancel the requests" },
      );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        actions={[
          {
            type: "search",
            value: search,
            onChange: setSearch,
            placeholder: "Search requests or requesters…",
          },
          {
            type: "new",
            onClick: () => setCreating(true),
            title: "New request",
          },
        ]}
      >
        <h1 className={`${PAGE_HEADER_TITLE_CLASS} text-gray-900`}>Intake</h1>
      </PageHeader>

      <TableToolbar
        items={VIEWS}
        active={view}
        onChange={setView}
        actions={
          selectedIds.length > 0 ? (
            <SelectionActionsMenu
              renderItems={(close) => renderActions(undefined, close)}
            />
          ) : undefined
        }
      />

      <TableScrollArea
        onScroll={(event) => {
          const element = event.currentTarget;
          if (
            element.scrollHeight - element.scrollTop - element.clientHeight <
            200
          )
            void loadMore();
        }}
        header={
          <TableHeaderRow>
            <TableStickyCell header>
              {rows === null ? (
                <SkeletonCheckbox />
              ) : (
                <input
                  type="checkbox"
                  className={TABLE_CHECKBOX_CLASS}
                  aria-label="Select all requests"
                  checked={allSelected}
                  disabled={!rows.length}
                  ref={(input) => {
                    if (input)
                      input.indeterminate =
                        selectedIds.length > 0 && !allSelected;
                  }}
                  onChange={() =>
                    setSelectedIds(() =>
                      allSelected ? [] : rows.map((r) => r.id),
                    )
                  }
                />
              )}
              <span>Request</span>
            </TableStickyCell>
            <TableHeaderCell className="ml-auto w-44">
              Requester
            </TableHeaderCell>
            <TableHeaderCell className="w-32">
              <div className="flex items-center gap-1">
                <span>Type</span>
                <TableFilters
                  label="Filter by type"
                  value={category}
                  allLabel="All types"
                  options={CATEGORY_OPTIONS}
                  onChange={setCategory}
                />
              </div>
            </TableHeaderCell>
            <TableHeaderCell className="w-44">
              <div className="flex items-center gap-1">
                <span>Status</span>
                <TableFilters
                  label="Filter by status"
                  value={state}
                  allLabel="All statuses"
                  options={STATE_OPTIONS}
                  onChange={setState}
                />
              </div>
            </TableHeaderCell>
            <TableHeaderCell className="w-44">
              <div className="flex items-center gap-1">
                <span>Assigned lawyer</span>
                {view === "all" && (
                  <PersonFilter
                    label="Filter by assigned lawyer"
                    selectedTitle={(name) => `Assigned to ${name}`}
                    value={assignee}
                    onChange={setAssignee}
                    loadPeople={localPeople(people)}
                  />
                )}
              </div>
            </TableHeaderCell>
            <TableHeaderCell className="w-32">
              <div className="flex items-center gap-1">
                <span>Target date</span>
                <TableFilters
                  label="Sort by target date"
                  value={sortByTarget ? "target" : null}
                  allLabel="Recently updated first"
                  options={[{ value: "target", label: "Soonest target first" }]}
                  onChange={(value) => setSortByTarget(value === "target")}
                />
              </div>
            </TableHeaderCell>
            <TableHeaderCell className="w-28">Updated</TableHeaderCell>
            <TableHeaderCell className="w-8" />
          </TableHeaderRow>
        }
      >
        {failure ? (
          <TableEmptyState>
            <EmptyState
              tone="error"
              title="Unable to load requests"
              description={<span role="alert">{failure}</span>}
              action={
                <PillButtonUI
                  tone="black"
                  size="sm"
                  onClick={() => {
                    setListError(null);
                    refresh();
                  }}
                >
                  Try again
                </PillButtonUI>
              }
            />
          </TableEmptyState>
        ) : rows === null ? (
          <IntakeLoadingRows />
        ) : rows.length === 0 ? (
          <TableEmptyState>
            {filtered ? (
              <p className="text-sm text-gray-400">No requests found</p>
            ) : (
              <EmptyState
                icon={<IntakeSkeuoIcon />}
                title="No requests yet"
                description="Record an NDA request or legal question from the business to start tracking it."
                action={
                  <PillButtonUI
                    tone="black"
                    size="sm"
                    onClick={() => setCreating(true)}
                  >
                    Record a request
                  </PillButtonUI>
                }
              />
            )}
          </TableEmptyState>
        ) : (
          <TableBody>
            {rows.map((request) => {
              const href = hrefFor(request);
              const selected = selectedIds.includes(request.id);
              const overdue = isIntakeOverdue(request);
              return (
                <TableRow
                  key={request.id}
                  selected={selected}
                  rightClickDropdown={(close) => renderActions(request, close)}
                  onClick={() => router.push(href)}
                >
                  <TablePrimaryCell
                    selected={selected}
                    checkboxTitle={`Select ${request.subject}`}
                    onSelectionChange={() =>
                      setSelectedIds((ids) =>
                        ids.includes(request.id)
                          ? ids.filter((id) => id !== request.id)
                          : [...ids, request.id],
                      )
                    }
                    label={
                      <Link
                        href={href}
                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                        title={request.subject}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {request.subject}
                      </Link>
                    }
                  />
                  <TableCell className="ml-auto w-44 [overflow-wrap:anywhere]">
                    {request.requester_name}
                  </TableCell>
                  <TableCell className="w-32">
                    {INTAKE_CATEGORY_LABELS[request.category]}
                  </TableCell>
                  <TableCell className="w-44">
                    {INTAKE_STATE_LABELS[request.state]}
                  </TableCell>
                  <TableCell className="w-44 [overflow-wrap:anywhere]">
                    {request.assignee_name ?? (
                      <span className="text-gray-400">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="w-32">
                    {request.requested_by_date ? (
                      <span
                        className={`inline-flex items-center gap-1 whitespace-nowrap ${overdue ? "text-red-600" : ""}`}
                        title={overdue ? "Target date passed" : undefined}
                      >
                        {formatIntakeDate(request.requested_by_date)}
                        {overdue && (
                          <AlertCircle
                            className="h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        {overdue && <span className="sr-only">, overdue</span>}
                      </span>
                    ) : (
                      <span className="text-gray-400">None</span>
                    )}
                  </TableCell>
                  <TableCell className="w-28">
                    {formatDate(request.updated_at)}
                  </TableCell>
                  <div
                    className="flex w-8 shrink-0 justify-end"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <RowActions
                      ariaLabel={`Actions for ${request.subject}`}
                      renderItems={(close) => renderActions(request, close)}
                    />
                  </div>
                </TableRow>
              );
            })}
          </TableBody>
        )}
        <TableLoadMoreRow
          loading={rows === null}
          hasMore={!failure && !!rows && !!page?.next}
          itemCount={rows?.length ?? 0}
          loadingMore={loadingMore}
          hasError={loadMoreError}
          onLoadMore={() => void loadMore()}
        />
      </TableScrollArea>

      {cancelTargets && (
        <IntakeReasonModal
          title={
            cancelTargets.length > 1
              ? `Cancel ${cancelTargets.length} requests`
              : "Cancel request"
          }
          label="Why is this being cancelled?"
          hint="The reason is recorded on each request, which then becomes read-only until someone reopens it."
          confirmLabel={
            cancelTargets.length > 1 ? "Cancel requests" : "Cancel request"
          }
          confirmVariant="danger"
          value={cancelReason}
          onChange={setCancelReason}
          busy={cancelling}
          locked={cancelling}
          onConfirm={() => void cancelRequests(cancelTargets)}
          onClose={() => setCancelTargets(null)}
        />
      )}
      {creating && (
        <IntakeRequestModal
          mode="create"
          orgId={orgId}
          onClose={() => setCreating(false)}
          onSaved={(id) => router.push(`/intake/${id}?org=${orgId}`)}
        />
      )}
    </div>
  );
}

function IntakeLoadingRows() {
  const widths = ["w-44", "w-36", "w-52", "w-40", "w-48"];
  return (
    <TableBody>
      <span role="status" className="sr-only">
        Loading requests…
      </span>
      {widths.map((width) => (
        <TableRow key={width} interactive={false}>
          <TableStickyCell hover={false}>
            <div className="flex min-w-0 items-center">
              <SkeletonCheckbox />
              <SkeletonLine className={`h-3.5 ${width}`} />
            </div>
          </TableStickyCell>
          <TableCell className="ml-auto w-44">
            <SkeletonLine className="w-24" />
          </TableCell>
          <TableCell className="w-32">
            <SkeletonLine className="w-20" />
          </TableCell>
          <TableCell className="w-44">
            <SkeletonLine className="w-16" />
          </TableCell>
          <TableCell className="w-44">
            <SkeletonLine className="w-24" />
          </TableCell>
          <TableCell className="w-32">
            <SkeletonLine className="w-20" />
          </TableCell>
          <TableCell className="w-28">
            <SkeletonLine className="w-16" />
          </TableCell>
          <TableCell className="w-8" />
        </TableRow>
      ))}
    </TableBody>
  );
}
