import { useMemo, useState, type ReactNode } from 'react';
import { Check, CircleDot, Clock, Copy, Crosshair, FileText, Flag, Footprints, GitBranch, History, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { TypeDot } from '../SecurityNode';
import { inlineRuns, leadingId, parseCheckpoint, parseDigest, parseNodeLine, parseRelationLine, parseTrail, type DigestItem, type DigestSection } from '../digest-parse';
import { presentNode, typeLabel } from '../presentation';
import type { BoardNode, GraphSnapshot } from '../types';
import { CheckpointChangesSection, type HistoryAvailability } from './HistoryPanel';
import { digestTerm, locale, t, tOptional } from '../i18n';

type Props = HistoryAvailability & {
  checkpoints: GraphSnapshot['checkpoints'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  digest: string;
  agentId: string;
  copied: boolean;
  onCopy: () => void;
  returnFocus: React.RefObject<HTMLButtonElement | null>;
  byId: Map<string, BoardNode>;
  /** Jump to a node on the canvas; the dialog closes first. */
  onFocus: (id: string) => void;
};

/** Keyed by the headings the digest is generated with, which are always Chinese. */
const SECTION_ICON: Record<string, typeof Crosshair> = {
  当前节点: Crosshair, 当前邻域: Share2, 最近活跃节点: Clock, 相关关系: GitBranch,
  最近轨迹: Footprints, 开放节点: CircleDot, 最近检查点: Flag, 最近逻辑节点: History,
};

export function DigestDialog({ open, onOpenChange, digest, agentId, copied, onCopy, returnFocus, byId, onFocus, checkpoints, isStatic, connected, revision }: Props) {
  const [view, setView] = useState<'formatted' | 'raw'>('formatted');
  const parsed = useMemo(() => parseDigest(digest), [digest]);
  const jump = (id: string) => { onOpenChange(false); onFocus(id); };
  const filled = parsed.sections.filter((section) => section.items.length);
  const empty = parsed.sections.filter((section) => !section.items.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[84vh] max-w-[680px] flex-col"
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="m-0 text-[15px] font-semibold">{t('digest.title')}</DialogTitle>
            <DialogDescription className="m-0 mt-0.5 text-xs text-muted-foreground">{t('digest.description')}</DialogDescription>
            <p className="m-0 mt-1 break-all font-mono text-[11px] text-muted-foreground">{agentId}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Segmented<'formatted' | 'raw'> value={view} onValueChange={setView} aria-label={t('digest.viewLabel')}>
              <SegmentedItem value="formatted">{t('digest.formatted')}</SegmentedItem>
              <SegmentedItem value="raw"><FileText />{t('digest.raw')}</SegmentedItem>
            </Segmented>
            <DialogClose asChild><Button size="icon-sm" aria-label={t('digest.close')}><X /></Button></DialogClose>
          </div>
        </header>

        {view === 'raw' ? (
          <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-5 text-subtle">{digest || t('digest.none')}</pre>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {parsed.stats.length > 0 && (
              <dl className="m-0 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {parsed.stats.map((stat) => (
                  <div key={stat.label} className="rounded-lg border bg-secondary/40 px-3 py-2">
                    <dd className={cn('m-0 text-lg font-semibold tabular-nums leading-6', !stat.value && 'text-muted-foreground')}>{stat.value}</dd>
                    <dt className="text-[11px] text-muted-foreground">{digestTerm(stat.label)}</dt>
                  </div>
                ))}
              </dl>
            )}
            {parsed.intro.map((line, i) => <p key={i} className="mt-3 mb-0 text-[13px] text-subtle"><Inline text={line} byId={byId} onFocus={jump} /></p>)}

            <CheckpointChangesSection checkpoints={checkpoints} byId={byId} onFocus={jump} isStatic={isStatic} connected={connected} revision={revision} />

            {filled.map((section) => <Section key={section.title} section={section} byId={byId} onFocus={jump} />)}

            {empty.length > 0 && (
              <section className="mt-5 rounded-lg border border-dashed px-3 py-2.5" aria-label={t('digest.emptySections')}>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {empty.map((section) => {
                    const Icon = SECTION_ICON[section.title] || CircleDot;
                    return (
                      <li key={section.title} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                        <Icon className="mt-0.5 size-3.5 shrink-0" />
                        <span className="shrink-0 font-medium text-subtle">{digestTerm(section.title)}</span>
                        <span className="min-w-0"><Inline text={section.notes.join(' ') || t('digest.nothing')} byId={byId} onFocus={jump} /></span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {!digest && <p className="m-0 text-[13px] text-muted-foreground">{t('digest.none')}</p>}
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">{locale === 'zh-CN' && parsed.footer ? parsed.footer : t('digest.footer')}</span>
          <Button variant="outline" size="sm" onClick={onCopy}>{copied ? <Check /> : <Copy />}{copied ? t('common.copied') : t('digest.copy')}</Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

type Nav = { byId: Map<string, BoardNode>; onFocus: (id: string) => void };

function Section({ section, byId, onFocus }: { section: DigestSection } & Nav) {
  const Icon = SECTION_ICON[section.title] || CircleDot;
  const hero = section.title === '当前节点';
  return (
    <section className="mt-5">
      <h3 className="m-0 mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />{digestTerm(section.title)}
        {!hero && <span className="font-normal tabular-nums">{section.items.length}</span>}
      </h3>
      <ul className={cn('m-0 flex list-none flex-col p-0', hero ? 'gap-2' : 'gap-px')}>
        {section.items.map((item, i) => <li key={i}><Item item={item} hero={hero} byId={byId} onFocus={onFocus} /></li>)}
      </ul>
      {section.notes.map((note, i) => <p key={i} className="mt-1.5 mb-0 text-xs text-muted-foreground"><Inline text={note} byId={byId} onFocus={onFocus} /></p>)}
    </section>
  );
}

function Item({ item, hero, byId, onFocus }: { item: DigestItem; hero?: boolean } & Nav) {
  const relation = parseRelationLine(item.text);
  if (relation) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px]">
        <Side text={relation.from} byId={byId} onFocus={onFocus} />
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="h-px w-3 bg-strong" />{digestTerm(relation.relation)}<span aria-hidden>→</span>
        </span>
        <Side text={relation.to} byId={byId} onFocus={onFocus} />
      </div>
    );
  }
  const trail = parseTrail(item.text);
  if (trail) {
    return (
      <div className="px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {trail.map((id, i) => <span key={i} className="inline-flex items-center gap-1">{i > 0 && <span className="text-muted-foreground" aria-hidden>→</span>}<Ref id={id} byId={byId} onFocus={onFocus} /></span>)}
        </div>
        {item.children.length > 0 && (
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
            {item.children.map((child, i) => {
              const m = /^(\d\d-\d\d \d\d:\d\d)\s+→\s+(\S+?)：(.*)$/.exec(child);
              return (
                <li key={i} className="flex items-baseline gap-2 text-xs leading-5 text-subtle">
                  {m ? <><span className="shrink-0 font-mono text-[11px] text-muted-foreground">{m[1]}</span><Ref id={m[2]} byId={byId} onFocus={onFocus} /><span className="min-w-0">{m[3]}</span></> : <Inline text={child} byId={byId} onFocus={onFocus} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }
  const checkpoint = parseCheckpoint(item.text);
  if (checkpoint) {
    return (
      <div className="flex flex-col gap-1 px-2 py-1.5">
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{checkpoint.time}</span>
          {checkpoint.at && <Ref id={checkpoint.at} byId={byId} onFocus={onFocus} />}
          <span className="ml-auto font-mono">{checkpoint.id}</span>
        </span>
        <span className="text-[13px] leading-5 text-foreground">{checkpoint.summary}</span>
      </div>
    );
  }
  const node = parseNodeLine(item.text);
  if (node) {
    const known = byId.get(node.id);
    const [type, ...states] = node.meta;
    return (
      <button
        onClick={() => known && onFocus(node.id)}
        disabled={!known}
        className={cn(
          'group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors enabled:hover:bg-accent disabled:cursor-default',
          hero && 'rounded-lg border border-live/40 bg-live/5 px-3 py-2.5',
        )}
      >
        <span className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <TypeDot type={known?.type || 'note'} className="size-1.5" />
          <span>{known ? typeLabel(known.type) : digestTerm(type)}</span>
          {states.map((state) => <span key={state} className="rounded-sm bg-secondary px-1 text-subtle">{tOptional(`status.${state}`) || digestTerm(state)}</span>)}
          <span className="ml-auto font-mono">{node.id}</span>
        </span>
        <span className={cn('text-[13px] leading-5 text-foreground', hero && 'text-sm font-medium')}>{node.title}</span>
        {node.location && <span className="font-mono text-[11px] text-muted-foreground">{node.location}</span>}
        {item.children.map((child, i) => <span key={i} className="line-clamp-2 text-xs leading-5 text-subtle">{child}</span>)}
      </button>
    );
  }
  return (
    <div className="px-2 py-1.5 text-[13px] leading-5">
      <Inline text={item.text} byId={byId} onFocus={onFocus} />
      {item.children.map((child, i) => <div key={i} className="text-xs text-subtle"><Inline text={child} byId={byId} onFocus={onFocus} /></div>)}
    </div>
  );
}

/** One end of a relation: a bare reference, or a full node line shown as its reference. */
function Side({ text, byId, onFocus }: { text: string } & Nav) {
  const id = leadingId(text);
  if (!id) return <span>{text}</span>;
  return <Ref id={id} byId={byId} onFocus={onFocus} fallback={parseNodeLine(text)?.title} wide />;
}

function Ref({ id, byId, onFocus, fallback, wide }: { id: string; fallback?: string; wide?: boolean } & Nav) {
  const node = byId.get(id);
  const title = node ? presentNode(node).headline : fallback;
  const body: ReactNode = (
    <>
      {node && <TypeDot type={node.type} className="size-1.5" />}
      <span className="font-mono text-[11px] text-muted-foreground">{id}</span>
      {title && <span className={cn('truncate', wide ? 'max-w-[220px]' : 'max-w-[140px]')}>{title}</span>}
    </>
  );
  const chip = 'inline-flex max-w-full items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 align-middle text-xs';
  return node
    ? <button className={cn(chip, 'transition-colors hover:border-strong hover:bg-accent')} title={node.title} onClick={() => onFocus(id)}>{body}</button>
    : <span className={cn(chip, 'text-muted-foreground')}>{body}</span>;
}

function Inline({ text, byId, onFocus }: { text: string } & Nav) {
  return (
    <>
      {inlineRuns(text).map((run, i) => run.kind === 'code'
        ? <code key={i} className="rounded bg-secondary px-1 py-px font-mono text-[11px] text-foreground">{run.value}</code>
        : run.kind === 'ref' && byId.has(run.value)
          ? <Ref key={i} id={run.value} byId={byId} onFocus={onFocus} />
          : <span key={i}>{run.kind === 'ref' ? `[${run.value}]` : run.value}</span>)}
    </>
  );
}
