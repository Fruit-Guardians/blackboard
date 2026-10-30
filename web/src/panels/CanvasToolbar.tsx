import { AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Crosshair, CornerDownRight, Map as MapIcon, ImageDown, Maximize2, Minus, Plus, Palette, Radio, Slash, Spline } from 'lucide-react';
import { Panel, useReactFlow, useStore, useViewport } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { IconButton } from '@/components/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import type { EdgeStyle } from '../graph';
import { t } from '../i18n';

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
      <div className="flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-0.5 rounded-xl border bg-card p-1 shadow-float">
        <IconButton label={t('toolbar.fit')} onClick={() => fitView({ padding: 0.14, duration: motion })}><Maximize2 /></IconButton>
        {hasCurrent && <IconButton label={t('toolbar.locate')} onClick={onLocate}><Crosshair /></IconButton>}
        {hasCurrent && canFollow && (
          <IconButton
            label={grouped ? t('toolbar.followDisabled') : follow ? t('toolbar.unfollow') : t('toolbar.follow')}
            aria-pressed={follow && !grouped}
            disabled={grouped}
            onClick={onToggleFollow}
          >
            <Radio />
          </IconButton>
        )}
        {!grouped && <IconButton label={direction === 'RIGHT' ? t('toolbar.toVertical') : t('toolbar.toHorizontal')} onClick={onDirection}><Direction /></IconButton>}
        <IconButton className="max-sm:hidden" label={showLegend ? t('toolbar.hideLegend') : t('toolbar.showLegend')} aria-pressed={showLegend} onClick={onToggleLegend}><Palette /></IconButton>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon-sm" aria-label={t('toolbar.edgeStyle')} title={t('toolbar.edgeStyle')}><EdgeIcon /></Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={10} className="w-auto p-2">
            <p className="m-0 mb-1.5 px-1 text-xs font-medium text-muted-foreground">{t('toolbar.edgeStyle')}</p>
            <Segmented<EdgeStyle> value={edgeStyle} onValueChange={onEdgeStyle} aria-label={t('toolbar.edgeStyle')}>
              <SegmentedItem value="curve"><Spline />{t('toolbar.curve')}</SegmentedItem>
              <SegmentedItem value="step"><CornerDownRight />{t('toolbar.step')}</SegmentedItem>
              <SegmentedItem value="straight"><Slash />{t('toolbar.straight')}</SegmentedItem>
            </Segmented>
          </PopoverContent>
        </Popover>
        {canExport && <IconButton label={t('toolbar.export')} onClick={onExport}><ImageDown /></IconButton>}
        <IconButton label={showMap ? t('toolbar.hideMap') : t('toolbar.showMap')} aria-pressed={showMap} onClick={onToggleMap}><MapIcon /></IconButton>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
          <IconButton label={t('toolbar.zoomOut')} onClick={() => zoomOut({ duration: motion })}><Minus /></IconButton>
          <Slider
            aria-label={t('toolbar.zoom')}
            className="w-20 max-sm:hidden"
            value={[zoom]}
            min={minZoom}
            max={maxZoom}
            step={0.01}
            onValueChange={(next) => zoomTo(next[0])}
          />
          <IconButton label={t('toolbar.zoomIn')} onClick={() => zoomIn({ duration: motion })}><Plus /></IconButton>
          <Button size="sm" className="w-12 tabular-nums text-muted-foreground" aria-label={t('toolbar.zoomReset')} onClick={() => zoomTo(1, { duration: motion })}>
            {Math.round(zoom * 100)}%
          </Button>
        </div>
      </div>
    </Panel>
  );
}
