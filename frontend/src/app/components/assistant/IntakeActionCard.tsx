"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import type {
    IntakeActionEvent,
    IntakeRequest,
    IntakeState,
    IntakeStatusChange,
} from "@mike/contracts";
import { commandIntakeRequest, getIntakeRequest } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { LIQUID_GLASS_FLAT_CLASS } from "@/shared/ui/LiquidGlassUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import {
    intakeStateLabel,
    isOpenIntakeState,
} from "@/app/components/intake/intakeLabels";
import { intakeRequestHref } from "@/app/components/intake/intakeQuery";
import type { AssistantEvent } from "@/app/components/shared/types";

const CHANGES: Record<
    IntakeStatusChange,
    {
        title: string;
        confirm: string;
        /** Said in "Couldn't …" when it fails. */
        action: string;
        /** Said once the user confirms it here. */
        done: string;
        /** The note's label; reopening takes none. */
        note: string | null;
        noteRequired?: boolean;
        /** Whether the request is already where this change would put it. */
        reached: (state: IntakeState) => boolean;
    }
> = {
    resolve: {
        title: "Resolve request",
        confirm: "Resolve",
        action: "resolve the request",
        done: "Request resolved.",
        note: "Resolution (optional)",
        reached: (state) => state === "resolved",
    },
    cancel: {
        title: "Cancel request",
        confirm: "Cancel request",
        action: "cancel the request",
        done: "Request cancelled.",
        note: "Reason",
        noteRequired: true,
        reached: (state) => state === "cancelled",
    },
    wait: {
        title: "Mark as waiting on requester",
        confirm: "Mark as waiting",
        action: "change the status",
        done: "Marked as waiting on requester.",
        note: "Note (optional)",
        reached: (state) => state === "needs_information",
    },
    resume: {
        title: "Mark as in progress",
        confirm: "Mark as in progress",
        action: "change the status",
        done: "Marked as in progress.",
        note: "Note (optional)",
        reached: (state) => state === "in_review",
    },
    reopen: {
        title: "Reopen request",
        confirm: "Reopen",
        action: "reopen the request",
        done: "Request reopened.",
        note: null,
        reached: isOpenIntakeState,
    },
};

type Loaded =
    | { status: "loading" }
    | { status: "unavailable" }
    | { status: "ready"; request: IntakeRequest };

/** The chat's newest proposed status change; only it can be confirmed. */
export function latestIntakeActionCardId(
    messages: { events?: AssistantEvent[] }[],
): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const events = messages[i].events ?? [];
        for (let j = events.length - 1; j >= 0; j--) {
            const event = events[j];
            if (event.type === "intake_action") return event.card_id;
        }
    }
    return null;
}

/**
 * A status change the assistant proposed for its chat's intake request.
 * Nothing changes until the user confirms, which sends the request's own
 * command as them; the card reads the request afresh, so a change that no
 * longer applies says so instead of offering Confirm.
 */
