// Based on shadcn/ui Dialog (MIT).
import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogTitle = DialogPrimitive.Title
const DialogDescription = DialogPrimitive.Description

function DialogContent({ className, children, position = "center", ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { position?: "center" | "top" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "anim-surface fixed left-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border bg-popover text-popover-foreground shadow-float outline-none",
          position === "center" ? "top-1/2 -translate-y-1/2" : "top-[14vh]",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription }
