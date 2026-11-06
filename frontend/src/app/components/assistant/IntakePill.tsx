"use client";

import type { ReactElement } from "react";
import { Inbox, X } from "lucide-react";

/**
 * The pill for an intake request a chat message processes: in the composer
 * (with `onRemove`) and on the sent message (without).
 */
export function IntakePill({
    title,
    onRemove,
}: {
    title: string;
    onRemove?: () => void;
}): ReactElement {
    return (
        <div
            title={title}
            className={`inline-flex items-center gap-1 rounded-full border bg-violet-600 py-0.5 text-xs text-white shadow ${
                onRemove
                    ? "border-white/20 pl-2.5 pr-1"
                    : "border-violet-600 pl-2 pr-2.5"
            }`}
        >
            <Inbox aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
            <span className="max-w-[140px] truncate">{title}</span>
            <span className="sr-only">, intake request</span>
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remove intake request ${title}`}
                    className="ml-0.5 rounded-full p-0.5 text-white/60 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                    <X aria-hidden="true" className="h-2.5 w-2.5" />
                </button>
            )}
        </div>
    );
}
