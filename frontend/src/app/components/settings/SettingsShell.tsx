"use client";
import { pushWithDraftGuard } from "@/app/hooks/navigationGuard";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { settingsTabButtonClassName } from "@/app/(pages)/settings/settingsStyles";

export interface SettingsShellTab {
    id: string;
    label: string;
    href: string;
    badge?: ReactNode;
}

/** Where a settings area's sections switch from across the top to down the side. */
export const SETTINGS_SIDE_CLASS = "@min-[52rem]/settings:flex-col";

/**
 * The frame every settings area shares: a serif title, the sections down the
 * side (across the top when the page is narrow) and the open section beside
 * them. A person's settings, an organization's and Intake's use the same one,
 * so they read as the same kind of place.
 *
 * `side` is the sections' navigation; without it the content takes the width.
 * Without a `title`, the page names itself elsewhere, such as in a header
 * above the frame.
 */
export function SettingsFrame({
    title,
    side,
    search,
    children,
}: {
    title?: ReactNode;
    side?: ReactNode;
    /** A search box drawn at the right end of the title row, when the area has one. */
    search?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex h-full flex-col overflow-y-auto">
            {title ? (
                <header className="mx-auto flex h-16 w-full max-w-5xl shrink-0 items-end justify-between gap-4 px-6 pb-2 md:h-24 md:pb-4">
                    <h1 className="shrink-0 text-3xl font-medium font-eb-garamond">
                        {title}
                    </h1>
                    {/* The search sits at the right end of the heading's row, so the
                        sections and the open page keep their places. */}
                    {search ? (
                        <div className="relative z-20 w-full min-w-0 max-w-[18rem]">
                            {search}
                        </div>
                    ) : null}
                </header>
            ) : null}

            <main className="@container/settings mx-auto w-full max-w-5xl flex-1 px-6 pb-10 pt-4 md:pt-6">
                <div className="grid grid-cols-1 gap-y-6 @min-[52rem]/settings:grid-cols-[224px_minmax(0,1fr)] @min-[52rem]/settings:gap-x-10">
                    {side ? (
                        <div className="z-10 -ml-3 min-w-0 self-start @min-[52rem]/settings:sticky @min-[52rem]/settings:top-4">
                            {side}
                        </div>
                    ) : null}

                    <div
                        className={
                            side
                                ? "min-w-0 outline-none"
                                : "min-w-0 outline-none @min-[52rem]/settings:col-span-2"
                        }
                    >
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
}

/**
 * A settings area whose sections are pages: each tab opens its `href`.
 *
 * `rootHref` is the area's first section, whose path is a prefix of every
 * other's: it is the open one only on an exact match.
 */
export function SettingsShell({
    title,
    navLabel,
    tabs,
    rootHref,
    search,
    children,
}: {
    title: ReactNode;
    /** The navigation's accessible name. */
    navLabel: string;
    tabs: SettingsShellTab[];
    rootHref: string;
    /** A search box drawn at the right end of the title row, when the area has one. */
    search?: ReactNode;
    children: ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();

    return (
        <SettingsFrame
            title={title}
            search={search}
            side={
                <nav aria-label={navLabel} className="min-w-0">
                    <div className="-m-1 min-w-0 p-1">
                        <div className="-m-1 min-w-0 overflow-x-auto overflow-y-hidden p-1">
                            <ul
                                className={`mb-0 flex gap-1 ${SETTINGS_SIDE_CLASS}`}
                            >
                                {tabs.map((tab) => {
                                    const active =
                                        pathname === tab.href ||
                                        (tab.href !== rootHref &&
                                            pathname.startsWith(tab.href));
                                    return (
                                        <li key={tab.id}>
                                            <button
                                                type="button"
                                                aria-current={
                                                    active ? "page" : undefined
                                                }
                                                onClick={() =>
                                                    pushWithDraftGuard(
                                                        router,
                                                        tab.href,
                                                    )
                                                }
                                                className={settingsTabButtonClassName(
                                                    active,
                                                )}
                                            >
                                                {tab.label}
                                                {tab.badge ? (
                                                    <> {tab.badge}</>
                                                ) : null}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </div>
                </nav>
            }
        >
            {children}
        </SettingsFrame>
    );
}
