import { ListFilter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TypeDot } from '../SecurityNode';
import { typeLabel } from '../graph';
import { confidenceLabel, filterActive, statusLabel, type NodeFilter } from '../presentation';

type Option = { value: string; count: number };
type Props = {
  filter: NodeFilter;
  onChange: (filter: NodeFilter) => void;
  types: Option[];
  statuses: Option[];
  confidences: Option[];
  riskCount: number;
};

const toggle = (list: string[], value: string) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

export function FilterPopover({ filter, onChange, types, statuses, confidences, riskCount }: Props) {
  const active = filterActive(filter);
  const total = filter.types.length + filter.statuses.length + filter.confidences.length + Number(filter.riskOnly);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" className="relative shrink-0 border bg-card shadow-xs" aria-label={active ? `筛选（已启用 ${total} 项）` : '筛选节点'}>
          <ListFilter />
          {active && <i className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <Facet title="类型">
          {types.map((option) => (
            <Chip key={option.value} pressed={filter.types.includes(option.value)} onClick={() => onChange({ ...filter, types: toggle(filter.types, option.value) })}>
              <TypeDot type={option.value} className="size-1.5" />{typeLabel(option.value)}<Count n={option.count} />
            </Chip>
          ))}
        </Facet>
        {statuses.length > 0 && (
          <Facet title="状态">
            {statuses.map((option) => (
              <Chip key={option.value} pressed={filter.statuses.includes(option.value)} onClick={() => onChange({ ...filter, statuses: toggle(filter.statuses, option.value) })}>
                {option.value ? statusLabel(option.value) : '未设置'}<Count n={option.count} />
              </Chip>
            ))}
          </Facet>
        )}
        {confidences.length > 0 && (
          <Facet title="可信度">
            {confidences.map((option) => (
              <Chip key={option.value} pressed={filter.confidences.includes(option.value)} onClick={() => onChange({ ...filter, confidences: toggle(filter.confidences, option.value) })}>
                {option.value ? confidenceLabel(option.value) : '未声明'}<Count n={option.count} />
              </Chip>
            ))}
          </Facet>
        )}
        <Facet title="风险">
          <Chip pressed={filter.riskOnly} onClick={() => onChange({ ...filter, riskOnly: !filter.riskOnly })}>仅严重 / 高危<Count n={riskCount} /></Chip>
        </Facet>
        <div className="mt-3 flex justify-end border-t pt-2">
          <Button variant="ghost" size="sm" disabled={!active} onClick={() => onChange({ types: [], statuses: [], confidences: [], riskOnly: false })}>清除筛选</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h4 className="m-0 mb-1.5 text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:border-strong',
        pressed ? 'border-foreground bg-accent font-medium' : 'text-subtle',
      )}
    >
      {children}
    </button>
  );
}

const Count = ({ n }: { n: number }) => <span className="tabular-nums text-muted-foreground">{n}</span>;
