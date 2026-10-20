import { Activity as ActivityIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatTime } from '../graph';
import type { Activity } from '../types';

export function ActivityPopover({ activities, total }: { activities: Activity[]; total: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" aria-label="Agent 活动"><ActivityIcon className="size-3.5" /><span className="max-sm:hidden">活动</span><span className="tabular-nums text-muted-foreground">{total}</span></Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0">
        <div className="flex h-10 items-center justify-between border-b px-3.5 text-[13px] font-medium">
          Agent 活动<span className="text-xs font-normal text-muted-foreground">最近 {Math.min(activities.length, 12)} 条</span>
        </div>
        <ul className="m-0 max-h-[360px] list-none overflow-y-auto p-1.5">
          {!activities.length && <li className="px-2 py-6 text-center text-xs text-muted-foreground">还没有活动记录</li>}
          {activities.slice(0, 12).map((activity) => (
            <li key={activity.id} className="flex items-start gap-2.5 rounded-md px-2 py-1.5">
              <i className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', activity.status === 'success' ? 'bg-live' : 'bg-strong')} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{activity.tool || 'Agent'}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatTime(activity.at)}</span>
                </span>
                <span className="line-clamp-2 text-xs leading-[18px] text-muted-foreground">{activity.summary || '记录了一次活动'}</span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
