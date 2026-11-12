"use client";

import {
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  IntakeDashboard as Dashboard,
  IntakeDashboardDays,
  IntakeDashboardMedianDays,
  IntakeDashboardWeeks,
} from "@mike/contracts";
import {
  Dropdown,
  DropdownContent,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownTrigger,
} from "@mike/ui";
import {
  PERSONAL_WORKSPACE,
  useWorkspace,
} from "@/app/contexts/WorkspaceContext";
import { getIntakeDashboard } from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { EmptyState } from "@/app/components/ui/empty-state";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { GlassCardUI } from "@mike/ui";
import {
  LIQUID_GLASS_FLOAT_CLASS,
  LIQUID_GLASS_GROUP_HOVER_CLASS,
  LIQUID_GLASS_HOVER_CLASS,
} from "@mike/ui";
import { PillButtonUI } from "@mike/ui";
import { intakeError } from "./useIntakeOperation";
import { INTAKE_STATE_LABELS } from "./intakeLabels";
import { IntakePageHeader } from "./IntakePageHeader";
import { intakeRequestsHref } from "./intakeQuery";

const SECTION_HEADING = "text-sm font-medium text-gray-900";

/** A headline figure that opens the requests it counted. */
export type IntakeFigure = "open" | "unassigned" | "overdue";
/**
 * Every card on the dashboard is the same distance from the next: 1rem
 * between tiles, between the charts and between the rows of cards.
 */
const CARD_GAP_CLASS = "gap-4";
const CARD_STACK_CLASS = "space-y-4";
/** Six tiles in an organization; Personal has no unassigned requests to count. */
const tileGridClass = (personal: boolean) =>
  cn(
    "grid grid-cols-2 @[40rem]:grid-cols-3",
    CARD_GAP_CLASS,
    personal ? "@[64rem]:grid-cols-5" : "@[64rem]:grid-cols-6",
  );

/** Open requests by status, in the queue's colors and order. */
const STATUS_SEGMENTS = [
  {
    key: "new",
    state: "submitted",
    label: INTAKE_STATE_LABELS.submitted,
    color: "--chart-status-new",
  },
  {
    key: "in_progress",
    state: "in_review",
    label: INTAKE_STATE_LABELS.in_review,
    color: "--chart-status-in-progress",
  },
  {
    key: "waiting",
    state: "needs_information",
    label: INTAKE_STATE_LABELS.needs_information,
    color: "--chart-status-waiting",
  },
] as const;

const WEEK_SERIES = [
  { key: "created", label: "Created", color: "--chart-series-1" },
  { key: "resolved", label: "Resolved", color: "--chart-series-2" },
] as const;

/** The requests list showing what a headline figure counted. */
export function intakeFigureHref(figure: IntakeFigure) {
  switch (figure) {
    case "open":
      // Outstanding, the list's default, is exactly the open requests.
      return intakeRequestsHref();
    case "unassigned":
      return intakeRequestsHref({ scope: "unassigned" });
    case "overdue":
      return intakeRequestsHref({ scope: "overdue", sort: "target" });
  }
}

/** /intake/dashboard, for the signed-in account's active workspace. */
export function IntakeDashboardPage() {
  const { accountId, workspaceId } = useWorkspace();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <IntakePageHeader page="dashboard" />
      {accountId && workspaceId ? (
        <IntakeDashboard
          key={`${accountId}:${workspaceId}`}
          orgId={workspaceId}
        />
      ) : (
        <EmptyState
          title="Intake"
          description="Sign in to see the dashboard."
        />
      )}
    </div>
  );
}

/**
 * Where the workspace's requests stand: headline counts, open requests by
 * status, requests created and resolved each week, and, in an organization,
 * who holds the open ones. It loads afresh each time the page is opened.
 */
