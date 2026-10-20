import { AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Crosshair, CornerDownRight, Map as MapIcon, ImageDown, Maximize2, Minus, Plus, Palette, Radio, Slash, Spline } from 'lucide-react';
import { Panel, useReactFlow, useStore, useViewport } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { IconButton } from '@/components/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import type { EdgeStyle } from '../graph';

type Props = {
  hasCurrent: boolean;
  canFollow: boolean;
  canExport: boolean;
  onExport: () => void;
  grouped: boolean;
  direction: 'RIGHT' | 'DOWN';
  showMap: boolean;
  follow: boolean;
  onToggleFollow: () => void;
  motion: number;
  onLocate: () => void;
  onDirection: () => void;
  onToggleMap: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
  edgeStyle: EdgeStyle;
  onEdgeStyle: (style: EdgeStyle) => void;
};

/** One floating toolbar: framing, layout, and zoom live together. */
export function CanvasToolbar({ hasCurrent, canFollow, canExport, onExport, grouped, direction, showMap, follow, motion, onLocate, onDirection, onToggleMap, onToggleFollow, edgeStyle, onEdgeStyle, showLegend, onToggleLegend }: Props) {
  const { zoom } = useViewport();
  const { zoomTo, zoomIn, zoomOut, fitView } = useReactFlow();
  const minZoom = useStore((state) => state.minZoom);
  const maxZoom = useStore((state) => state.maxZoom);
  const EdgeIcon = edgeStyle === 'curve' ? Spline : edgeStyle === 'step' ? CornerDownRight : Slash;
  const Direction = direction === 'RIGHT' ? AlignHorizontalSpaceAround : AlignVerticalSpaceAround;
  return (
    <Panel position="bottom-left" className="m-3!">
      <div className="flex items-center gap-0.5 rounded-xl border bg-card p-1 shadow-float">
        <IconButton label="适应画布" onClick={() => fitView({ padding: 0.14, duration: motion })}><Maximize2 /></IconButton>
        {hasCurrent && <IconButton label="定位当前节点" onClick={onLocate}><Crosshair /></IconButton>}
        {hasCurrent && canFollow && (
          <IconButton
            label={grouped ? '跟随 Agent（全局视图下不可用）' : follow ? '停止跟随 Agent' : '跟随 Agent 游标'}
            aria-pressed={follow && !grouped}
            disabled={grouped}
            onClick={onToggleFollow}
          >
            <Radio />
          </IconButton>
        )}
        {!grouped && <IconButton label={direction === 'RIGHT' ? '切换为纵向布局' : '切换为横向布局'} onClick={onDirection}><Direction /></IconButton>}
        <IconButton className="max-sm:hidden" label={showLegend ? '隐藏图例' : '显示图例'} aria-pressed={showLegend} onClick={onToggleLegend}><Palette /></IconButton>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon-sm" aria-label="连线样式" title="连线样式"><EdgeIcon /></Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={10} className="w-auto p-2">
            <p className="m-0 mb-1.5 px-1 text-xs font-medium text-muted-foreground">连线样式</p>
            <Segmented<EdgeStyle> value={edgeStyle} onValueChange={onEdgeStyle} aria-label="连线样式">
              <SegmentedItem value="curve"><Spline />曲线</SegmentedItem>
              <SegmentedItem value="step"><CornerDownRight />折线</SegmentedItem>
              <SegmentedItem value="straight"><Slash />直线</SegmentedItem>
            </Segmented>
          </PopoverContent>
        </Popover>
        {canExport && <IconButton label="导出为图片" onClick={onExport}><ImageDown /></IconButton>}
        <IconButton label={showMap ? '隐藏小地图' : '显示小地图'} aria-pressed={showMap} onClick={onToggleMap}><MapIcon /></IconButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <IconButton label="缩小" onClick={() => zoomOut({ duration: motion })}><Minus /></IconButton>
        <Slider
          aria-label="画布缩放"
          className="w-20 max-sm:hidden"
          value={[zoom]}
          min={minZoom}
          max={maxZoom}
          step={0.01}
          onValueChange={(next) => zoomTo(next[0])}
        />
        <IconButton label="放大" onClick={() => zoomIn({ duration: motion })}><Plus /></IconButton>
        <Button size="sm" className="w-12 tabular-nums text-muted-foreground" aria-label="重置为 100% 缩放" onClick={() => zoomTo(1, { duration: motion })}>
          {Math.round(zoom * 100)}%
        </Button>
      </div>
    </Panel>
  );
}
