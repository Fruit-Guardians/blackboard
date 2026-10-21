import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import * as api from '../api';
import { statusLabel, typeLabel } from '../presentation';
import type { BoardNode } from '../types';

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
    <section className="mt-6 flex flex-col gap-3 border-t pt-4" aria-label="编辑节点">
      <h3 className="m-0 text-xs font-medium text-muted-foreground">编辑</h3>
      {editing ? (
        <form className="flex flex-col gap-2" onSubmit={save}>
          <input aria-label="标题" className={cn(field, 'h-8')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <textarea aria-label="详情" className={cn(field, 'min-h-24 py-1.5 leading-5')} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="详情（可选）" />
          <div className="flex gap-2">
            <Button type="submit" variant="default" size="sm" disabled={busy || !title.trim()}>保存</Button>
            <Button size="sm" onClick={() => { setEditing(false); setTitle(node.title); setDetail(node.detail || ''); }}>取消</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setTitle(node.title); setDetail(node.detail || ''); setEditing(true); }}><Pencil className="size-3.5" />修改文字</Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            状态
            <select
              aria-label="状态"
              className={cn(field, 'h-7 w-auto pr-1')}
              value={node.status || ''}
              disabled={busy}
              onChange={(e) => e.target.value && run(() => api.patchNode(node.id, { status: e.target.value }))}
            >
              {!node.status && <option value="">未设置</option>}
              {api.SETTABLE_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
          </label>
        </div>
      )}
      <Error_ message={error} />
      {confirming ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">连同它的关系一起移出画布？</span>
          <Button variant="outline" size="sm" className="text-destructive" disabled={busy} onClick={() => run(() => api.removeNode(node.id))}>确认移除</Button>
          <Button size="sm" onClick={() => setConfirming(false)}>取消</Button>
        </div>
      ) : (
        <Button size="sm" className="self-start text-muted-foreground" onClick={() => setConfirming(true)}><Trash2 className="size-3.5" />移除节点</Button>
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
        const way = api.LINKS.find((item) => item.id === link)!;
        await (way.from === 'new' ? api.addEdge(node.id, current.id, way.kind) : api.addEdge(current.id, node.id, way.kind));
      }
    });
    if (ok) { setTitle(''); onDone?.(); }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <div className="flex gap-2">
        <select aria-label="类型" className={cn(field, 'h-8 w-24 shrink-0')} value={type} onChange={(e) => setType(e.target.value)}>
          {api.CREATABLE_TYPES.map((item) => <option key={item} value={item}>{typeLabel(item)}</option>)}
        </select>
        <input aria-label="新节点标题" className={cn(field, 'h-8')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="写下一个想法、事实或问题" autoFocus={autoFocus} />
      </div>
      {current && (
        <select aria-label="与当前节点的关系" className={cn(field, 'h-8')} value={link} onChange={(e) => setLink(e.target.value as typeof link)}>
          {api.LINKS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="default" size="sm" disabled={busy || !title.trim()}><Plus className="size-3.5" />添加</Button>
        <span className="text-[11px] text-muted-foreground">写入后标记为“人工”，Agent 可以读到。</span>
      </div>
      <Error_ message={error} />
    </form>
  );
}

export function AddSection({ node }: { node: BoardNode }) {
  return (
    <section className="mt-5 flex flex-col gap-2" aria-label="添加相关节点">
      <h3 className="m-0 text-xs font-medium text-muted-foreground">添加相关节点</h3>
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
            <DialogTitle className="m-0 text-[15px] font-semibold">新建节点</DialogTitle>
            <DialogDescription className="m-0 mt-0.5 text-xs text-muted-foreground">不与其他节点相连；选中节点后可以在详情里添加相关节点。</DialogDescription>
          </div>
          <DialogClose asChild><Button size="icon-sm" aria-label="关闭"><X /></Button></DialogClose>
        </header>
        <div className="px-5 py-4"><NodeForm autoFocus onDone={() => onOpenChange(false)} /></div>
      </DialogContent>
    </Dialog>
  );
}