export function IntakeDashboard({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Each period figure reads over its own period; the figures on screen stay
  // until the next ones arrive. Their menus name the period they cover, and
  // a figure whose next period is loading is marked busy.
  const [periods, setPeriods] = useState<Periods>(DEFAULT_PERIODS);
  const choose = (patch: Partial<Periods>) =>
    setPeriods((current) => ({ ...current, ...patch }));
  useEffect(() => {
    let active = true;
    getIntakeDashboard(
      orgId,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      periods,
    )
      .then((dashboard) => {
        if (!active) return;
        setData(dashboard);
        setError(null);
      })
      .catch((e) => {
        if (active) setError(intakeError(e, "load the dashboard"));
      });
    return () => {
      active = false;
    };
  }, [orgId, reload, periods]);
  const personal = orgId === PERSONAL_WORKSPACE;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* The same gutters as the header, so the cards line up with it. */}
      <div className={cn("@container px-3 pb-8 md:px-6.5", CARD_STACK_CLASS)}>
        {error ? (
          <EmptyState
            tone="error"
            title="Unable to load the dashboard"
            description={<span role="alert">{error}</span>}
            action={
              <PillButtonUI
                tone="black"
                size="sm"
                onClick={() => {
                  setError(null);
                  setReload((n) => n + 1);
                }}
              >
                Try again
              </PillButtonUI>
            }
          />
        ) : data ? (
          <>
            <div className={tileGridClass(personal)}>
              <StatTile
                label="Open"
                value={data.open}
                href={intakeFigureHref("open")}
              />
              {!personal && (
                <StatTile
                  label="Unassigned"
                  value={data.unassigned}
                  href={intakeFigureHref("unassigned")}
                />
              )}
              <StatTile
                label="Overdue"
                value={data.overdue}
                alert={data.overdue > 0}
                href={intakeFigureHref("overdue")}
              />
              <StatTile
                label="Created"
                value={data.created}
                busy={periods.created_days !== data.created_days}
                detail={
                  <PeriodMenu
                    label="Created"
                    value={data.created_days}
                    options={DAY_PERIODS}
                    onChange={(created_days) => choose({ created_days })}
                  />
                }
              />
              <StatTile
                label="Resolved"
                value={data.resolved}
                busy={periods.resolved_days !== data.resolved_days}
                detail={
                  <PeriodMenu
                    label="Resolved"
                    value={data.resolved_days}
                    options={DAY_PERIODS}
                    onChange={(resolved_days) => choose({ resolved_days })}
                  />
                }
              />
              <StatTile
                label="Median time to resolve"
                value={formatHours(data.median_hours_to_resolve)}
                busy={periods.median_days !== data.median_days}
                detail={
                  <PeriodMenu
                    label="Median time to resolve"
                    value={data.median_days}
                    options={MEDIAN_PERIODS}
                    onChange={(median_days) => choose({ median_days })}
                  />
                }
              />
            </div>
            {/* Side by side, the two charts share the taller one's height. */}
            <div className={cn("grid @[52rem]:grid-cols-2", CARD_GAP_CLASS)}>
              <StatusBreakdown data={data} />
              <WeeklyChart
                weeks={data.weeks}
                busy={periods.weeks !== data.weeks_shown}
                period={
                  <PeriodMenu
                    label="Requests per week"
                    value={data.weeks_shown}
                    options={WEEK_PERIODS}
                    onChange={(weeks) => choose({ weeks })}
                  />
                }
              />
            </div>
            {!personal && <Workload rows={data.workload} />}
          </>
        ) : (
          <DashboardSkeleton personal={personal} />
        )}
      </div>
    </div>
  );
}

type Periods = {
  weeks: IntakeDashboardWeeks;
  created_days: IntakeDashboardDays;
  resolved_days: IntakeDashboardDays;
  median_days: IntakeDashboardMedianDays;
};
const DEFAULT_PERIODS: Periods = {
  weeks: 8,
  created_days: 30,
  resolved_days: 30,
  median_days: 30,
};
const DAY_PERIODS: { value: IntakeDashboardDays; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 365, label: "Last 12 months" },
];
const MEDIAN_PERIODS: { value: IntakeDashboardMedianDays; label: string }[] =
  [
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 365, label: "Last 12 months" },
];
const WEEK_PERIODS: { value: IntakeDashboardWeeks; label: string }[] = [
  { value: 4, label: "Last 4 weeks" },
  { value: 8, label: "Last 8 weeks" },
  { value: 12, label: "Last 12 weeks" },
  { value: 26, label: "Last 26 weeks" },
];

