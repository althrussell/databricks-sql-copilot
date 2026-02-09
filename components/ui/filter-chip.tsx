"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * FilterChip — outlined with subtle fill on selected.
 * Spec: "Filters: outlined + subtle fill on selected"
 *
 * Use this for: time range toggles, filter pills, tag selectors.
 * Do NOT use for status display (use StatusBadge instead).
 */
interface FilterChipProps extends React.ComponentProps<"button"> {
  selected?: boolean
}

function FilterChip({
  className,
  selected = false,
  ...props
}: FilterChipProps) {
  return (
    <button
      data-slot="filter-chip"
      data-selected={selected || undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-50",
        "cursor-pointer select-none",
        /* Default: outlined, transparent fill */
        "border-border bg-transparent text-foreground",
        "hover:bg-accent hover:text-accent-foreground",
        "active:bg-accent/80",
        /* Selected: subtle primary fill + primary border */
        "data-[selected]:border-primary/40 data-[selected]:bg-primary/10 data-[selected]:text-primary",
        "data-[selected]:hover:bg-primary/15",
        className
      )}
      {...props}
    />
  )
}

export { FilterChip }
