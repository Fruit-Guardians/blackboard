import { memo } from 'react';
import { useStore, type NodeProps } from '@xyflow/react';
import { GroupNode } from './components/react-flow/labeled-group-node';
import type { CanvasNode } from './graph';

export const BoardGroup = memo(function BoardGroup({ data }: NodeProps<CanvasNode>) {
  // Keep the frame label legible when the board is zoomed far out.
  const scale = useStore((state) => Math.min(2, Math.max(1, 0.8 / state.transform[2])));
  return (
    <GroupNode
      position="top-left"
      label={
        <span className="flex origin-top-left items-baseline gap-2" style={{ transform: `scale(${scale})` }}>
          <span className="text-[13px] font-medium text-foreground">{data.item.title}</span>
          <span className="tabular-nums text-muted-foreground">{data.groupCount}</span>
          <span className="text-muted-foreground">{data.groupSubtitle}</span>
        </span>
      }
    />
  );
});
