"use client";

import { useState } from "react";
import type { Matcher } from "@daypicker/react";
import { CalendarDays } from "lucide-react";
import { FieldLabel, FormTextInput } from "@/app/components/ui/form-field";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { DropdownSurface } from "@mike/ui";
import {
  DateCalendar,
  localDateValue,
  parseDateValue,
} from "@/app/components/ui/date-calendar";
import { TextButtonUI } from "@mike/ui";

export { localDateValue, parseDateValue as parseHistoryDate };

export function HistoryDatePicker({
  id,
  label,
  value,
  min,
  max,
  disabled,
  errorId,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min?: string;
  max: string;
  disabled: boolean;
  errorId?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const earliest = min ? parseDateValue(min) : undefined;
  const latest = parseDateValue(max) ?? new Date();
  const unavailable: Matcher[] = [{ after: latest }];
  if (earliest) unavailable.push({ before: earliest });

  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <FormTextInput
              id={id}
              type="text"
              placeholder="YYYY-MM-DD"
              maxLength={10}
              className="h-8 min-w-0 rounded-lg pl-2.5 pr-9 text-xs"
              required
              disabled={disabled}
              value={value}
              aria-invalid={Boolean(errorId)}
              aria-describedby={errorId}
              onChange={(event) => onChange(event.target.value)}
            />
            <PopoverTrigger asChild>
              <TextButtonUI
                size="icon-xs"
                aria-label={`${label} calendar`}
                disabled={disabled}
                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
              >
                <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
              </TextButtonUI>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          asChild
          align="start"
          className="rounded-2xl"
          collisionPadding={16}
          aria-label={`${label} calendar`}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <DropdownSurface>
            <DateCalendar
              selected={selected}
              defaultMonth={selected ?? latest}
              startMonth={earliest}
              endMonth={latest}
              disabled={unavailable}
              onSelect={(date) => {
                onChange(localDateValue(date));
                setOpen(false);
              }}
            />
          </DropdownSurface>
        </PopoverContent>
      </Popover>
    </div>
  );
}