/** The period a figure covers, as a small menu in its caption. */
function PeriodMenu<T extends number>({
  label,
  value,
  options,
  onChange,
}: {
  /** The figure it belongs to, which names the menu. */
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={`${label} period: ${current?.label ?? ""}`}
          className="-mx-1 inline-flex items-center gap-0.5 rounded-md px-1 text-xs text-gray-500 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          {current?.label}
          <ChevronDown aria-hidden="true" className="h-3 w-3" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start">
        <DropdownRadioGroup
          value={String(value)}
          onValueChange={(next) => onChange(Number(next) as T)}
        >
          {options.map((option) => (
            <DropdownRadioItem key={option.value} value={String(option.value)}>
              {option.label}
            </DropdownRadioItem>
          ))}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}

/** Hours as the dashboard says them: hours under a day, days beyond. */
export function formatHours(hours: number | null) {
  if (hours === null) return "None yet";
  const round = (n: number) => Math.round(n * 10) / 10;
  if (hours < 24) {
    const value = round(hours);
    return `${value} ${value === 1 ? "hour" : "hours"}`;
  }
  const days = round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * A headline figure. Open, unassigned and overdue link to the requests they
 * count; the others are read-only.
 */
function StatTile({
  label,
  value,
  detail,
  alert = false,
  busy = false,
  href,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** Needs attention: the value is shown in red beside its label. */
  alert?: boolean;
  /** The figure for a newly chosen period is loading. */
  busy?: boolean;
  href?: string;
}) {
  const content = (
    <>
      <span className="block text-xs text-gray-500">{label}</span>
      <span
        aria-busy={busy || undefined}
        className={cn(
          "mt-1 block text-2xl font-semibold transition-opacity [overflow-wrap:anywhere]",
          alert ? "text-red-600" : "text-gray-900",
          busy && "opacity-50",
        )}
      >
        {value}
      </span>
      {detail && (
        <div className="mt-0.5 text-xs text-gray-500">{detail}</div>
      )}
    </>
  );
  return (
    <GlassCardUI>
      {href ? (
        <Link
          href={href}
          className={cn(
            "relative block h-full rounded-xl p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
            LIQUID_GLASS_HOVER_CLASS,
          )}
        >
          {content}
          {/* Marks the figures that open their requests. */}
          <ChevronRight
            aria-hidden="true"
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          />
          <span className="sr-only">. Show these requests.</span>
        </Link>
      ) : (
        <div className="p-4">{content}</div>
      )}
    </GlassCardUI>
  );
}

function Card({
  title,
  subtitle,
  aside,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <GlassCardUI>
      <section aria-labelledby={heading} className="flex h-full flex-col px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id={heading} className={SECTION_HEADING}>
              {title}
            </h2>
            {subtitle && (
              <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>
            )}
          </div>
          {aside}
        </div>
        {children}
      </section>
    </GlassCardUI>
  );
}

/** A legend entry: the mark's color beside text in the text colors. */
function LegendItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value?: number;
}) {
  return (
    <li className="flex items-center gap-1.5 text-gray-500">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: `var(${color})` }}
      />
      {label}
      {value !== undefined && (
        <span className="font-medium text-gray-900">{value}</span>
      )}
    </li>
  );
}

