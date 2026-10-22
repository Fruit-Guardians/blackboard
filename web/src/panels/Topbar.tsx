import type { RefObject } from 'react';
import { FileText, Focus, GitBranch, ListTree, Moon, PanelLeft, Plus, Search, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import { IconButton } from '@/components/icon-button';
import { BrandMark } from '../BrandMark';
import { ActivityPopover } from './ActivityPopover';
import type { Connection } from '../use-graph-stream';
import type { Activity, ViewMode } from '../types';
import { t } from '../i18n';

type Props = {
  title: string;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  agentId: string;
  agentIds: string[];
  onAgent: (agentId: string) => void;
  theme: 'light' | 'dark';
  onTheme: () => void;
  connection: Connection;
  isStatic: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSearch: () => void;
  onDigest: () => void;
  onNew?: () => void;
  digestRef: RefObject<HTMLButtonElement | null>;
  activities: Activity[];
  activityTotal: number;
};

const CONNECTION = {
  connecting: { label: t('topbar.connecting'), dot: 'bg-strong' },
  live: { label: t('topbar.live'), dot: 'bg-live' },
  offline: { label: t('topbar.offline'), dot: 'bg-destructive' },
} as const;

export function Topbar(props: Props) {
  const { title, mode, onMode, agentId, agentIds, onAgent, theme, onTheme, connection, isStatic, sidebarOpen, onToggleSidebar, onSearch, onDigest, onNew, digestRef, activities, activityTotal } = props;
  const status = isStatic ? { label: t('topbar.static'), dot: 'bg-strong' } : CONNECTION[connection];
  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-b bg-background px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton label={sidebarOpen ? t('topbar.collapseNav') : t('topbar.expandNav')} aria-pressed={sidebarOpen} onClick={onToggleSidebar}><PanelLeft /></IconButton>
        <BrandMark size={18} />
        <span className="text-sm font-semibold tracking-[-0.01em] max-md:hidden">blackboard</span>
        <span className="text-muted-foreground max-md:hidden">/</span>
        <span className="min-w-0 truncate text-sm text-subtle" title={title}>{title}</span>
      </div>

      <div className="col-span-2 row-start-2 flex min-w-0 items-center justify-center gap-3">
        <Segmented<ViewMode> value={mode} onValueChange={onMode} aria-label={t('topbar.views')}>
          <SegmentedItem value="context" aria-label={t('view.contextLabel')}><Focus /><span className="max-sm:hidden">{t('view.context')}</span></SegmentedItem>
          <SegmentedItem value="logic" aria-label={t('view.logicLabel')}><GitBranch /><span className="max-sm:hidden">{t('view.logic')}</span></SegmentedItem>
          <SegmentedItem value="all" aria-label={t('view.allLabel')}><ListTree /><span className="max-sm:hidden">{t('view.all')}</span></SegmentedItem>
        </Segmented>
        <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={t('topbar.agentHint')}>
          <span className="shrink-0">{t('topbar.agent')}</span>
          <select aria-label={t('topbar.agent')} value={agentId} onChange={(event) => onAgent(event.target.value)} className="h-8 min-w-0 max-w-56 rounded-md border bg-card px-1.5 text-xs text-foreground">
            {agentIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      </div>

      <div className="col-start-2 row-start-1 flex items-center justify-end gap-1">
        <span role="status" title={status.label} className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <i className={cn('size-1.5 rounded-full', status.dot)} /><span className="max-xl:sr-only">{status.label}</span>
        </span>
        <Button size="sm" className="max-md:hidden" onClick={onSearch} aria-label={t('topbar.searchCommands')}>
          <Search className="size-3.5" /><Kbd>⌘K</Kbd>
        </Button>
        <IconButton label={t('topbar.search')} className="md:hidden" onClick={onSearch}><Search /></IconButton>
        <ActivityPopover activities={activities} total={activityTotal} />
        {onNew && <Button size="sm" onClick={onNew} aria-label={t('topbar.newNode')}><Plus className="size-3.5" /><span className="max-sm:hidden">{t('topbar.new')}</span></Button>}
        <Button ref={digestRef} size="sm" onClick={onDigest} aria-label={t('topbar.digestLabel')}><FileText className="size-3.5" /><span className="max-sm:hidden">{t('topbar.digest')}</span></Button>
        <IconButton label={theme === 'light' ? t('theme.toDark') : t('theme.toLight')} onClick={onTheme}>{theme === 'light' ? <Moon /> : <Sun />}</IconButton>
      </div>
    </header>
  );
}