export function IntakeActionCard({
    event,
    replaced = false,
}: {
    event: IntakeActionEvent;
    /** A later proposal in the chat replaces this one. */
    replaced?: boolean;
}) {
    const change = CHANGES[event.action];
    const noteId = useId();
    const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
    const [note, setNote] = useState(event.note ?? "");
    const [busy, setBusy] = useState(false);
    const [confirmed, setConfirmed] = useState(false);

    const load = useCallback(
        () =>
            getIntakeRequest(event.org_id, event.request_id).then(
                (request) => setLoaded({ status: "ready", request }),
                () => setLoaded({ status: "unavailable" }),
            ),
        [event.org_id, event.request_id],
    );
    useEffect(() => {
        void load();
    }, [load]);
    // Someone else may change the request while the chat stays open: read
    // it again on returning to the tab, so Confirm reflects it and carries
    // its current version. A failed recheck keeps what is shown.
    useEffect(() => {
        const recheck = () => {
            if (document.visibilityState !== "visible") return;
            getIntakeRequest(event.org_id, event.request_id).then(
                (request) => setLoaded({ status: "ready", request }),
                () => {},
            );
        };
        window.addEventListener("focus", recheck);
        document.addEventListener("visibilitychange", recheck);
        return () => {
            window.removeEventListener("focus", recheck);
            document.removeEventListener("visibilitychange", recheck);
        };
    }, [event.org_id, event.request_id]);

    /** Confirm shows only for a request on screen, at the version shown. */
    async function confirm(current: IntakeRequest) {
        setBusy(true);
        try {
            await commandIntakeRequest(
                event.org_id,
                event.request_id,
                event.action,
                {
                    command_id: crypto.randomUUID(),
                    expected_version: current.version,
                    ...(change.note && note.trim() ? { body: note.trim() } : {}),
                },
            );
            setConfirmed(true);
        } catch (error) {
            notifyError(error, { action: change.action });
        } finally {
            setBusy(false);
            // Shows the request as it is now, whether or not this worked.
            await load();
        }
    }

    const request = loaded.status === "ready" ? loaded.request : null;
    const reached = !!request && change.reached(request.state);
    const available =
        !!request && !reached && request.capabilities[event.action];
    const missingNote =
        !!change.noteRequired && !note.trim();

    return (
        <section
            aria-label={change.title}
            className={`min-w-0 overflow-hidden rounded-xl ${LIQUID_GLASS_FLAT_CLASS}`}
        >
            <div className="space-y-1 px-3 pt-2">
                <h3 className="font-serif text-base font-medium text-gray-800">
                    {change.title}
                </h3>
                {request ? (
                    <Link
                        href={intakeRequestHref(event.org_id, event.request_id)}
                        className="block rounded text-xs text-gray-500 [overflow-wrap:anywhere] hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    >
                        {request.subject}
                    </Link>
                ) : loaded.status === "loading" ? (
                    <div
                        aria-hidden="true"
                        className="h-4 w-40 animate-pulse rounded bg-gray-200"
                    />
                ) : null}
            </div>
            <div className="px-3 pb-3 pt-2">
                {loaded.status === "loading" ? (
                    <div
                        aria-hidden="true"
                        className="h-7 w-24 animate-pulse rounded-full bg-gray-200"
                    />
                ) : loaded.status === "unavailable" ? (
                    <p className="text-xs text-gray-600">
                        This request can’t be opened, so this change can’t be
                        made here.
                    </p>
                ) : !confirmed && replaced ? (
                    <p className="text-xs text-gray-600">
                        A later proposal replaces this one.
                    </p>
                ) : confirmed || reached ? (
                    // What was done here stays true after later changes;
                    // otherwise the request already has this status.
                    <p
                        role="status"
                        className="flex items-center gap-1.5 text-xs text-gray-700"
                    >
                        <Check
                            aria-hidden="true"
                            className="h-3.5 w-3.5 shrink-0 text-green-600"
                        />
                        {confirmed
                            ? `Done. ${change.done}`
                            : `The request is ${intakeStateLabel(
                                  request!.state,
                                  request!.clarify_stage,
                              )}.`}
                    </p>
                ) : !available ? (
                    <p className="text-xs text-gray-600">
                        This change no longer applies. The request is{" "}
                        {intakeStateLabel(
                            request!.state,
                            request!.clarify_stage,
                        )}
                        .
                    </p>
                ) : (
                    <div className="space-y-2">
                        {change.note && (
                            <div>
                                <label
                                    htmlFor={noteId}
                                    className="mb-1 block text-xs font-medium text-gray-500"
                                >
                                    {change.note}
                                </label>
                                <textarea
                                    id={noteId}
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    maxLength={20000}
                                    disabled={busy}
                                    className={`${SETTINGS_CONTROL_CLASS} block max-h-60 min-h-16 resize-none py-2 text-xs leading-relaxed [field-sizing:content]`}
                                />
                            </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            <PillButtonUI
                                tone={event.action === "cancel" ? "danger" : "black"}
                                size="sm"
                                loading={busy}
                                disabled={missingNote}
                                onClick={() => void confirm(request!)}
                            >
                                {change.confirm}
                            </PillButtonUI>
                            <span className="text-xs text-gray-500">
                                Nothing is sent to the requester.
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
