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

type Props = {
  title: string;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
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
  connecting: { label: '连接中', dot: 'bg-strong' },
  live: { label: '已同步', dot: 'bg-live' },
  offline: { label: '重连中', dot: 'bg-destructive' },
} as const;

export function Topbar(props: Props) {
  const { title, mode, onMode, theme, onTheme, connection, isStatic, sidebarOpen, onToggleSidebar, onSearch, onDigest, onNew, digestRef, activities, activityTotal } = props;
  const status = isStatic ? { label: '离线快照', dot: 'bg-strong' } : CONNECTION[connection];
  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b bg-background px-3">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton label={sidebarOpen ? '收起导航' : '展开导航'} aria-pressed={sidebarOpen} onClick={onToggleSidebar}><PanelLeft /></IconButton>
        <BrandMark size={18} />
        <span className="text-sm font-semibold tracking-[-0.01em] max-md:hidden">blackboard</span>
        <span className="text-muted-foreground max-md:hidden">/</span>
        <span className="min-w-0 truncate text-sm text-subtle" title={title}>{title}</span>
      </div>

      <Segmented<ViewMode> value={mode} onValueChange={onMode} aria-label="画布视图">
        <SegmentedItem value="context" aria-label="现场视图"><Focus /><span className="max-sm:hidden">现场</span></SegmentedItem>
        <SegmentedItem value="logic" aria-label="逻辑视图"><GitBranch /><span className="max-sm:hidden">逻辑</span></SegmentedItem>
        <SegmentedItem value="all" aria-label="全局视图"><ListTree /><span className="max-sm:hidden">全局</span></SegmentedItem>
      </Segmented>

      <div className="flex items-center justify-end gap-1">
        <span role="status" title={status.label} className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <i className={cn('size-1.5 rounded-full', status.dot)} /><span className="max-xl:sr-only">{status.label}</span>
        </span>
        <Button size="sm" className="max-md:hidden" onClick={onSearch} aria-label="搜索与命令">
          <Search className="size-3.5" /><Kbd>⌘K</Kbd>
        </Button>
        <IconButton label="搜索" className="md:hidden" onClick={onSearch}><Search /></IconButton>
        <ActivityPopover activities={activities} total={activityTotal} />
        {onNew && <Button size="sm" onClick={onNew} aria-label="新建节点"><Plus className="size-3.5" /><span className="max-sm:hidden">新建</span></Button>}
        <Button ref={digestRef} size="sm" onClick={onDigest} aria-label="现场摘要"><FileText className="size-3.5" /><span className="max-sm:hidden">摘要</span></Button>
        <IconButton label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={onTheme}>{theme === 'light' ? <Moon /> : <Sun />}</IconButton>
      </div>
    </header>
  );
}
