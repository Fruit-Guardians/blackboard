import { useEffect, useState, type ReactNode } from 'react';
import { Collapsible } from 'radix-ui';
import { Check, ArrowDownLeft, ArrowUpRight, ChevronRight, Link2, Unlink, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { NodeTypeIcon, TypeDot } from '../SecurityNode';
import { formatTime, relationLabel, typeLabel } from '../graph';
import { confidenceLabel, presentNode, severityLabel, statusLabel } from '../presentation';
import { SeverityBadge } from '../SeverityBadge';
import { removeEdge } from '../api';
import { AddSection, ConnectSection, EditSection } from './EditPanel';
import type { BoardEdge, BoardNode } from '../types';
import { t } from '../i18n';
import { sourceLocation } from '../research-state';
import { NodeHistorySection, type HistoryAvailability } from './HistoryPanel';

type Props = HistoryAvailability & {
  node: BoardNode;
  edges: BoardEdge[];
  byId: Map<string, BoardNode>;
  onClose: () => void;
  onFocus: (id: string) => void;
  onCopyLink?: () => void;
  linkCopied?: boolean;
  /** The server accepts edits from this page. */
  writable?: boolean;
  onReload: () => Promise<void>;
};

export function Inspector({ node, edges, byId, onClose, onFocus, onCopyLink, linkCopied, writable, onReload, isStatic, connected, revision }: Props) {
  const relations = edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  return (
    <aside
      aria-label={t('inspector.label')}
      className="anim-slide-in absolute inset-x-3 bottom-3 top-auto z-20 flex max-h-[62%] flex-col rounded-xl border bg-card shadow-float sm:inset-x-auto sm:right-3 sm:top-3 sm:max-h-none sm:w-[360px]"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3.5">
        <span className="text-muted-foreground"><NodeTypeIcon type={node.type} size={14} /></span>
        <span className="text-[13px] font-medium">{typeLabel(node.type)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={node.id}>{node.id}</span>
        {onCopyLink && <IconButton label={linkCopied ? t('inspector.linkCopied') : t('inspector.copyLink')} onClick={onCopyLink}>{linkCopied ? <Check /> : <Link2 />}</IconButton>}
        <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        <IconButton label={t('inspector.close')} onClick={onClose}><X /></IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <InputIntegrityNotice record={node} />
        <h2 className="m-0 whitespace-pre-wrap text-[17px] font-semibold leading-snug tracking-[-0.01em] [overflow-wrap:anywhere]">{node.title.trim() ? node.title : t('node.untitled')}</h2>
        {node.detail && <p className="mt-2 mb-0 whitespace-pre-wrap text-[13px] leading-[22px] text-subtle [overflow-wrap:anywhere]">{node.detail}</p>}

        <dl className="mt-5 mb-0 divide-y rounded-lg border text-[13px]">
          <Prop label={t('inspector.status')} value={statusLabel(node.status)} />
          <Prop label={t('inspector.risk')} value={node.severity ? <SeverityBadge severity={node.severity} /> : severityLabel(node.severity)} />
          <Prop label={t('inspector.confidence')} value={confidenceLabel(node.confidence)} />
          {typeof node.author === 'string' && node.author && <Prop label={t('inspector.author')} value={node.author === 'human' ? t('inspector.human') : node.author} />}
          <Prop label={t('inspector.created')} value={formatTime(Number(node.ts || 0))} />
          <Prop label={t('inspector.updated')} value={formatTime(Number(node.updated || node.ts || 0))} />
        </dl>

        <SourceSection key={`source-${node.id}`} node={node} />

        <section className="mt-6">
          <h3 className="m-0 mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {t('inspector.relations')}<span className="tabular-nums font-normal">{relations.length}</span>
          </h3>
          {relations.length ? (
            <ul className="m-0 flex list-none flex-col gap-px p-0">
              {relations.map((edge) => {
                const incoming = edge.to === node.id;
                const peer = byId.get(incoming ? edge.from : edge.to);
                const Arrow = incoming ? ArrowDownLeft : ArrowUpRight;
                return (
                  <li key={edge.id} className="group/row relative">
                    <button
                      onClick={() => peer && onFocus(peer.id)}
                      className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                    >
                      <Arrow className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label={incoming ? t('inspector.from') : t('inspector.to')} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                          {relationLabel(edge.kind)}
                          {peer && <><span aria-hidden>·</span><TypeDot type={peer.type} className="size-1.5" />{typeLabel(peer.type)}</>}
                        </span>
                        <span className="line-clamp-2 text-[13px] leading-5">{peer ? presentNode(peer).headline : incoming ? edge.from : edge.to}</span>
                      </span>
                      <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                    {edge.label && <p className="m-0 ml-7 pb-1.5 whitespace-pre-wrap text-xs leading-5 text-subtle [overflow-wrap:anywhere]">{edge.label}</p>}
                    {edge.inputTruncation && <div className="ml-7"><InputIntegrityNotice record={edge} /></div>}
                    {writable && (
                      <span className="absolute right-1 top-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
                        <IconButton label={t('inspector.unlink')} onClick={() => { removeEdge(edge.id).catch((e) => { window.alert(t('inspector.unlinkFailed', { error: e instanceof Error ? e.message : String(e) })); }); }}><Unlink /></IconButton>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">{t('inspector.noRelations')}</p>
          )}
        </section>

        {writable && <ConnectSection key={`connect-${node.id}`} node={node} byId={byId} onReload={onReload} />}
        <NodeHistorySection key={`history-${node.id}`} nodeId={node.id} isStatic={isStatic} connected={connected} revision={revision} />

        {writable && <AddSection key={`add-${node.id}`} node={node} />}
        {writable && <EditSection key={`edit-${node.id}`} node={node} onReload={onReload} />}

        <Collapsible.Root key={node.id} className="mt-6">
          <Collapsible.Trigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />{t('inspector.raw')}
          </Collapsible.Trigger>
          <Collapsible.Content>
            <pre className="mt-2 mb-0 max-h-64 overflow-auto rounded-lg border bg-secondary p-3 font-mono text-[11px] leading-[18px] text-subtle">{JSON.stringify(node, null, 2)}</pre>
          </Collapsible.Content>
        </Collapsible.Root>
      </div>
    </aside>
  );
}

/** Describe recorded input loss, without judging the claim or reconstructing missing text. */
function InputIntegrityNotice({ record }: { record: Pick<BoardNode, 'inputTruncation'> }) {
  const entries = Object.entries(record.inputTruncation || {}).filter(([, value]) => value && Number.isSafeInteger(value.originalLength) && Number.isSafeInteger(value.storedLength) && value.originalLength > value.storedLength && value.storedLength >= 0);
  if (!entries.length) return null;
  const fieldLabels: Record<string, string> = { title: t('edit.title'), detail: t('edit.detail'), label: t('inspector.relationLabel') };
  return <section role="note" aria-label={t('inspector.inputTruncated')} className="mb-3 rounded-lg border bg-secondary/50 p-3 text-xs leading-5 text-foreground">
    <p className="m-0">{t('inspector.inputTruncated')}</p>
    <ul className="m-0 mt-1 list-inside list-disc p-0">{entries.map(([field, value]) => <li key={field}>{t('inspector.inputLengths', { field: fieldLabels[field] || field, original: value.originalLength, stored: value.storedLength })}</li>)}</ul>
  </section>;
}

function Prop({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}


function SourceSection({ node }: { node: BoardNode }) {
  const location = sourceLocation(node);
  const tags = Array.isArray(node.tags) ? node.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  if (!location && !tags.length && !node.session && !node.updatedBy) return null;
  return <section className="mt-5 flex flex-col gap-2" aria-label={t('source.heading')}>
    <h3 className="m-0 text-xs font-medium text-muted-foreground">{t('source.heading')}</h3>
    {location && <div className="flex items-start gap-2 rounded-md border bg-secondary/30 p-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[11px]" aria-label={t('source.location')}>{location}</code>
      <IconButton label={copied ? t('common.copied') : t('source.copy')} onClick={async () => { try { await navigator.clipboard.writeText(location); setCopied(true); setError(''); } catch { setError(t('app.clipboardFailed')); } }}>{copied ? <Check /> : <Link2 />}</IconButton>
    </div>}
    {tags.length > 0 && <div aria-label={t('source.tags')} className="flex flex-wrap gap-1">{tags.map((tag, i) => <span key={`${tag}-${i}`} className="max-w-full rounded border px-1.5 py-0.5 text-[11px] text-subtle [overflow-wrap:anywhere]">{tag}</span>)}</div>}
    {typeof node.session === 'string' && node.session && <p className="m-0 break-all text-[11px] text-muted-foreground">{t('source.session')} · {node.session}</p>}
    {typeof node.updatedBy === 'string' && node.updatedBy && <p className="m-0 break-all text-[11px] text-muted-foreground">{t('source.updatedBy')} · {node.updatedBy}</p>}
    {error && <p role="alert" className="m-0 text-xs text-destructive">{error}</p>}
  </section>;
}
