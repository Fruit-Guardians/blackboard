import { Check, Copy, Focus, GitBranch, ImageDown, Keyboard, ListTree, Moon, Sun } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { TypeDot } from '../SecurityNode';
import { typeLabel } from '../graph';
import { presentNode, severityLabel, statusLabel } from '../presentation';
import type { BoardNode, ViewMode } from '../types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: BoardNode[];
  theme: 'light' | 'dark';
  copied: boolean;
  onSelect: (id: string) => void;
  onMode: (mode: ViewMode) => void;
  onTheme: () => void;
  onCopyDigest: () => void;
  onExport: (() => void) | null;
  onShortcuts: () => void;
};

export function CommandPalette({ open, onOpenChange, nodes, theme, copied, onSelect, onMode, onTheme, onCopyDigest, onExport, onShortcuts }: Props) {
  const run = (action: () => void) => () => { onOpenChange(false); action(); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position="top" className="max-w-[560px] p-0">
        <DialogTitle className="sr-only">搜索与命令</DialogTitle>
        <DialogDescription className="sr-only">搜索节点，或切换视图与主题。</DialogDescription>
        <Command loop>
          <CommandInput placeholder="搜索节点，或输入命令…" />
          <CommandList>
            <CommandEmpty>没有匹配项，试试标题、类型或正文中的关键词。</CommandEmpty>
            <CommandGroup heading="命令">
              <CommandItem value="命令 视图 现场 context" onSelect={run(() => onMode('context'))}><Focus className="size-4 text-muted-foreground" />切换到现场视图</CommandItem>
              <CommandItem value="命令 视图 逻辑 logic" onSelect={run(() => onMode('logic'))}><GitBranch className="size-4 text-muted-foreground" />切换到逻辑视图</CommandItem>
              <CommandItem value="命令 视图 全局 all" onSelect={run(() => onMode('all'))}><ListTree className="size-4 text-muted-foreground" />切换到全局视图</CommandItem>
              <CommandItem value="命令 主题 深色 浅色 theme" onSelect={run(onTheme)}>
                {theme === 'light' ? <Moon className="size-4 text-muted-foreground" /> : <Sun className="size-4 text-muted-foreground" />}
                切换为{theme === 'light' ? '深色' : '浅色'}主题
              </CommandItem>
              <CommandItem value="命令 复制 摘要 digest" onSelect={run(onCopyDigest)}>
                {copied ? <Check className="size-4 text-muted-foreground" /> : <Copy className="size-4 text-muted-foreground" />}复制现场摘要
              </CommandItem>
              {onExport && <CommandItem value="命令 导出 图片 png export" onSelect={run(onExport)}><ImageDown className="size-4 text-muted-foreground" />导出画布为图片</CommandItem>}
              <CommandItem value="命令 快捷键 帮助 shortcuts keyboard" onSelect={run(onShortcuts)}><Keyboard className="size-4 text-muted-foreground" />键盘快捷键</CommandItem>
            </CommandGroup>
            <CommandGroup heading={`节点 · ${nodes.length}`}>
              {nodes.map((node) => (
                <CommandItem
                  key={node.id}
                  value={`${node.id} ${node.title} ${node.detail || ''} ${typeLabel(node.type)} ${statusLabel(node.status)} ${severityLabel(node.severity)}`}
                  onSelect={run(() => onSelect(node.id))}
                >
                  <TypeDot type={node.type} />
                  <span className="min-w-0 flex-1 truncate">{presentNode(node).headline}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{typeLabel(node.type)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
