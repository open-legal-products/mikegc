"use client";

import type { CSSProperties } from "react";
import {
  DayButton,
  DayPicker,
  useDayPicker,
  type ChevronProps,
  type DayButtonProps,
  type DropdownProps,
  type Matcher,
} from "@daypicker/react";
import calendarStyles from "@daypicker/react/style.module.css";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "@mike/ui";
import { TextButtonUI } from "@mike/ui";
import { cn } from "@/app/lib/utils";

/** A date as YYYY-MM-DD in the browser's timezone. */
export function localDateValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Reads a YYYY-MM-DD value as a local date, or undefined when invalid. */
export function parseDateValue(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isNaN(date.getTime()) && localDateValue(date) === value)
    return date;
}

/**
 * A single-date month calendar in the liquid-glass dropdown style. Place it
 * inside a `DropdownSurface` in a popover.
 */
export function DateCalendar({
  selected,
  defaultMonth,
  startMonth,
  endMonth,
  disabled,
  onSelect,
  fill = false,
}: {
  /** Stretch the month grid to its container instead of the compact width. */
  fill?: boolean;
  selected?: Date;
  defaultMonth?: Date;
  startMonth?: Date;
  endMonth?: Date;
  disabled?: Matcher | Matcher[];
  onSelect: (date: Date) => void;
}) {
  return (
    <DayPicker
      mode="single"
      required
      autoFocus
      selected={selected}
      defaultMonth={defaultMonth ?? selected}
      captionLayout="dropdown"
      navLayout="after"
      reverseYears
      startMonth={startMonth}
      endMonth={endMonth}
      disabled={disabled}
      onSelect={onSelect}
      showOutsideDays
      components={{
        DayButton: CalendarDayButton,
        Chevron: CalendarChevron,
        MonthsDropdown: CalendarMonthDropdown,
        YearsDropdown: CalendarYearDropdown,
      }}
      labels={{
        labelMonthDropdown: () => "Month",
        labelYearDropdown: () => "Year",
      }}
      style={CALENDAR_STYLE}
      classNames={fill ? FILL_CALENDAR_CLASSES : CALENDAR_CLASSES}
    />
  );
}

function CalendarDayButton(props: DayButtonProps) {
  return (
    <DayButton
      {...props}
      data-selected={props.modifiers.selected || undefined}
    />
  );
}

function CalendarMonthDropdown(props: DropdownProps) {
  const { months, goToMonth } = useDayPicker();
  return (
    <CalendarCaptionDropdown
      {...props}
      onValueChange={(month) => {
        goToMonth(new Date(months[0].date.getFullYear(), month, 1));
      }}
    />
  );
}

function CalendarYearDropdown(props: DropdownProps) {
  const { months, goToMonth } = useDayPicker();
  return (
    <CalendarCaptionDropdown
      {...props}
      onValueChange={(year) => {
        goToMonth(new Date(year, months[0].date.getMonth(), 1));
      }}
    />
  );
}

function CalendarCaptionDropdown({
  options,
  value,
  disabled,
  "aria-label": label,
  onValueChange,
}: DropdownProps & { onValueChange: (value: number) => void }) {
  const selected = options?.find((option) => option.value === value);
  return (
    <Dropdown modal={false}>
      <DropdownTrigger asChild>
        <TextButtonUI
          size="xs"
          disabled={disabled}
          aria-label={`${label}: ${selected?.label ?? value}`}
          className="h-7 gap-1 text-xs font-medium text-gray-800"
        >
          {selected?.label}
          <ChevronDown aria-hidden="true" className="h-3 w-3" />
        </TextButtonUI>
      </DropdownTrigger>
      <DropdownContent
        align="start"
        className="max-h-52 min-w-24 overflow-y-auto"
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        {options?.map((option) => (
          <DropdownItem
            key={option.value}
            disabled={option.disabled}
            selected={option.value === value}
            onSelect={() => onValueChange(option.value)}
          >
            {option.label}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

function CalendarChevron({ orientation }: ChevronProps) {
  const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
  return <Icon aria-hidden="true" className="h-4 w-4" />;
}

const CALENDAR_STYLE = {
  "--rdp-accent-color": "var(--foreground)",
  "--rdp-today-color": "var(--foreground)",
  "--rdp-day-height": "2rem",
  "--rdp-day-width": "2rem",
  "--rdp-day_button-height": "1.75rem",
  "--rdp-day_button-width": "1.75rem",
  "--rdp-day_button-border": "0 solid transparent",
  "--rdp-selected-border": "0 solid transparent",
  "--rdp-nav-height": "2rem",
  "--rdp-nav_button-height": "1.5rem",
  "--rdp-nav_button-width": "1.5rem",
  "--rdp-outside-opacity": "0.35",
} as CSSProperties;

const CALENDAR_CLASSES = {
  ...calendarStyles,
  root: cn(calendarStyles.root, "m-0 w-56 text-xs text-gray-700"),
  caption_label: cn(
    calendarStyles.caption_label,
    "!text-xs !font-semibold text-gray-800",
  ),
  month: "w-56",
  month_caption: "flex h-8 items-center justify-start pl-1 pr-12",
  dropdowns: "flex items-center gap-0.5",
  month_grid: cn(calendarStyles.month_grid, "w-56 table-fixed"),
  button_previous: cn(
    calendarStyles.button_previous,
    "theme-dropdown-item rounded-full text-gray-500 focus-visible:ring-2 focus-visible:ring-blue-500/40",
  ),
  button_next: cn(
    calendarStyles.button_next,
    "theme-dropdown-item rounded-full text-gray-500 focus-visible:ring-2 focus-visible:ring-blue-500/40",
  ),
  weekday: cn(
    calendarStyles.weekday,
    "!p-0 !text-[10px] !font-medium text-gray-400",
  ),
  day_button: cn(
    calendarStyles.day_button,
    "theme-dropdown-item text-xs font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
  ),
  selected: cn(calendarStyles.selected, "!text-xs !font-medium text-gray-900"),
};

const FILL_CALENDAR_CLASSES = {
  ...CALENDAR_CLASSES,
  root: cn(calendarStyles.root, "m-0 w-full text-xs text-gray-700"),
  month: "w-full",
  month_grid: cn(calendarStyles.month_grid, "w-full table-fixed"),
};
