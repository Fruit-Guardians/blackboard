import { useState, type ReactNode } from 'react';
import { Collapsible } from 'radix-ui';
import { ChevronRight, Crosshair, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { TypeDot } from '../SecurityNode';
import { FilterPopover } from './FilterPopover';
import { confidenceLabel, presentNode, severityLabel } from '../presentation';
import { typeLabel } from '../graph';
import type { NodeFilter } from '../presentation';
import type { BoardNode } from '../types';

type Props = {
  current: BoardNode | null;
  openItems: BoardNode[];
  findings: BoardNode[];
  inbox: BoardNode[];
  selectedId: string | null;
  counts: { nodes: number; edges: number; risk: number; open: number; candidates: number };
  onSelect: (id: string) => void;
  onSearch: () => void;
  onShortcuts: () => void;
  filter: NodeFilter;
  onFilter: (filter: NodeFilter) => void;
  filterOptions: { types: { value: string; count: number }[]; statuses: { value: string; count: number }[]; confidences: { value: string; count: number }[]; riskCount: number };
  results: BoardNode[] | null;
};

export function Sidebar({ current, openItems, findings, inbox, selectedId, counts, onSelect, onSearch, onShortcuts, filter, onFilter, filterOptions, results }: Props) {
  return (
    <div className="flex h-full w-full flex-col" aria-label="任务导航">
      <div className="flex gap-2 p-3 pb-2">
        <button
          onClick={onSearch}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-2.5 text-[13px] text-muted-foreground shadow-xs transition-colors hover:border-strong hover:text-foreground"
        >
          <Search className="size-3.5" />搜索节点<Kbd className="ml-auto">⌘K</Kbd>
        </button>
        <FilterPopover filter={filter} onChange={onFilter} {...filterOptions} />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {results ? (
          <>
            <div className="flex h-7 items-center px-2 text-xs font-medium text-muted-foreground">
              筛选结果<span className="ml-1.5 tabular-nums font-normal">{results.length}</span>
              <Button variant="ghost" size="sm" className="ml-auto -mr-1 h-6 px-1.5 text-xs" onClick={() => onFilter({ types: [], statuses: [], confidences: [], riskOnly: false })}><X className="size-3" />清除</Button>
            </div>
            <div className="flex flex-col gap-px pt-0.5">
              {results.length
                ? results.map((node) => <Row key={node.id} node={node} selected={selectedId === node.id} current={node.id === current?.id} onSelect={onSelect} />)
                : <Empty>没有符合条件的节点，放宽一个条件试试。</Empty>}
            </div>
          </>
        ) : (<>
        <Section title="正在关注" count={current ? 1 : 0}>
          {current ? <Row node={current} selected={selectedId === current.id} current onSelect={onSelect} /> : <Empty>Agent 尚未设置游标</Empty>}
        </Section>
        <Section title="待验证" count={openItems.length}>
          {openItems.length ? openItems.map((node) => <Row key={node.id} node={node} selected={selectedId === node.id} onSelect={onSelect} />) : <Empty>当前没有开放假设</Empty>}
        </Section>
        <Section title="发现" count={findings.length}>
          {findings.length ? findings.slice(0, 8).map((node) => <Row key={node.id} node={node} selected={selectedId === node.id} onSelect={onSelect} />) : <Empty>还没有记录发现</Empty>}
        </Section>
        <Section title="未连接" count={inbox.length} defaultOpen={false}>
          {inbox.slice(0, 10).map((node) => <Row key={node.id} node={node} selected={selectedId === node.id} onSelect={onSelect} />)}
        </Section>
        </>)}
      </nav>
      <footer className="flex items-center gap-3 border-t px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
        <span>{counts.nodes} 节点</span>
        <span>{counts.edges} 关系</span>
        {counts.open > 0 && <span>{counts.open} 待验证</span>}
        {counts.candidates > 0 && <span>{counts.candidates} 候选</span>}
        {counts.risk > 0 && <span className="text-destructive">{counts.risk} 高风险</span>}
        <button className="ml-auto inline-flex items-center gap-1 rounded text-muted-foreground transition-colors hover:text-foreground" onClick={onShortcuts} aria-label="键盘快捷键">
          <Kbd>?</Kbd>
        </button>
      </footer>
    </div>
  );
}

function Section({ title, count, defaultOpen = true, children }: { title: string; count: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mb-1">
      <Collapsible.Trigger className="group flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        {title}
        <span className="ml-auto tabular-nums font-normal">{count}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="flex flex-col gap-px pt-0.5">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

function Row({ node, current = false, selected, onSelect }: { node: BoardNode; current?: boolean; selected: boolean; onSelect: (id: string) => void }) {
  const severe = node.severity === 'critical' || node.severity === 'high';
  return (
    <button
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      title={node.title}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
        selected && 'bg-accent',
      )}
    >
      <TypeDot type={node.type} className="mt-[7px]" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] leading-5 text-foreground">{presentNode(node).headline}</span>
        <span className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
          {typeLabel(node.type)}
          {severe && <span className="text-destructive">· {severityLabel(node.severity)}</span>}
          {node.confidence && <span>· {confidenceLabel(node.confidence)}</span>}
        </span>
      </span>
      {current && <Crosshair className="mt-1 size-3.5 shrink-0 text-live" />}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 px-2 py-1.5 text-xs text-muted-foreground">{children}</p>;
}
