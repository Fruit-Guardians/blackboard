import { Collapsible } from 'radix-ui';
import { Check, ArrowDownLeft, ArrowUpRight, ChevronRight, Link2, Unlink, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { NodeTypeIcon, TypeDot } from '../SecurityNode';
import { formatTime, relationLabel, typeLabel } from '../graph';
import { confidenceLabel, presentNode, severityLabel, statusLabel } from '../presentation';
import { removeEdge } from '../api';
import { AddSection, EditSection } from './EditPanel';
import type { BoardEdge, BoardNode } from '../types';

type Props = {
  node: BoardNode;
  edges: BoardEdge[];
  byId: Map<string, BoardNode>;
  onClose: () => void;
  onFocus: (id: string) => void;
  onCopyLink?: () => void;
  linkCopied?: boolean;
  /** The server accepts edits from this page. */
  writable?: boolean;
};

export function Inspector({ node, edges, byId, onClose, onFocus, onCopyLink, linkCopied, writable }: Props) {
  const relations = edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  const text = presentNode(node);
  const severe = node.severity === 'critical' || node.severity === 'high';
  return (
    <aside
      aria-label="节点详情"
      className="anim-slide-in absolute inset-x-3 bottom-3 top-auto z-20 flex max-h-[62%] flex-col rounded-xl border bg-card shadow-float sm:inset-x-auto sm:right-3 sm:top-3 sm:max-h-none sm:w-[360px]"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3.5">
        <span className="text-muted-foreground"><NodeTypeIcon type={node.type} size={14} /></span>
        <span className="text-[13px] font-medium">{typeLabel(node.type)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={node.id}>{node.id}</span>
        {onCopyLink && <IconButton label={linkCopied ? '链接已复制' : '复制节点链接'} onClick={onCopyLink}>{linkCopied ? <Check /> : <Link2 />}</IconButton>}
        <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        <IconButton label="关闭详情" onClick={onClose}><X /></IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <h2 className="m-0 text-[17px] font-semibold leading-snug tracking-[-0.01em]">{text.headline}</h2>
        {text.summary && <p className="mt-2 mb-0 text-[13px] leading-[22px] text-subtle">{text.summary}</p>}
        {text.detail && <p className="mt-2 mb-0 text-[13px] leading-[22px] text-subtle">{text.detail}</p>}

        <dl className="mt-5 mb-0 divide-y rounded-lg border text-[13px]">
          <Prop label="状态" value={statusLabel(node.status)} />
          <Prop label="风险" value={severityLabel(node.severity)} tone={severe ? 'danger' : undefined} />
          <Prop label="可信度" value={confidenceLabel(node.confidence)} />
          {typeof node.author === 'string' && node.author && <Prop label="作者" value={node.author === 'human' ? '人工' : node.author} />}
          <Prop label="创建" value={formatTime(Number(node.ts || 0))} />
          <Prop label="更新" value={formatTime(Number(node.updated || node.ts || 0))} />
        </dl>

        <section className="mt-6">
          <h3 className="m-0 mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            关系<span className="tabular-nums font-normal">{relations.length}</span>
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
                      <Arrow className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label={incoming ? '来自' : '指向'} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                          {relationLabel(edge.kind)}
                          {peer && <><span aria-hidden>·</span><TypeDot type={peer.type} className="size-1.5" />{typeLabel(peer.type)}</>}
                        </span>
                        <span className="line-clamp-2 text-[13px] leading-5">{peer ? presentNode(peer).headline : incoming ? edge.from : edge.to}</span>
                      </span>
                      <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                    {writable && (
                      <span className="absolute right-1 top-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
                        <IconButton label="断开这条关系" onClick={() => { removeEdge(edge.id).catch((e) => { window.alert(`断开关系失败：${e instanceof Error ? e.message : String(e)}`); }); }}><Unlink /></IconButton>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">这个节点尚未建立逻辑关系。</p>
          )}
        </section>

        {writable && <AddSection key={`add-${node.id}`} node={node} />}
        {writable && <EditSection key={`edit-${node.id}`} node={node} />}

        <Collapsible.Root key={node.id} className="mt-6">
          <Collapsible.Trigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />原始数据
          </Collapsible.Trigger>
          <Collapsible.Content>
            <pre className="mt-2 mb-0 max-h-64 overflow-auto rounded-lg border bg-secondary p-3 font-mono text-[11px] leading-[18px] text-subtle">{JSON.stringify(node, null, 2)}</pre>
          </Collapsible.Content>
        </Collapsible.Root>
      </div>
    </aside>
  );
}

function Prop({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('m-0 tabular-nums', tone === 'danger' && 'font-medium text-destructive')}>{value}</dd>
    </div>
  );
}
