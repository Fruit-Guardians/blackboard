import { useState, type FormEvent } from 'react';
import { Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import * as api from '../api';
import { confidenceLabel, matchesNode, severityLabel, statusLabel, typeLabel } from '../presentation';
import { relationLabel } from '../graph';
import { changeDraft, EMPTY_EDIT, existingLink, type EditableField, type EditDraft } from '../research-state';
import type { BoardNode } from '../types';
import { t } from '../i18n';
import { useSessionDraft } from '../session-drafts';

const field = 'w-full rounded-md border border-strong bg-card px-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

/** Runs a write, reporting a failure next to the form instead of losing what was typed. */
function useWrite() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, run, clearError: () => setError(null) };
}

const Error_ = ({ message }: { message: string | null }) => message ? <p role="alert" className="m-0 text-xs text-destructive">{message}</p> : null;


/** Only a person's changed fields are drafts; untouched fields always follow the live snapshot. */
export function EditSection({ node, onReload }: { node: BoardNode; onReload: () => Promise<void> }) {
  const [draft, setDraft] = useSessionDraft<EditDraft>(`edit:${node.id}`, EMPTY_EDIT);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run, clearError } = useWrite();
  const title = draft.fields.title ?? node.title;
  const detail = draft.fields.detail ?? node.detail ?? '';
  const dirty = Object.keys(draft.fields).length > 0;
  const change = (key: EditableField, value: string) => {
    const next = changeDraft(draft, node, key, value);
    setDraft(next, Object.keys(next.fields).length > 0);
  };
  const discard = () => { setDraft(EMPTY_EDIT, false); clearError(); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || draft.conflict) return;
    if (!dirty) { discard(); return; }
    const ok = await run(async () => {
      try { await api.patchNode(node.id, { ...draft.fields, expected: draft.expected }); }
      catch (e) {
        if (e instanceof api.NodeConflict) setDraft({ ...draft, conflict: true }, true);
        throw e;
      }
    });
    if (ok) discard();
  };

  return (
    <section className="mt-6 flex flex-col gap-3 border-t pt-4" aria-label={t('edit.label')}>
      <h3 className="m-0 text-xs font-medium text-muted-foreground">{t('edit.heading')}</h3>
      {draft.editing ? (
        <form className="flex flex-col gap-2" onSubmit={save}>
          <input aria-label={t('edit.title')} className={cn(field, 'h-8')} value={title} onChange={(e) => change('title', e.target.value)} disabled={busy} autoFocus />
          <textarea aria-label={t('edit.detail')} className={cn(field, 'min-h-24 py-1.5 leading-5')} value={detail} onChange={(e) => change('detail', e.target.value)} disabled={busy} placeholder={t('edit.detailPlaceholder')} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([
              { key: 'status', label: t('inspector.status'), values: api.SETTABLE_STATUSES, format: statusLabel },
              { key: 'severity', label: t('inspector.risk'), values: api.SETTABLE_SEVERITIES, format: severityLabel },
              { key: 'confidence', label: t('inspector.confidence'), values: api.SETTABLE_CONFIDENCES, format: confidenceLabel },
            ] as const).map(({ key, label, values, format }) => {
              const value = draft.fields[key] ?? node[key] ?? '';
              return <label key={key} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                {label}
                <select aria-label={label} className={cn(field, 'h-8')} value={value} disabled={busy} onChange={(e) => change(key, e.target.value)}>
                  {!value && <option value="" disabled>{format()}</option>}
                  {value && !(values as readonly string[]).includes(value) && <option value={value}>{format(value)}</option>}
                  {values.map((item) => <option key={item} value={item}>{format(item)}</option>)}
                </select>
              </label>;
            })}
          </div>
          <p className="m-0 text-[11px] text-muted-foreground">{t('edit.draftHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="default" size="sm" disabled={busy || !title.trim() || draft.conflict}>{t('edit.save')}</Button>
            <Button type="button" size="sm" disabled={busy} onClick={discard}>{t('edit.discard')}</Button>
          </div>
          {draft.conflict && (
            <div role="alert" className="flex flex-col gap-2 text-xs text-destructive">
              <p className="m-0">{t('edit.conflict')}</p>
              <Button type="button" variant="outline" size="sm" className="self-start" disabled={busy} onClick={async () => {
                if (await run(onReload)) { setDraft({ ...EMPTY_EDIT, editing: true }, false); clearError(); }
              }}>{t('edit.reload')}</Button>
            </div>
          )}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, editing: true }, dirty)}><Pencil className="size-3.5" />{t('edit.editText')}</Button>

        </div>
      )}
      {!draft.conflict && <Error_ message={error} />}
      {!draft.conflict && error === t('edit.conflict') && <Button size="sm" className="self-start" disabled={busy} onClick={async () => { if (await run(onReload)) clearError(); }}>{t('edit.reload')}</Button>}
      {draft.conflict && error && error !== t('edit.conflict') && <Error_ message={error} />}
      {confirming ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('edit.confirmRemove')}</span>
          <Button variant="outline" size="sm" className="text-destructive" disabled={busy} onClick={async () => { if (await run(() => api.removeNode(node.id))) discard(); }}>{t('edit.remove')}</Button>
          <Button size="sm" onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
        </div>
      ) : (
        <Button size="sm" className="self-start text-muted-foreground" onClick={() => setConfirming(true)}><Trash2 className="size-3.5" />{t('edit.removeNode')}</Button>
      )}
    </section>
  );
}

