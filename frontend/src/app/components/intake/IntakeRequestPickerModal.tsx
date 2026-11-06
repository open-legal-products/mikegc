"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { IntakeRequestSummary } from "@mike/contracts";
import { Modal } from "@/app/components/modals/Modal";
import { SearchBar } from "@/app/components/ui/search-bar";
import {
  LIQUID_GLASS_MODAL_ROW_HOVER_CLASS,
  LIQUID_GLASS_MODAL_ROW_SELECTED_CLASS,
} from "@/app/components/ui/liquid-surface";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { listIntakeRequests } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";
import { intakeStateLabel } from "./intakeLabels";

/** A request picked to process: `orgId` is its workspace, or "personal". */
export type PickedIntakeRequest = { id: string; title: string; orgId: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (request: PickedIntakeRequest) => void;
  breadcrumbs: ReactNode[];
};

/**
 * Picks one of the active workspace's open intake requests to process in
 * the Assistant; laid out like the playbook picker. Search runs on the
 * server, and Load more reads the queue's next page.
 */
export function IntakeRequestPickerModal({
  open,
  onClose,
  onSelect,
  breadcrumbs,
}: Props) {
  const { workspaceId } = useWorkspace();
  const [requests, setRequests] = useState<IntakeRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<IntakeRequestSummary | null>(null);
  const [search, setSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // A new search or workspace makes a page still on its way stale.
  const listing = useRef(0);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    // Wait for typing to pause before asking the server.
    const timer = setTimeout(
      () => {
        const current = ++listing.current;
        setLoading(true);
        setFailed(false);
        setLoadingMore(false);
        listIntakeRequests(workspaceId, {
          scope: "open",
          search: search.trim() || undefined,
        })
          .then((page) => {
            if (cancelled || current !== listing.current) return;
            setRequests(page.requests);
            setNextCursor(page.next_cursor);
            setSelected((selection) =>
              selection && page.requests.some((r) => r.id === selection.id)
                ? selection
                : null,
            );
          })
          .catch(() => {
            if (cancelled || current !== listing.current) return;
            // Nothing on screen to use, so nothing stays picked either.
            setRequests([]);
            setNextCursor(null);
            setSelected(null);
            setFailed(true);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search, workspaceId]);

  if (!open) return null;

  /**
   * Reads the next page of the listing `generation` names. A retry keeps the
   * failed page's generation, so once another search has replaced that
   * listing, its old cursor and results can't be mixed into the new one.
   */
  function loadMore(generation = listing.current) {
    // The button is disabled while a page loads; a retry comes after one failed.
    if (generation !== listing.current || !workspaceId || !nextCursor) return;
    const current = generation;
    setLoadingMore(true);
    listIntakeRequests(workspaceId, {
      scope: "open",
      search: search.trim() || undefined,
      cursor: nextCursor,
    })
      .then((page) => {
        if (current !== listing.current) return;
        setRequests((shown) => [
          ...shown,
          ...page.requests.filter((r) => !shown.some((s) => s.id === r.id)),
        ]);
        setNextCursor(page.next_cursor);
      })
      .catch((error) => {
        if (current === listing.current)
          notifyError(error, {
            action: "load more requests",
            onRetry: () => loadMore(current),
          });
      })
      .finally(() => {
        if (current === listing.current) setLoadingMore(false);
      });
  }

  function close() {
    setSelected(null);
    setSearch("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      breadcrumbs={breadcrumbs}
      primaryAction={{
        label: "Use",
        disabled: !selected || !workspaceId,
        onClick: () => {
          // Enabled only with a pick in a workspace.
          onSelect({
            id: selected!.id,
            title: selected!.subject,
            orgId: workspaceId!,
          });
          close();
        },
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible">
        <SearchBar
          value={search}
          onValueChange={setSearch}
          placeholder="Search open requests..."
        />
        <div
          data-modal-scroll="vertical"
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-sm pt-2"
        >
          {loading && requests.length === 0 ? (
            <div className="space-y-px">
              {[60, 45, 75, 50, 65].map((width) => (
                <div
                  key={width}
                  className="flex items-center rounded-md px-3 py-2.5"
                >
                  <div
                    className="h-3 animate-pulse rounded bg-gray-100"
                    style={{ width: `${width}%` }}
                  />
                </div>
              ))}
            </div>
          ) : requests.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              {failed
                ? "Requests couldn’t be loaded. Try again later."
                : search.trim()
                  ? "No matches found"
                  : "No open requests"}
            </p>
          ) : (
            <div className="space-y-px">
              {requests.map((request) => {
                const isSelected = selected?.id === request.id;
                return (
                  <button
                    key={request.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelected(isSelected ? null : request)}
                    className={`flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-3 py-2 text-left text-xs transition-all ${
                      isSelected
                        ? `${LIQUID_GLASS_MODAL_ROW_SELECTED_CLASS} text-gray-900`
                        : LIQUID_GLASS_MODAL_ROW_HOVER_CLASS
                    }`}
                  >
                    <span
                      className={`min-w-0 flex-1 basis-48 [overflow-wrap:anywhere] ${
                        isSelected
                          ? "font-medium text-gray-900"
                          : "text-gray-700"
                      }`}
                    >
                      {request.subject}
                    </span>
                    <span className="shrink-0 text-gray-400">
                      {[
                        request.requester_name,
                        intakeStateLabel(request.state, request.clarify_stage),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                );
              })}
              {nextCursor && (
                <div className="flex justify-center pt-2">
                  <TextButtonUI
                    size="xs"
                    loading={loadingMore}
                    onClick={() => loadMore()}
                  >
                    Load more
                  </TextButtonUI>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
