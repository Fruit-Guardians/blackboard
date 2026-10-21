import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import * as api from '../api';
import { statusLabel, typeLabel } from '../presentation';
import type { BoardNode } from '../types';
import { t } from '../i18n';

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
  return { busy, error, run };
}

const Error_ = ({ message }: { message: string | null }) => message ? <p role="alert" className="m-0 text-xs text-destructive">{message}</p> : null;

/** Everything a person can change about the selected card. */
export function EditSection({ node }: { node: BoardNode }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title);
  const [detail, setDetail] = useState(node.detail || '');
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useWrite();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (await run(() => api.patchNode(node.id, { title: title.trim(), detail }))) setEditing(false);
  };

  return (
    <section className="mt-6 flex flex-col gap-3 border-t pt-4" aria-label={t('edit.label')}>
      <h3 className="m-0 text-xs font-medium text-muted-foreground">{t('edit.heading')}</h3>
      {editing ? (
        <form className="flex flex-col gap-2" onSubmit={save}>
          <input aria-label={t('edit.title')} className={cn(field, 'h-8')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <textarea aria-label={t('edit.detail')} className={cn(field, 'min-h-24 py-1.5 leading-5')} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t('edit.detailPlaceholder')} />
          <div className="flex gap-2">
            <Button type="submit" variant="default" size="sm" disabled={busy || !title.trim()}>{t('edit.save')}</Button>
            <Button size="sm" onClick={() => { setEditing(false); setTitle(node.title); setDetail(node.detail || ''); }}>{t('common.cancel')}</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setTitle(node.title); setDetail(node.detail || ''); setEditing(true); }}><Pencil className="size-3.5" />{t('edit.editText')}</Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('edit.status')}
            <select
              aria-label={t('edit.status')}
              className={cn(field, 'h-7 w-auto pr-1')}
              value={node.status || ''}
              disabled={busy}
              onChange={(e) => e.target.value && run(() => api.patchNode(node.id, { status: e.target.value }))}
            >
              {!node.status && <option value="">{t('status.unset')}</option>}
              {api.SETTABLE_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
          </label>
        </div>
      )}
      <Error_ message={error} />
      {confirming ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('edit.confirmRemove')}</span>
          <Button variant="outline" size="sm" className="text-destructive" disabled={busy} onClick={() => run(() => api.removeNode(node.id))}>{t('edit.remove')}</Button>
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
  const [type, setType] = useState<string>('fact');
  const [title, setTitle] = useState('');
  const [link, setLink] = useState<(typeof api.LINKS)[number]['id']>('supports');
  const { busy, error, run } = useWrite();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const ok = await run(async () => {
      const { node } = await api.addNode({ type, title: title.trim() });
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
    if (ok) { setTitle(''); onDone?.(); }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <div className="flex gap-2">
        <select aria-label={t('edit.type')} className={cn(field, 'h-8 w-24 shrink-0')} value={type} onChange={(e) => setType(e.target.value)}>
          {api.CREATABLE_TYPES.map((item) => <option key={item} value={item}>{typeLabel(item)}</option>)}
        </select>
        <input aria-label={t('edit.newTitle')} className={cn(field, 'h-8')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('edit.newPlaceholder')} autoFocus={autoFocus} />
      </div>
      {current && (
        <select aria-label={t('edit.relation')} className={cn(field, 'h-8')} value={link} onChange={(e) => setLink(e.target.value as typeof link)}>
          {api.LINKS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="default" size="sm" disabled={busy || !title.trim()}><Plus className="size-3.5" />{t('edit.add')}</Button>
        <span className="text-[11px] text-muted-foreground">{t('edit.humanNote')}</span>
      </div>
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
