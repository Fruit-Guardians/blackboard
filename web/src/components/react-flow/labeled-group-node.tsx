// Adapted from https://ui.reactflow.dev/labeled-group-node (xyflow, MIT).
import { type ReactNode, type ComponentProps } from "react";
import { Panel, type NodeProps, type PanelPosition } from "@xyflow/react";

import { BaseNode } from "@/components/react-flow/base-node";
import { cn } from "@/lib/utils";

export function GroupNodeLabel({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div className="h-full w-full" {...props}>
      <div className={cn("w-fit px-5 pt-4 text-xs text-card-foreground", className)}>{children}</div>
    </div>
  );
}

export type GroupNodeProps = Partial<NodeProps> & {
  label?: ReactNode;
  position?: PanelPosition;
};

export function GroupNode({ label, position, ...props }: GroupNodeProps) {
  return (
    <BaseNode
      tabIndex={-1}
      className="overflow-hidden rounded-2xl border-dashed bg-secondary/40 shadow-none hover:border-border"
      {...props}
    >
      <Panel className="m-0 p-0" position={position}>
        {label && <GroupNodeLabel>{label}</GroupNodeLabel>}
      </Panel>
    </BaseNode>
  );
}