/** A new card, optionally tied to the selected one. */
function NodeForm({ current, onDone, autoFocus }: { current?: BoardNode; onDone?: () => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useSessionDraft(`new:${current?.id || 'standalone'}`, { type: 'fact', title: '', link: 'related-to', createdId: '' });
  const { type, title, link, createdId } = draft;
  const { busy, error, run, clearError } = useWrite();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const ok = await run(async () => {
      const node = createdId ? { id: createdId } : (await api.addNode({ type, title: title.trim() })).node;
      setDraft({ ...draft, createdId: node.id }, true);
      if (current) {
        try {
          const way = api.LINKS.find((item) => item.id === link)!;
          await (way.from === 'new' ? api.addEdge(node.id, current.id, way.kind) : api.addEdge(current.id, node.id, way.kind));
        } catch (e) {
          // The node is already in the log; say so instead of letting a retry
          // create a second orphan with the same title.
          throw new Error(t('edit.linkFailed', { id: node.id, error: e instanceof Error ? e.message : String(e) }));
        }
      }
    });
    if (ok) { setDraft({ type: 'fact', title: '', link: 'related-to', createdId: '' }, false); onDone?.(); }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <div className="flex gap-2">
        <select aria-label={t('edit.type')} className={cn(field, 'h-8 w-24 shrink-0')} value={type} disabled={busy || Boolean(createdId)} onChange={(e) => setDraft({ ...draft, type: e.target.value }, Boolean(title) || e.target.value !== 'fact' || link !== 'related-to')}>
          {api.CREATABLE_TYPES.map((item) => <option key={item} value={item}>{typeLabel(item)}</option>)}
        </select>
        <input aria-label={t('edit.newTitle')} className={cn(field, 'h-8')} value={title} disabled={busy || Boolean(createdId)} onChange={(e) => setDraft({ ...draft, title: e.target.value }, Boolean(e.target.value) || type !== 'fact' || link !== 'related-to')} placeholder={t('edit.newPlaceholder')} autoFocus={autoFocus} />
      </div>
      {current && (
        <select aria-label={t('edit.relation')} className={cn(field, 'h-8')} value={link} disabled={busy} onChange={(e) => setDraft({ ...draft, link: e.target.value }, Boolean(title || createdId) || type !== 'fact' || e.target.value !== 'related-to')}>
          {api.LINKS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="default" size="sm" disabled={busy || !title.trim()}><Plus className="size-3.5" />{t('edit.add')}</Button>
        <Button type="button" size="sm" disabled={busy} onClick={() => { setDraft({ type: 'fact', title: '', link: 'related-to', createdId: '' }, false); clearError(); }}>{t('edit.discard')}</Button>
        <span className="text-[11px] text-muted-foreground">{t('edit.humanNote')}</span>
      </div>
      <p className="m-0 text-[11px] text-muted-foreground">{t('edit.draftHint')}</p>
      <Error_ message={error} />
    </form>
  );
}

export function AddSection({ node }: { node: BoardNode }) {
  return (
    <section className="mt-5 flex flex-col gap-2" aria-label={t('edit.related')}>
      <h3 className="m-0 text-xs font-medium text-muted-foreground">{t('edit.related')}</h3>
      <NodeForm current={node} />
    </section>
  );
}

export function NewNodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <DialogTitle className="m-0 text-[15px] font-semibold">{t('edit.newDialog')}</DialogTitle>
            <DialogDescription className="m-0 mt-0.5 text-xs text-muted-foreground">{t('edit.newDescription')}</DialogDescription>
          </div>
          <DialogClose asChild><Button size="icon-sm" aria-label={t('common.close')}><X /></Button></DialogClose>
        </header>
        <div className="px-5 py-4"><NodeForm autoFocus onDone={() => onOpenChange(false)} /></div>
      </DialogContent>
    </Dialog>
  );
}

/** Connect existing records explicitly. Selection is UI state, never a cursor move. */
export function ConnectSection({ node, byId, onReload }: { node: BoardNode; byId: Map<string, BoardNode>; onReload: () => Promise<void> }) {
  const [draft, setDraft] = useSessionDraft(`connect:${node.id}`, { peerId: '', query: '', kind: 'related-to', direction: 'outgoing' as 'outgoing' | 'incoming' });
  const [done, setDone] = useState(false);
  const { busy, error, run } = useWrite();
  const peers = [...byId.values()].filter((peer) => peer.id !== node.id && (peer.id === draft.peerId || matchesNode(peer, draft.query)));
  const link = existingLink(node.id, draft.peerId, draft.direction, draft.kind);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!link || !byId.has(draft.peerId)) return;
    if (await run(() => api.addEdge(link.from, link.to, link.kind))) {
      setDraft({ peerId: '', query: '', kind: 'related-to', direction: 'outgoing' }, false);
      setDone(true);
      // Refresh failures must not offer a duplicate write: the relation is already committed.
      await onReload().catch(() => {});
    }
  };
  return <section className="mt-5 flex flex-col gap-2 border-t pt-4" aria-label={t('connect.heading')}>
    <h3 className="m-0 text-xs font-medium text-muted-foreground">{t('connect.heading')}</h3>
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <input aria-label={t('connect.search')} placeholder={t('connect.search')} className={cn(field, 'h-8')} value={draft.query} disabled={busy} onChange={(e) => { setDraft({ ...draft, query: e.target.value }, Boolean(draft.peerId)); setDone(false); }} />
      <select aria-label={t('connect.peer')} className={cn(field, 'h-8')} value={draft.peerId} disabled={busy} onChange={(e) => { setDraft({ ...draft, peerId: e.target.value }, Boolean(e.target.value)); setDone(false); }}>
        <option value="">{t('connect.peer')}</option>
        {peers.map((peer) => <option key={peer.id} value={peer.id}>{peer.id} · {peer.title}</option>)}
      </select>
      <select aria-label={t('connect.kind')} className={cn(field, 'h-8')} value={draft.kind} disabled={busy} onChange={(e) => setDraft({ ...draft, kind: e.target.value }, Boolean(draft.peerId))}>
        {['related-to', 'derived-from', 'supports', 'contradicts', 'depends-on', 'proves', 'caused-by', 'refines', 'duplicates', 'supersedes', 'resolves'].map((kind) => <option key={kind} value={kind}>{relationLabel(kind)}</option>)}
      </select>
      <select aria-label={t('connect.direction')} className={cn(field, 'h-8')} value={draft.direction} disabled={busy} onChange={(e) => setDraft({ ...draft, direction: e.target.value as 'outgoing' | 'incoming' }, Boolean(draft.peerId))}>
        <option value="outgoing">{t('connect.outgoing')}</option><option value="incoming">{t('connect.incoming')}</option>
      </select>
      {link && <p aria-label={t('connect.preview')} className="m-0 break-words rounded-md border bg-secondary p-2 font-mono text-xs">{link.from} — {relationLabel(link.kind)} → {link.to}</p>}
      <p className="m-0 text-[11px] text-muted-foreground">{t('connect.hint')}</p>
      <Button type="submit" variant="outline" size="sm" className="self-start" disabled={busy || !link || !byId.has(draft.peerId)}><Link2 className="size-3.5" />{t('connect.submit')}</Button>
      {done && <p role="status" className="m-0 text-xs text-muted-foreground">{t('connect.done')}</p>}
      <Error_ message={error} />
    </form>
  </section>;
}
