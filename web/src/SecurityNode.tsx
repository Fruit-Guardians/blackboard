import { memo, type CSSProperties } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import {
  Activity, AlertTriangle, CheckCircle2, CircleHelp, Crosshair, FileSearch,
  Flag, Lightbulb, ListChecks, MessageSquareText, Route, ShieldAlert, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CanvasNode } from './graph';
import { typeLabel } from './graph';
import { BaseNode } from './components/react-flow/base-node';
import { detailLevel } from './canvas-state';
import { nodeStateSummary, presentNode, severityLabel } from './presentation';
import { t } from './i18n';

const ICONS = {
  goal: Flag,
  intent: Route,
  hypothesis: Lightbulb,
  question: CircleHelp,
  fact: FileSearch,
  observation: FileSearch,
  action: Crosshair,
  result: CheckCircle2,
  finding: AlertTriangle,
  vuln: ShieldAlert,
  hint: Sparkles,
  summary: ListChecks,
  note: MessageSquareText,
} as const;

export function NodeTypeIcon({ type, size = 13 }: { type: string; size?: number }) {
  const Icon = ICONS[type as keyof typeof ICONS] || Activity;
  return <Icon size={size} strokeWidth={1.7} />;
}

/** The single colour cue for a node kind; everything else stays neutral. */
const DOT_CLASS: Record<string, string> = {
  start: 'bg-node-start', goal: 'bg-node-goal', intent: 'bg-node-intent', hypothesis: 'bg-node-hypothesis',
  question: 'bg-node-question', fact: 'bg-node-fact', observation: 'bg-node-observation', action: 'bg-node-action',
  result: 'bg-node-result', finding: 'bg-node-finding', vuln: 'bg-node-vuln', hint: 'bg-node-hint',
  summary: 'bg-node-summary', note: 'bg-node-note',
};
export function TypeDot({ type, className }: { type: string; className?: string }) {
  return <i className={cn('inline-block size-2 shrink-0 rounded-full', DOT_CLASS[type] || 'bg-node-note', className)} />;
}

const handleClass = 'size-1! min-h-0! min-w-0! border-0! bg-transparent! opacity-0! pointer-events-none!';

export const SecurityNode = memo(function SecurityNode({ data, selected }: NodeProps<CanvasNode>) {
  const { item, current, dimmed, direction, compact, muted, fresh, agents } = data;
  const level = useStore((state) => detailLevel(state.transform[2]));
  const vertical = direction === 'DOWN';
  const text = presentNode(item);
  const severe = item.severity === 'critical' || item.severity === 'high';
  const state = nodeStateSummary(item);
  const overview = level === 'overview';
  // The header that names severity is gone in the overview, so it moves to a badge that survives zooming out.
  const rated = item.severity && item.severity !== 'info' ? severityLabel(item.severity) : '';

  return (
    <BaseNode
      tabIndex={-1}
      style={{ '--c': `var(--node-${item.type in DOT_CLASS ? item.type : 'note'})` } as CSSProperties}
      data-detail-level={level}
      title={t('node.previewHint')}
      aria-label={`${typeLabel(item.type)}：${item.title}${state ? ` · ${state}` : ''}`}
      className={cn(
        'flex flex-col gap-1.5 py-3 pl-4 pr-3.5 text-left',
        // Each kind carries its own hue: a faint wash, a tinted edge and an accent bar.
        'border-[color-mix(in_srgb,var(--c)_24%,var(--line))] bg-[color-mix(in_srgb,var(--c)_7%,var(--surface))]',
        current && 'current-halo',
        current && !selected && 'border-live ring-2 ring-live/60',
        selected && 'ring-1 ring-foreground',
        overview && severe && 'border-destructive/60',
        dimmed && 'opacity-25',
        muted && 'opacity-35',
        fresh && 'fresh-pulse',
      )}
    >
      <i aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full bg-(--c)" />
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className={handleClass} />
      {overview && current && (
        <span className="zoom-chip at-left inline-flex items-center gap-1 rounded-md bg-live px-2 text-[11px] text-white">
          <i className="size-1.5 rounded-full bg-white" />{t('node.current')}
        </span>
      )}
      {overview && rated && (
        <span className={cn('zoom-chip at-right rounded-md border px-2 text-[11px]', severe ? 'border-destructive bg-danger-soft text-destructive' : 'border-border bg-card text-muted-foreground')}>{rated}</span>
      )}
      {!overview && (
        <header className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-[color-mix(in_srgb,var(--c)_78%,var(--ink))]">
            <NodeTypeIcon type={item.type} size={12} />{typeLabel(item.type)}
          </span>
          {current && (
            <span className="ml-1 inline-flex items-center gap-1 text-live">
              <i className="live-dot size-1.5 rounded-full bg-live" />{t('node.current')}
            </span>
          )}
          {agents?.map((agent) => (
            <span key={agent} className="ml-1 inline-flex max-w-24 items-center gap-1 truncate text-subtle" title={t('node.agentHere', { agent })}>
              <i className="size-1.5 shrink-0 rounded-full bg-strong" />{agent}
            </span>
          ))}
          {state && (
            <span title={state} className={cn('ml-auto truncate', severe && 'rounded-sm bg-danger-soft px-1.5 font-medium text-destructive')}>{state}</span>
          )}
        </header>
      )}
      <h3
        title={item.title}
        className={cn(
          'm-0 font-medium text-foreground',
          overview ? (compact ? 'text-[18px] leading-[1.3] line-clamp-3' : 'text-[22px] leading-[1.3] line-clamp-2') : 'text-sm leading-5 line-clamp-2',
        )}
      >
        {overview && <TypeDot type={item.type} className="mr-2 mb-0.5 size-2.5 align-middle" />}
        <span className="mr-1.5 text-[10px] font-normal text-muted-foreground">{t('node.preview')}</span>
        {text.headline}
      </h3>
      {level === 'detail' && !compact && text.summary && (
        <p className="m-0 line-clamp-2 text-xs leading-[18px] text-muted-foreground">{text.summary}</p>
      )}
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className={handleClass} />
    </BaseNode>
  );
});
