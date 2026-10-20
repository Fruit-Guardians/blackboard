import * as React from "react"
import { cn } from "@/lib/utils"

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded border bg-secondary px-1 font-sans text-[11px] font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}
