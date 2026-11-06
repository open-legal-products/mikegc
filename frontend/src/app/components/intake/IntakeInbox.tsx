"use client";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { AlertCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  IntakeMember,
  IntakeRequester,
  IntakeRequestSummary,
} from "@mike/contracts";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { notifyPartialFailure, notifyError } from "@/app/lib/userFacingError";
import { notifySuccess } from "@/shared/lib/errorNotifier";
import {
  commandIntakeRequest,
  getIntakeMembers,
  getIntakeRequesters,
  listIntakeRequests,
  type IntakeListQuery,
  type IntakeListScope,
} from "@/app/lib/mikeApi";
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
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { discardIntakeDraft, getIntakeMemory } from "@/app/lib/intakeMemory";
import {
  intakeFiltersQuery,
  parseIntakeFilters,
  type IntakeFilters,
  type IntakeOpenState,
  type IntakeTab,
} from "./intakeQuery";
import { IntakePageHeader } from "./IntakePageHeader";
import { TabPillButtonUI } from "@/shared/ui/TabPillButtonUI";
import { IntakeReasonModal } from "./IntakeReasonModal";
import { intakeError } from "./useIntakeOperation";
import {
  INTAKE_STATE_DOT_CLASS,
  INTAKE_STATE_LABELS,
  formatIntakeDate,
  intakeDeleteMessage,
  isIntakeOverdue,
} from "./intakeLabels";
import { IntakeUnassigned } from "./IntakeUnassigned";
import { onIntakeNotified } from "./intakeNotificationToasts";

const TABS: { id: IntakeTab; label: string }[] = [
  { id: "outstanding", label: "Outstanding" },
  { id: "resolved", label: "Resolved" },
  { id: "cancelled", label: "Cancelled" },
];

/** The filter a dashboard figure opens the list with, named as on the dashboard. */
const SCOPE_LABELS: Record<IntakeListScope, string> = {
  open: "Open",
  unassigned: "Unassigned",
  overdue: "Overdue",
  recorded_30d: "Created in the last 30 days",
  resolved_30d: "Resolved in the last 30 days",
};

/** The closed tabs show one status; the others leave the status filter free. */
const isClosedTab = (tab: IntakeTab): tab is "resolved" | "cancelled" =>
  tab === "resolved" || tab === "cancelled";

/** The statuses an outstanding request can have, with their table dots. */
const UNREAD_OPTIONS = [
  { value: "unread" as const, label: "Unread replies" },
];

const OPEN_STATE_OPTIONS = (
  ["submitted", "in_review", "needs_information"] as IntakeOpenState[]
).map((value) => ({
  value,
  label: INTAKE_STATE_LABELS[value],
  dotClassName: INTAKE_STATE_DOT_CLASS[value],
}));
/**
 * Figures that count closed requests as well, so no tab describes their
 * list: Outstanding holds only open requests.
 */
const SCOPES_BEYOND_OUTSTANDING: readonly IntakeListScope[] = [
  "recorded_30d",
  "resolved_30d",
];
/** Quiet refreshes when the window regains focus are at most this frequent. */
const FOCUS_REFRESH_MS = 30_000;

/**
 * Mount the queue for the signed-in account and its active workspace: an
 * organization's shared queue, or the person's own requests in Personal.
 */
