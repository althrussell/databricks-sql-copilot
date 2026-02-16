import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * StatusBadge — solid muted fill, for showing state/status labels.
 * Spec: "Status: solid muted fill + icon optional"
 *
 * Use this for: query status, candidate status, severity indicators.
 * Do NOT use for toggleable filters (use FilterChip instead).
 */
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      status: {
        default: "bg-muted text-muted-foreground",
        success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
        warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
        error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
        info: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
        cached: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
      },
    },
    defaultVariants: {
      status: "default",
    },
  }
)

function StatusBadge({
  className,
  status,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants>) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ status }), className)}
      {...props}
    />
  )
}

export { StatusBadge, statusBadgeVariants }
