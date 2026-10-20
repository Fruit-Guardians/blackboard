import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: '导航',
    items: [
      { keys: ['⌘ K', '/'], label: '搜索节点与命令' },
      { keys: ['['], label: '展开或收起侧栏' },
      { keys: ['?'], label: '显示这份快捷键' },
      { keys: ['Esc'], label: '取消选中 / 关闭面板' },
    ],
  },
  {
    title: '画布',
    items: [
      { keys: ['← ↑ → ↓'], label: '沿关系跳到相邻节点' },
      { keys: ['Tab'], label: '在节点间移动焦点' },
      { keys: ['Enter', 'Space'], label: '选中焦点节点' },
      { keys: ['滚轮', '拖动'], label: '缩放 / 平移' },
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <DialogTitle className="m-0 text-[15px] font-semibold">键盘快捷键</DialogTitle>
            <DialogDescription className="m-0 mt-0.5 text-xs text-muted-foreground">在输入框里时快捷键不会触发。</DialogDescription>
          </div>
          <DialogClose asChild><Button size="icon-sm" aria-label="关闭快捷键"><X /></Button></DialogClose>
        </header>
        <div className="flex flex-col gap-5 px-5 py-4">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="m-0 mb-2 text-xs font-medium text-muted-foreground">{group.title}</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 text-[13px]">
                    <span>{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key, index) => (
                        <span key={key} className="flex items-center gap-1">
                          {index > 0 && <span className="text-[11px] text-muted-foreground">或</span>}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
