"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarDays } from "lucide-react";
import { format, subDays, startOfDay, endOfDay, setHours, setMinutes } from "date-fns";
import type { DateRange } from "react-day-picker";

// ── Preset definitions ─────────────────────────────────────────────

export interface RangePreset {
  label: string;
  value: string;
  hours: number;
}

export const DEFAULT_PRESETS: RangePreset[] = [
  { label: "1h", value: "1h", hours: 1 },
  { label: "8h", value: "8h", hours: 8 },
  { label: "24h", value: "24h", hours: 24 },
  { label: "7d", value: "7d", hours: 168 },
  { label: "14d", value: "14d", hours: 336 },
];

// ── Props ──────────────────────────────────────────────────────────

interface RangePickerProps {
  /** Currently selected preset value (e.g. "1h") or null if custom */
  activePreset: string | null;
  /** Custom range if active */
  customRange?: { from: string; to: string } | null;
  /** Available presets */
  presets?: RangePreset[];
  /** Called when a preset is selected */
  onPresetChange: (preset: string) => void;
  /** Called when a custom range is applied */
  onCustomRange: (from: Date, to: Date) => void;
  /** Whether to show the billing lag warning */
  showBillingWarning?: boolean;
  /** CSS class */
  className?: string;
}

/**
 * Shared range picker with preset buttons and a custom date/time range popover.
 * Used by both the dashboard and warehouse monitor pages.
 */
export function RangePicker({
  activePreset,
  customRange,
  presets = DEFAULT_PRESETS,
  onPresetChange,
  onCustomRange,
  showBillingWarning = false,
  className,
}: RangePickerProps) {
  const isCustomMode = !activePreset && !!customRange;

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      {presets.map((p) => (
        <Button
          key={p.value}
          variant={activePreset === p.value ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs min-w-[2.5rem]"
          onClick={() => onPresetChange(p.value)}
        >
          {p.label}
        </Button>
      ))}
      <CustomRangePopover
        isActive={isCustomMode}
        customRange={customRange ?? null}
        onApply={onCustomRange}
        showBillingWarning={showBillingWarning}
      />
    </div>
  );
}

// ── Custom range popover ───────────────────────────────────────────

function CustomRangePopover({
  isActive,
  customRange,
  onApply,
  showBillingWarning,
}: {
  isActive: boolean;
  customRange: { from: string; to: string } | null;
  onApply: (from: Date, to: Date) => void;
  showBillingWarning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date();

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (customRange) {
      return {
        from: new Date(customRange.from),
        to: new Date(customRange.to),
      };
    }
    const yesterday = subDays(today, 1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
  });

  const [startTime, setStartTime] = useState(() => {
    if (customRange) return format(new Date(customRange.from), "HH:mm");
    return "09:00";
  });

  const [endTime, setEndTime] = useState(() => {
    if (customRange) return format(new Date(customRange.to), "HH:mm");
    return "17:00";
  });

  const handleApply = useCallback(() => {
    if (!dateRange?.from) return;
    const endDate = dateRange.to ?? dateRange.from;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const from = setMinutes(setHours(dateRange.from, sh), sm);
    const to = setMinutes(setHours(endDate, eh), em);
    if (from >= to) return;
    onApply(from, to);
    setOpen(false);
  }, [dateRange, startTime, endTime, onApply]);

  const triggerLabel =
    isActive && customRange
      ? `${format(new Date(customRange.from), "MMM d, HH:mm")} \u2013 ${format(new Date(customRange.to), "MMM d, HH:mm")}`
      : "Custom";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isActive ? "default" : "outline"}
          size="sm"
          className="h-7 gap-1.5 text-xs"
        >
          <CalendarDays className="h-3 w-3" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs font-medium">Select date range</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Pick start and end dates, then set the time window.
            </p>
          </div>

          <Calendar
            mode="range"
            defaultMonth={dateRange?.from}
            selected={dateRange}
            onSelect={setDateRange}
            numberOfMonths={2}
            disabled={{ after: today, before: subDays(today, 30) }}
            initialFocus
          />

          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">
                Start time
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <span className="text-muted-foreground mt-4">{"\u2013"}</span>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">
                End time
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {showBillingWarning && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Billing data may be incomplete for the last ~6 hours.
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs"
              disabled={!dateRange?.from}
              onClick={handleApply}
            >
              Apply range
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