export function IntakeInbox() {
  const { accountId, workspaceId } = useWorkspace();
  if (!accountId || !workspaceId)
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <TableEmptyState>
          <EmptyState
            icon={<IntakeSkeuoIcon />}
            title="Intake"
            description="Sign in to track requests."
          />
        </TableEmptyState>
      </div>
    );
  return (
    <Inbox
      key={`${accountId}:${workspaceId}`}
      orgId={workspaceId}
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
  const [members, setMembers] = useState<IntakeMember[]>([]);
  const [requesters, setRequesters] = useState<IntakeRequester[]>([]);
  // What the page shows lives in its URL (see intakeQuery.ts), so a link, a
  // reload or Back from a request opens the same list.
  const searchParams = useSearchParams();
  const urlQuery = searchParams.toString();
  const [filters, setFilters] = useState(() =>
    parseIntakeFilters(searchParams),
  );
  const { tab, scope, status: state, sort } = filters;
  // The box shows each keystroke; the list and URL follow once typing settles.
  const [search, setSearch] = useState(filters.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The query string this page last wrote or adopted, and whether the next
  // write adds a history entry: switching view or tab does, filters replace.
  const written = useRef(urlQuery);
  const nextHistory = useRef<"push" | "replace">("replace");
  const [reload, setReload] = useState(0);
  const [cancelTargets, setCancelTargets] = useState<
    IntakeRequestSummary[] | null
  >(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<
    IntakeRequestSummary[] | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const query = useMemo<IntakeListQuery>(
    () => ({
      search: filters.q,
      state: isClosedTab(filters.tab)
        ? filters.tab
        : (filters.status ?? undefined),
      assignee: filters.assignee ?? undefined,
      requester: filters.requester ?? undefined,
      sort: filters.sort,
      // A dashboard figure's filter is already open, created or resolved.
      scope:
        filters.scope ?? (filters.tab === "outstanding" ? "open" : undefined),
      new_reply: filters.newReply || undefined,
    }),
    [filters],
  );

  function update(
    patch: Partial<IntakeFilters>,
    history: "push" | "replace" = "replace",
  ) {
    nextHistory.current = history;
    setFilters((current) => ({ ...current, ...patch }));
  }
  const filtersQuery = intakeFiltersQuery(filters);
  // Write the URL when what the page shows changes.
  useEffect(() => {
    if (filtersQuery === written.current) return;
    written.current = filtersQuery;
    // Next.js keeps useSearchParams in step with the native history calls.
    const href = filtersQuery ? `?${filtersQuery}` : window.location.pathname;
    if (nextHistory.current === "push")
      window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
    nextHistory.current = "replace";
  }, [filtersQuery]);
  // Back, Forward and links change the URL without this page: show what it says.
  useEffect(() => {
    if (urlQuery === written.current) return;
    written.current = urlQuery;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const next = parseIntakeFilters(new URLSearchParams(urlQuery));
    setFilters(next);
    setSearch(next.q);
  }, [urlQuery]);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );
  function changeSearch(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // The API searches at most 200 characters, as a link's search is cut.
    searchTimer.current = setTimeout(
      () => update({ q: value.slice(0, 200) }),
      250,
    );
  }
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
  // Only rows on screen can be selected: a refresh that drops one drops it
  // from the selection, so it is not selected again if it comes back.
  if (selection.key === queryKey && rows) {
    const shown = selection.ids.filter((id) =>
      rows.some((row) => row.id === id),
    );
    if (shown.length !== selection.ids.length)
      setSelection({ key: queryKey, ids: shown });
  }
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
        // The queue still works without names: the reviewer filter lists
        // nobody, and a failed list shows its own error.
        if (active) setMembers([]);
      });
    return () => {
      active = false;
    };
  }, [orgId, reload]);

  useEffect(() => {
    let active = true;
    // Without the list, a requester from the URL still filters the queue.
    getIntakeRequesters(orgId).then(
      (list) => active && setRequesters(list),
      () => active && setRequesters([]),
    );
    return () => {
      active = false;
    };
  }, [orgId, reload]);

  // The query whose rows are on screen, for a refresh that fails.
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    shownKey.current = page?.key ?? null;
  }, [page]);
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
        if (!active) return;
        // A refresh that fails leaves the rows it would have replaced.
        if (shownKey.current === queryKey)
          notifyError(e, { action: "refresh the requests" });
        else setListError({ key: queryKey, message: intakeError(e) });
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
  // News about this workspace's requests refreshes the list the same way.
  useEffect(
    () =>
      onIntakeNotified(orgId, () => {
        if (pagesOnScreen <= 1) refresh();
      }),
    [orgId, refresh, pagesOnScreen],
  );

  async function loadMore() {
    if (!page || page.key !== queryKey || !page.next || loadingMore) return;
    const key = queryKey;
    const cursor = page.next;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const result = await listIntakeRequests(orgId, {
        ...query,
        cursor,
      });
      setPage((current) => {
        // A refresh replaced the pages meanwhile: this one followed rows
        // that are no longer the last on screen, so it could skip some.
        if (current?.key !== key || current.next !== cursor) return current;
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
    !!filters.q ||
    !!state ||
    tab !== "outstanding" ||
    !!filters.assignee ||
    !!filters.requester ||
    filters.newReply ||
    !!scope;
  const failure = error;
  const hrefFor = (request: IntakeRequestSummary) =>
    `/intake/${request.id}?org=${orgId}`;
  const people: PersonOption[] = members;
  // Requesters are business contacts, not members: their name is their key.
  const requesterPeople: PersonOption[] = requesters.map((r) => ({
    user_id: r.name,
    display_name: r.name,
    email: r.email,
    profile_photo: null,
  }));
  const requester: PersonOption | null = filters.requester
    ? (requesterPeople.find(
        (person) =>
          person.user_id.toLowerCase() === filters.requester!.toLowerCase(),
      ) ?? {
        user_id: filters.requester,
        display_name: filters.requester,
        email: null,
        profile_photo: null,
      })
    : null;
  // A reviewer from the URL is named once the member list arrives.
  const assignee: PersonOption | null = filters.assignee
    ? (people.find((person) => person.user_id === filters.assignee) ?? {
        user_id: filters.assignee,
        display_name: null,
        email: null,
        profile_photo: null,
      })
    : null;

  /** A dashboard figure's filter goes with any other tab. */
  function changeTab(next: IntakeTab) {
    update({ tab: next, scope: null }, "push");
  }

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
    const deletable = targets.filter((r) => r.capabilities.delete);
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
        {(cancellable.length > 0 || deletable.length > 0) && (
          <DropdownSeparator />
        )}
        {cancellable.length > 0 && (
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
        )}
        {deletable.length > 0 && (
          <DropdownItem
            variant="destructive"
            onSelect={() => {
              close();
              setDeleteTargets(deletable);
            }}
          >
            {deletable.length > 1
              ? `Delete ${deletable.length} requests`
              : "Delete request"}
          </DropdownItem>
        )}
      </>
    );
  }

  async function deleteRequests(targets: IntakeRequestSummary[]) {
    setDeleting(true);
    const failed: IntakeRequestSummary[] = [];
    let lastError: unknown = null;
    for (const request of targets) {
      try {
        await commandIntakeRequest(orgId, request.id, "delete", {
          command_id: crypto.randomUUID(),
          expected_version: request.version,
        });
        // A note or reason left unsent on the deleted request has nowhere to go.
        discardIntakeDraft(getIntakeMemory(accountId, orgId, request.id));
      } catch (e) {
        failed.push(request);
        lastError = e;
      }
    }
    setDeleting(false);
    setDeleteTargets(null);
    // The ones that failed stay selected, so they can be found and retried.
    setSelectedIds(() => failed.map((request) => request.id));
    refresh();
    const deleted = targets.length - failed.length;
    if (deleted > 0)
      notifySuccess(
        deleted === 1 ? "Request deleted" : `${deleted} requests deleted`,
      );
    if (failed.length === targets.length && lastError)
      notifyError(lastError, {
        action:
          targets.length === 1 ? "delete the request" : "delete the requests",
      });
    else if (failed.length > 0)
      notifyPartialFailure(
        `${failed.length} of ${targets.length} requests couldn't be deleted and are still selected. They may have changed; check them and try again.`,
        { action: "delete the requests" },
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
    // The ones that failed stay selected, so they can be found and retried.
    setSelectedIds(() => failed.map((request) => request.id));
    refresh();
    if (failed.length === targets.length && lastError)
      notifyError(lastError, {
        action:
          targets.length === 1 ? "cancel the request" : "cancel the requests",
      });
    else if (failed.length > 0)
      notifyPartialFailure(
        `${failed.length} of ${targets.length} requests couldn't be cancelled and are still selected. They may have changed; check them and try again.`,
        { action: "cancel the requests" },
      );
  }

  const deletingMany = !!deleteTargets && deleteTargets.length > 1;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <IntakePageHeader
        page="requests"
        actions={[
          {
            type: "search",
            value: search,
            onChange: changeSearch,
            placeholder: "Search requests or requesters…",
          },
        ]}
      />

      <TableToolbar
        items={TABS}
        active={
          scope &&
          SCOPES_BEYOND_OUTSTANDING.includes(scope) &&
          tab === "outstanding"
            ? undefined
            : tab
        }
        onChange={changeTab}
        actions={
          <>
            {scope && (
              <TabPillButtonUI
                active
                data-icon-position="right"
                title="Remove this filter"
                onClick={() => update({ scope: null })}
                className="pl-3 pr-2"
              >
                {SCOPE_LABELS[scope]}
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </TabPillButtonUI>
            )}
            {selectedIds.length > 0 && (
              <SelectionActionsMenu
                renderItems={(close) => renderActions(undefined, close)}
              />
            )}
          </>
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
              <div className="flex items-center gap-1">
                <span>Request</span>
                <TableFilters
                  label="Filter by replies"
                  value={filters.newReply ? "unread" : null}
                  allLabel="All requests"
                  options={UNREAD_OPTIONS}
                  align="right"
                  onChange={(value) => update({ newReply: value === "unread" })}
                />
              </div>
            </TableStickyCell>
            <TableHeaderCell className="ml-auto w-44">
              <div className="flex items-center gap-1">
                <span>Requester</span>
                <PersonFilter
                  label="Filter by requester"
                  selectedTitle={(name) => `Requested by ${name}`}
                  removable
                  value={requester}
                  onChange={(person) =>
                    update({ requester: person?.user_id ?? null })
                  }
                  loadPeople={localPeople(requesterPeople)}
                />
              </div>
            </TableHeaderCell>
            <TableHeaderCell className="w-44">
              <div className="flex items-center gap-1">
                <span>Status</span>
                {!isClosedTab(tab) && (
                  <TableFilters
                    label="Filter by status"
                    value={state}
                    allLabel="All statuses"
                    options={OPEN_STATE_OPTIONS}
                    onChange={(status) => update({ status })}
                  />
                )}
              </div>
            </TableHeaderCell>
            <TableHeaderCell className="w-44">
              <div className="flex items-center gap-1">
                <span>Reviewer</span>
                <PersonFilter
                  label="Filter by reviewer"
                  selectedTitle={(name, self) =>
                    self ? "Assigned to me" : `Assigned to ${name}`
                  }
                  selfId={accountId}
                  removable
                  value={assignee}
                  onChange={(person) =>
                    update({ assignee: person?.user_id ?? null })
                  }
                  loadPeople={localPeople(people)}
                />
              </div>
            </TableHeaderCell>
            <TableHeaderCell className="w-32">
              <div className="flex items-center gap-1">
                <span>Target date</span>
                <TableFilters
                  label="Sort by target date"
                  value={sort === "target" ? "target" : null}
                  allLabel="Recently updated first"
                  options={[{ value: "target", label: "Soonest target first" }]}
                  onChange={(value) =>
                    update({
                      sort: value === "target" ? "target" : "updated",
                    })
                  }
                />
              </div>
            </TableHeaderCell>
            <TableHeaderCell className="w-28">
              <div className="flex items-center gap-1">
                <span>Updated</span>
                <TableFilters
                  label="Sort by updated"
                  value={sort === "updated_asc" ? "updated_asc" : null}
                  allLabel="Newest first"
                  options={[{ value: "updated_asc", label: "Oldest first" }]}
                  onChange={(value) =>
                    update({
                      sort: value === "updated_asc" ? "updated_asc" : "updated",
                    })
                  }
                />
              </div>
            </TableHeaderCell>
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
                title="No outstanding requests"
                description="Create an NDA request or legal question from the business to start tracking it."
                action={
                  <PillButtonUI
                    tone="black"
                    size="sm"
                    onClick={() => router.push("/intake/new")}
                  >
                    Create a request
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
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-800">
                      <Link
                        href={href}
                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                        title={request.subject}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {request.subject}
                      </Link>
                    </span>
                    <UnreadReplies count={unreadReplies(request)} />
                  </TablePrimaryCell>
                  <TableCell className="ml-auto w-44 [overflow-wrap:anywhere]">
                    <IntakePerson
                      name={request.requester_name}
                      email={request.requester_email}
                    />
                  </TableCell>
                  <TableCell className="w-44">
                    <IntakeQueueStatus request={request} />
                  </TableCell>
                  <TableCell className="w-44 [overflow-wrap:anywhere]">
                    {request.assignee_name ? (
                      <IntakePerson
                        name={request.assignee_name}
                        email={
                          members.find((m) => m.user_id === request.assignee_id)
                            ?.email
                        }
                        photo={
                          members.find((m) => m.user_id === request.assignee_id)
                            ?.profile_photo
                        }
                      />
                    ) : (
                      <IntakeUnassigned className="text-gray-400" />
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
      <ConfirmPopup
        open={!!deleteTargets}
        title={
          deletingMany
            ? `Delete ${deleteTargets.length} requests?`
            : "Delete this request?"
        }
        message={intakeDeleteMessage(orgId, deletingMany)}
        confirmLabel={deletingMany ? "Delete requests" : "Delete request"}
        confirmVariant="danger"
        confirmStatus={deleting ? "loading" : "idle"}
        cancelLabel={deletingMany ? "Keep requests" : "Keep request"}
        onCancel={() => {
          if (!deleting) setDeleteTargets(null);
        }}
        onConfirm={() => {
          if (deleteTargets && !deleting) void deleteRequests(deleteTargets);
        }}
      />
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
            <SkeletonPerson width="w-24" />
          </TableCell>
          <TableCell className="w-44">
            <SkeletonLine className="w-16" />
          </TableCell>
          <TableCell className="w-44">
            <SkeletonPerson width="w-24" />
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

/** Unread replies; a request flagged before counts existed shows one. */
function unreadReplies(request: IntakeRequestSummary) {
  return request.unread_replies ?? (request.new_reply ? 1 : 0);
}

/** A blue count of the replies nobody has opened yet. */
function UnreadReplies({ count }: { count: number }) {
  if (count < 1) return null;
  const label = `${count} unread ${count === 1 ? "reply" : "replies"}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="ml-2 mr-2 inline-flex h-3 min-w-3 shrink-0 items-center justify-center rounded-full bg-blue-600 px-[2px] text-[8px] font-medium leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** A row's status with its dot. */
export function IntakeQueueStatus({
  request,
}: {
  request: Pick<IntakeRequestSummary, "state">;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${INTAKE_STATE_DOT_CLASS[request.state]}`}
      />
      <span className="min-w-0">{INTAKE_STATE_LABELS[request.state]}</span>
    </span>
  );
}

/** A person's avatar beside their name; the name already labels the row. */
function IntakePerson({
  name,
  email,
  photo,
}: {
  name: string;
  email?: string | null;
  photo?: string | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="flex">
        <UserAvatar size="sm" name={name} email={email} photo={photo} />
      </span>
      <span className="min-w-0">{name}</span>
    </span>
  );
}

function SkeletonPerson({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-gray-100" />
      <SkeletonLine className={width} />
    </div>
  );
}
