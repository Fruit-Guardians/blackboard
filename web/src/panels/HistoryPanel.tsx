import { useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCheckpointChanges, getNodeHistory } from '../api';
import { formatTime, relationLabel } from '../graph';
import { historyValue } from '../research-state';
import type { BoardEdge, BoardNode, CheckpointChanges, FieldChange, GraphSnapshot, HistoryIntegrity, NodeHistory } from '../types';
import { t } from '../i18n';

function useProjection<T>(key: string, enabled: boolean, revision: unknown, read: (key: string) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string; loading: boolean }>({ key, loading: false });
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    setState({ key, loading: true });
    read(key).then((data) => { if (alive) setState({ key, data, loading: false }); })
      .catch((e) => { if (alive) setState({ key, error: e instanceof Error ? e.message : String(e), loading: false }); });
    return () => { alive = false; };
  }, [key, enabled, revision, read, attempt]);
  // Never render a previous node/checkpoint's history under the newly selected identity.
  return { ...(state.key === key ? state : { key, loading: enabled }), refresh: () => setAttempt((n) => n + 1) };
}

export function IntegrityNote({ integrity }: { integrity?: HistoryIntegrity }) {
  if (!integrity || !Object.values(integrity).some((n) => n > 0)) return null;
  return <p role="status" className="m-0 rounded-md border border-dashed p-2 text-xs text-muted-foreground">{t('history.integrity', { corrupt: integrity.corruptLines, future: integrity.futureEvents, unknown: integrity.unknownOps, rejected: integrity.rejected })}</p>;
}

export function FieldChanges({ changes }: { changes: Record<string, FieldChange> }) {
  return <dl className="m-0 space-y-2">
    {Object.entries(changes).map(([field, value]) => <div key={field} className="min-w-0 rounded-md border bg-secondary/30 p-2">
      <dt className="mb-1 font-mono text-[11px] text-muted-foreground">{field}</dt>
      <dd className="m-0 grid min-w-0 grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <span className="text-muted-foreground">{t('history.before')}</span><pre className="m-0 min-w-0 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono">{historyValue(value.before)}</pre>
        <span className="text-muted-foreground">{t('history.after')}</span><pre className="m-0 min-w-0 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono">{historyValue(value.after)}</pre>
      </dd>
    </div>)}
  </dl>;
}

function Relations({ edges, label }: { edges: BoardEdge[]; label: string }) {
  if (!edges.length) return null;
  return <section className="mt-2"><h5 className="m-0 mb-1 text-xs font-medium">{label} · {edges.length}</h5>
    <ul className="m-0 list-none space-y-1 p-0">{edges.map((edge) => <li key={edge.id} className="break-words font-mono text-xs text-subtle">{edge.from} — {relationLabel(edge.kind)} → {edge.to} <span className="text-muted-foreground">({edge.id})</span></li>)}</ul>
  </section>;
}

export type HistoryAvailability = { isStatic: boolean; connected: boolean; revision?: unknown };
const unavailable = (isStatic: boolean) => t(isStatic ? 'history.offline' : 'history.disconnected');

export function NodeHistorySection({ nodeId, isStatic, connected, revision }: { nodeId: string } & HistoryAvailability) {
  const [open, setOpen] = useState(false);
  const available = !isStatic && connected;
  const result = useProjection<NodeHistory>(nodeId, open && available, revision, getNodeHistory);
  return <section className="mt-6 min-w-0 flex flex-col gap-2 border-t pt-4 [overflow-wrap:anywhere]" aria-label={t('history.heading')}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="m-0 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><History className="size-3.5" />{t('history.heading')}</h3>
      {available && <Button size="sm" disabled={result.loading} onClick={() => { if (open) result.refresh(); else setOpen(true); }}>{open ? <RefreshCw className="size-3" /> : null}{t(open ? 'history.refresh' : 'history.load')}</Button>}
    </div>
    {!available ? <p className="m-0 text-xs text-muted-foreground">{unavailable(isStatic)}</p> : open && <>
      <p className="m-0 text-[11px] text-muted-foreground">{t('history.readOnly')}</p>
      {result.loading && <p role="status" className="m-0 text-xs text-muted-foreground">{t('history.loading')}</p>}
      {result.error && <p role="alert" className="m-0 text-xs text-destructive">{result.error}</p>}
      {result.data && <>
        <IntegrityNote integrity={result.data.integrity} />
        {!result.data.entries.length && <p className="m-0 text-xs text-muted-foreground">{t('history.empty')}</p>}
        {[...result.data.entries].reverse().map((entry) => <details key={entry.index} className="rounded-md border p-2">
          <summary className="cursor-pointer text-xs"><span className="font-mono">#{entry.index} {entry.op}</span> · {formatTime(entry.at ?? undefined)}<span className="block break-all pt-1 text-[11px] text-muted-foreground">{entry.by || t('history.actorUnknown')}</span></summary>
          <div className="mt-2 space-y-2">
            {entry.eventId && <p className="m-0 break-all font-mono text-[11px] text-muted-foreground">{entry.eventId}</p>}
            {entry.reason && <p className="m-0 whitespace-pre-wrap text-xs">{entry.reason}</p>}
            <FieldChanges changes={entry.changes} />
            <Relations edges={entry.edges.added} label={t('changes.edgesAdded')} /><Relations edges={entry.edges.removed} label={t('changes.edgesRemoved')} />
          </div>
        </details>)}
      </>}
    </>}
  </section>;
}