/** A pie slice from `start` to `end`, in fractions of a turn from 12 o'clock. */
export function slicePath(start: number, end: number) {
  const point = (turn: number) => {
    const angle = 2 * Math.PI * turn - Math.PI / 2;
    const x = 50 + 50 * Math.cos(angle);
    const y = 50 + 50 * Math.sin(angle);
    return `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
  };
  const large = end - start > 0.5 ? 1 : 0;
  return `M50 50L${point(start)}A50 50 0 ${large} 1 ${point(end)}Z`;
}

/**
 * Open requests split by status: a pie in the queue's status colors, read
 * clockwise from 12 o'clock, beside a legend giving each count and share.
 * Pointing at a slice or its legend entry picks it out.
 */
function StatusBreakdown({ data }: { data: Dashboard }) {
  const [active, setActive] = useState<string | null>(null);
  const segments = STATUS_SEGMENTS.map((segment) => ({
    ...segment,
    count: data[segment.key],
  }));
  const share = (count: number) =>
    `${Math.round((count / Math.max(1, data.open)) * 100)}%`;
  const present = segments.filter((segment) => segment.count > 0);
  const slices = present.map((segment, index) => {
    const before = present
      .slice(0, index)
      .reduce((total, earlier) => total + earlier.count, 0);
    return {
      ...segment,
      start: before / data.open,
      end: (before + segment.count) / data.open,
    };
  });
  const dimmed = (key: string) =>
    active !== null && active !== key && "opacity-40";
  return (
    <Card title="Open requests by status">
      {data.open === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No open requests.</p>
      ) : (
        <div className="mt-4 flex flex-1 flex-wrap items-center justify-center gap-x-10 gap-y-4">
          <svg
            viewBox="-1 -1 102 102"
            role="img"
            aria-label={`Open requests by status: ${segments
              .map(
                (segment) => `${segment.count} ${segment.label.toLowerCase()}`,
              )
              .join(", ")}`}
            className="h-40 w-40 shrink-0"
          >
            {slices.map((slice) => {
              const mark = {
                fill: `var(${slice.color})`,
                className: cn("transition-opacity", dimmed(slice.key)),
                onPointerEnter: () => setActive(slice.key),
                onPointerLeave: () => setActive(null),
              };
              const title = (
                <title>{`${slice.label}: ${slice.count} (${share(slice.count)})`}</title>
              );
              // One status is the whole pie; the rest are parted by a 2px gap
              // in the card's own color.
              return slices.length === 1 ? (
                <circle key={slice.key} cx={50} cy={50} r={50} {...mark}>
                  {title}
                </circle>
              ) : (
                <path
                  key={slice.key}
                  d={slicePath(slice.start, slice.end)}
                  stroke="var(--liquid-glass-background-flat)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  {...mark}
                >
                  {title}
                </path>
              );
            })}
          </svg>
          {/* A status with open requests links to them; an empty one is read-only. */}
          <ul className="space-y-1 text-xs">
            {segments.map((segment) => {
              const entry = (
                <>
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: `var(${segment.color})` }}
                  />
                  {segment.label}
                  <span className="font-medium text-gray-900">
                    {segment.count}
                  </span>
                  <span className="text-gray-400">{share(segment.count)}</span>
                </>
              );
              return (
                <li
                  key={segment.key}
                  onPointerEnter={() => segment.count && setActive(segment.key)}
                  onPointerLeave={() => setActive(null)}
                  className={cn("transition-opacity", dimmed(segment.key))}
                >
                  {segment.count ? (
                    <Link
                      href={intakeRequestsHref({ status: segment.state })}
                      className={cn(
                        "group -mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-gray-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                        LIQUID_GLASS_HOVER_CLASS,
                      )}
                    >
                      {entry}
                      <ChevronRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-gray-400 transition-colors group-hover:text-gray-900"
                      />
                      <span className="sr-only">. Show these requests.</span>
                    </Link>
                  ) : (
                    <span className="flex items-center gap-1.5 py-1 text-gray-500">
                      {entry}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** The smallest even axis top, of the form 2, 4, 6, 8 × 10ⁿ, that fits `max`. */
export function axisTop(max: number) {
  for (let scale = 1; ; scale *= 10)
    for (const step of [2, 4, 6, 8, 10])
      if (step * scale >= max) return step * scale;
}

/** A week's start as a short date, read in the viewer's locale. */
function weekLabel(weekStart: string) {
  const [year, month, day] = weekStart.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Requests created and resolved each week, as paired columns. Each week is
 * one hover and focus target whose tooltip, and accessible name, give both
 * counts.
 */
function WeeklyChart({
  weeks,
  period,
  busy = false,
}: {
  weeks: Dashboard["weeks"];
  /** The chart's period menu, under its title. */
  period: ReactNode;
  /** The weeks for a newly chosen period are loading. */
  busy?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const top = axisTop(
    Math.max(1, ...weeks.flatMap((week) => [week.created, week.resolved])),
  );
  const ticks = [0, top / 2, top];
  const empty = weeks.every((week) => !week.created && !week.resolved);
  return (
    <Card
      title="Requests per week"
      subtitle={period}
      aside={
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {WEEK_SERIES.map((series) => (
            <LegendItem
              key={series.key}
              color={series.color}
              label={series.label}
            />
          ))}
        </ul>
      }
    >
      <div
        aria-busy={busy || undefined}
        className={cn("transition-opacity", busy && "opacity-50")}
      >
        {empty ? (
          <p className="mt-4 text-sm text-gray-500">
            No requests were created or resolved in these weeks.
          </p>
        ) : (
          <>
            <div className="relative mt-5 h-40">
              {ticks.map((tick) => (
                <div
                  key={tick}
                  aria-hidden="true"
                  className="absolute left-7 right-0 h-px bg-gray-100"
                  style={{ bottom: `${(tick / top) * 100}%` }}
                >
                  <span className="absolute -left-7 w-5 -translate-y-1/2 text-right text-[11px] tabular-nums text-gray-400">
                    {tick}
                  </span>
                </div>
              ))}
              <div className="absolute inset-y-0 left-7 right-0 flex items-end">
                {weeks.map((week, index) => {
                  const label = weekLabel(week.week_start);
                  return (
                    <div
                      key={week.week_start}
                      role="img"
                      tabIndex={0}
                      aria-label={`Week of ${label}: ${week.created} created, ${week.resolved} resolved`}
                      onPointerEnter={() => setActive(index)}
                      onPointerLeave={() => setActive(null)}
                      onFocus={() => setActive(index)}
                      onBlur={() => setActive(null)}
                      className="relative flex h-full flex-1 items-end justify-center gap-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    >
                      {WEEK_SERIES.map((series) => (
                        <span
                          key={series.key}
                          aria-hidden="true"
                          className={cn(
                            "w-2 rounded-t-[4px] transition-opacity @[30rem]:w-3",
                            active !== null && active !== index && "opacity-50",
                          )}
                          style={{
                            height: `${(week[series.key] / top) * 100}%`,
                            backgroundColor: `var(${series.color})`,
                          }}
                        />
                      ))}
                      {active === index && (
                        <div
                          aria-hidden="true"
                          className={cn(
                            "pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs",
                            LIQUID_GLASS_FLOAT_CLASS,
                            index === 0
                              ? "left-0"
                              : index === weeks.length - 1
                                ? "right-0"
                                : "left-1/2 -translate-x-1/2",
                          )}
                        >
                          <p className="text-gray-500">Week of {label}</p>
                          {WEEK_SERIES.map((series) => (
                            <p
                              key={series.key}
                              className="mt-0.5 flex items-center gap-1.5"
                            >
                              <span
                                className="h-0.5 w-2.5 rounded-full"
                                style={{
                                  backgroundColor: `var(${series.color})`,
                                }}
                              />
                              <span className="font-semibold text-gray-900">
                                {week[series.key]}
                              </span>
                              <span className="text-gray-500">
                                {series.label.toLowerCase()}
                              </span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div aria-hidden="true" className="ml-7 mt-1.5 flex">
              {weeks.map((week, index) => (
                <span
                  key={week.week_start}
                  className={cn(
                    "flex-1 text-center text-[11px] text-gray-400",
                    // Every other week on a narrow card, so labels never collide.
                    index % 2 === 1 && "invisible @[36rem]:visible",
                  )}
                >
                  {weekLabel(week.week_start)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

const WORKLOAD_CELL_CLASS = cn(
  "py-1.5 transition-colors",
  LIQUID_GLASS_GROUP_HOVER_CLASS,
);

/**
 * Who holds the open requests, busiest first, with one-hue bars for scale.
 * Each row opens that reviewer's outstanding requests.
 */
function Workload({ rows }: { rows: Dashboard["workload"] }) {
  const most = Math.max(1, ...rows.map((row) => row.open));
  return (
    <Card title="Workload">
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No open requests are assigned.
        </p>
      ) : (
        // Rows reach past the card's text edge, so their hover has room at both ends.
        <table className="-mx-2 mt-3 w-[calc(100%+1rem)] text-sm">
          <thead>
            <tr className="text-left text-[11px] font-medium text-gray-400">
              <th scope="col" className="pb-1 pl-2 pr-3 font-medium">
                Reviewer
              </th>
              <th scope="col" className="w-2/5 pb-1 pr-3 font-medium">
                Open
              </th>
              <th scope="col" className="pb-1 pr-3 text-right font-medium">
                Waiting
              </th>
              <th scope="col" className="pb-1 pr-2 text-right font-medium">
                Overdue
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.assignee_id} className="group relative">
                {/* The cells paint the hover, so the row's ends can round. */}
                <td
                  className={cn(WORKLOAD_CELL_CLASS, "rounded-l-md pl-2 pr-3")}
                >
                  {/* The link covers the whole row, so any of it opens the list. */}
                  <Link
                    href={intakeRequestsHref({ assignee: row.assignee_id })}
                    className="flex items-center gap-2 after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-blue-500/40"
                  >
                    <UserAvatar size="md" name={row.name} photo={row.photo} />
                    <span className="min-w-0 text-gray-900 [overflow-wrap:anywhere]">
                      {row.name}
                    </span>
                    <span className="sr-only">. Show their requests.</span>
                  </Link>
                </td>
                <td className={cn(WORKLOAD_CELL_CLASS, "pr-3")}>
                  <span className="flex items-center gap-2">
                    <span className="h-2 flex-1">
                      <span
                        aria-hidden="true"
                        className="block h-full rounded-r-[4px]"
                        style={{
                          width: `${(row.open / most) * 100}%`,
                          backgroundColor: "var(--chart-series-1)",
                        }}
                      />
                    </span>
                    <span className="w-6 text-right tabular-nums text-gray-700">
                      {row.open}
                    </span>
                  </span>
                </td>
                <td
                  className={cn(
                    WORKLOAD_CELL_CLASS,
                    "pr-3 text-right tabular-nums text-gray-700",
                  )}
                >
                  {row.waiting}
                </td>
                <td
                  className={cn(
                    WORKLOAD_CELL_CLASS,
                    "rounded-r-md pr-2 text-right tabular-nums",
                    row.overdue ? "text-red-600" : "text-gray-700",
                  )}
                >
                  {row.overdue}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** The dashboard's layout while it loads. */
function DashboardSkeleton({ personal }: { personal: boolean }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the dashboard"
      className={CARD_STACK_CLASS}
    >
      <div className={tileGridClass(personal)}>
        {Array.from({ length: personal ? 5 : 6 }, (_, index) => (
          <GlassCardUI key={index}>
            <div className="space-y-2.5 p-4">
              <SkeletonLine className="w-16" />
              <SkeletonLine className="h-6 w-10" />
            </div>
          </GlassCardUI>
        ))}
      </div>
      <div className={cn("grid @[52rem]:grid-cols-2", CARD_GAP_CLASS)}>
        {[0, 1].map((card) => (
          <GlassCardUI key={card}>
            <div className="space-y-4 px-5 py-4">
              <SkeletonLine className="w-36" />
              <div className="h-40 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none" />
            </div>
          </GlassCardUI>
        ))}
      </div>
      {!personal && (
        <GlassCardUI>
          <div className="space-y-3 px-5 py-4">
            <SkeletonLine className="w-24" />
            {[0, 1, 2].map((row) => (
              <SkeletonLine key={row} className="w-full" />
            ))}
          </div>
        </GlassCardUI>
      )}
    </div>
  );
}
