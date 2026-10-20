import { useState } from 'react';
import { Check, Copy, ListTree, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';

const EXAMPLE = 'blackboard node add goal "你想弄清楚的第一件事" --enter';

type Props = {
  /** The board has nodes, but none belong to the current view. */
  viewEmpty: boolean;
  isStatic: boolean;
  onShowAll: () => void;
};

export function EmptyBoard({ viewEmpty, isStatic, onShowAll }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(EXAMPLE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard can be blocked; the command stays selectable */ }
  };
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-2 text-center">
        <Target size={28} strokeWidth={1.4} className="text-muted-foreground" />
        {viewEmpty ? (
          <>
            <strong className="text-sm font-medium">这个视图里还没有可显示的节点</strong>
            <p className="m-0 text-xs leading-5 text-muted-foreground">现场视图围绕 Agent 当前位置展开；还没有游标或关系时，可以到全局视图查看全部记录。</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={onShowAll}><ListTree />查看全局视图</Button>
          </>
        ) : (
          <>
            <strong className="text-sm font-medium">黑板还是空的</strong>
            <p className="m-0 text-xs leading-5 text-muted-foreground">
              {isStatic ? '这份离线快照里没有任何节点。' : 'Agent 写入第一个节点后，思路会在这里实时展开。你也可以自己试一条：'}
            </p>
            {!isStatic && (
              <div className="mt-2 flex w-full items-center gap-1 rounded-lg border bg-card py-1 pl-3 pr-1 text-left shadow-xs">
                <code className="min-w-0 flex-1 select-all whitespace-pre-wrap break-all font-mono text-[11px] text-subtle">{EXAMPLE}</code>
                <Button size="icon-sm" aria-label={copied ? '已复制' : '复制命令'} onClick={copy}>{copied ? <Check /> : <Copy />}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