function NodeList({ nodes, title, byId, onFocus }: { nodes: BoardNode[]; title: string; byId: Map<string, BoardNode>; onFocus: (id: string) => void }) {
  return <section><h4 className="m-0 mb-1 text-xs font-medium">{title} · {nodes.length}</h4><ul className="m-0 list-none space-y-1 p-0">{nodes.map((node) => <li key={node.id}>
    {byId.has(node.id) ? <button className="text-left text-xs underline decoration-border underline-offset-2 hover:text-muted-foreground" onClick={() => onFocus(node.id)}>{node.id} · {node.title}</button> : <span className="text-xs">{node.id} · {node.title}</span>}
    <details className="mt-1 text-[11px] text-muted-foreground"><summary className="cursor-pointer">{t('inspector.raw')}</summary><pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(node, null, 2)}</pre></details>
  </li>)}</ul></section>;
}

export function CheckpointChangesSection({ checkpoints, byId, onFocus, isStatic, connected, revision }: { checkpoints: GraphSnapshot['checkpoints']; byId: Map<string, BoardNode>; onFocus: (id: string) => void } & HistoryAvailability) {
  const [checkpointId, setCheckpointId] = useState('');
  const options = Object.entries(checkpoints || {}).sort((a, b) => Number(b[1].at || 0) - Number(a[1].at || 0));
  const available = !isStatic && connected;
  const result = useProjection<CheckpointChanges>(checkpointId, available, revision, getCheckpointChanges);
  return <section className="mt-5 min-w-0 flex flex-col gap-3 rounded-lg border p-3 [overflow-wrap:anywhere]" aria-label={t('changes.heading')}>
    <h3 className="m-0 flex items-center gap-1.5 text-xs font-medium"><History className="size-3.5" />{t('changes.heading')}</h3>
    <p className="m-0 text-[11px] text-muted-foreground">{t('history.readOnly')}</p>
    {!available ? <p className="m-0 text-xs text-muted-foreground">{unavailable(isStatic)}</p> : <>
      {!options.length ? <p className="m-0 text-xs text-muted-foreground">{t('changes.none')}</p> : <div className="flex items-center gap-2">
        <select aria-label={t('changes.select')} className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-xs" value={checkpointId} onChange={(e) => setCheckpointId(e.target.value)}>
          <option value="">{t('changes.select')}</option>
          {options.map(([id, checkpoint]) => <option key={id} value={id}>{id} · {formatTime(Number(checkpoint.at || 0))} · {checkpoint.agentId || ''} · {String(checkpoint.summary || '')}</option>)}
        </select>
        <Button size="icon-sm" aria-label={t('changes.refresh')} disabled={!checkpointId || result.loading} onClick={result.refresh}><RefreshCw className="size-3.5" /></Button>
      </div>}
      {result.loading && checkpointId && <p role="status" className="m-0 text-xs text-muted-foreground">{t('history.loading')}</p>}
      {result.error && checkpointId && <p role="alert" className="m-0 text-xs text-destructive">{result.error}</p>}
      {result.data && checkpointId && <>
        <p className="m-0 whitespace-pre-wrap text-[13px]">{result.data.since.summary}</p>
        <IntegrityNote integrity={result.data.integrity} />
        <NodeList nodes={result.data.nodes.added} title={t('changes.nodesAdded')} byId={byId} onFocus={onFocus} />
        <section><h4 className="m-0 mb-1 text-xs font-medium">{t('changes.nodesUpdated')} · {result.data.nodes.updated.length}</h4>
          {result.data.nodes.updated.map((item) => <details key={item.id} className="mt-1 rounded-md border p-2 text-xs"><summary className="cursor-pointer">{item.id} · {item.after.title}</summary><div className="mt-2"><FieldChanges changes={Object.fromEntries(item.fields.map((field) => [field, { before: item.before[field], after: item.after[field] }]))} /></div></details>)}
        </section>
        <NodeList nodes={result.data.nodes.removed} title={t('changes.nodesRemoved')} byId={byId} onFocus={onFocus} />
        <Relations edges={result.data.edges.added} label={t('changes.edgesAdded')} /><Relations edges={result.data.edges.removed} label={t('changes.edgesRemoved')} />
        <details className="rounded-md border p-2"><summary className="cursor-pointer text-xs">{t('changes.events')} · {result.data.events.length}</summary>
          {result.data.events.map((event) => <details key={event.index} className="mt-2 border-t pt-2 text-xs"><summary className="cursor-pointer font-mono">#{event.index} {event.op} · {formatTime(event.at ?? undefined)} · {event.by || t('history.actorUnknown')}</summary>
            {event.reason && <p className="whitespace-pre-wrap">{event.reason}</p>}
            <NodeList nodes={event.nodes.added} title={t('changes.nodesAdded')} byId={byId} onFocus={onFocus} />
            {event.nodes.updated.map((item) => <div key={item.id} className="mt-2"><p className="m-0 mb-1">{item.id}</p><FieldChanges changes={Object.fromEntries(item.fields.map((field) => [field, { before: item.before[field], after: item.after[field] }]))} /></div>)}
            <NodeList nodes={event.nodes.removed} title={t('changes.nodesRemoved')} byId={byId} onFocus={onFocus} />
            <Relations edges={event.edges.added} label={t('changes.edgesAdded')} /><Relations edges={event.edges.removed} label={t('changes.edgesRemoved')} />
          </details>)}
        </details>
      </>}
    </>}
  </section>;
}
