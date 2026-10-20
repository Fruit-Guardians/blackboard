// Adapted from https://ui.reactflow.dev/base-node (xyflow, MIT).
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function BaseNode({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative h-full w-full rounded-lg border bg-card text-card-foreground shadow-xs transition-[border-color,box-shadow,opacity]",
        "hover:border-strong",
        // React Flow adds `selected` to the wrapping `.react-flow__node`.
        "in-[.selected]:border-foreground in-[.selected]:shadow-md",
        className,
      )}
      {...props}
    />
  );
}

export function BaseNodeHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      {...props}
      className={cn("flex flex-row items-center justify-between gap-2", className)}
    />
  );
}

export function BaseNodeContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="base-node-content"
      className={cn("flex flex-col gap-y-1.5", className)}
      {...props}
    />
  );
}
