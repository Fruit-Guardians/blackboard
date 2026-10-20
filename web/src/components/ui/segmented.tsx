// Segmented control built on Radix ToggleGroup (single, never empty).
import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Segmented<T extends string>({ value, onValueChange, className, ...props }: Omit<React.ComponentProps<typeof ToggleGroupPrimitive.Root>, "type" | "value" | "onValueChange" | "defaultValue"> & { value: T; onValueChange: (value: T) => void }) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      // Radix emits "" when the active item is pressed again; a view is always selected.
      onValueChange={(next) => next && onValueChange(next as T)}
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-secondary p-0.5", className)}
      {...props}
    />
  )
}

function SegmentedItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs [&_svg]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

export { Segmented, SegmentedItem }
