import { Check, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  digest: string;
  copied: boolean;
  onCopy: () => void;
  returnFocus: React.RefObject<HTMLButtonElement | null>;
};

export function DigestDialog({ open, onOpenChange, digest, copied, onCopy, returnFocus }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] max-w-[640px] flex-col"
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <DialogTitle className="m-0 text-[15px] font-semibold">现场摘要</DialogTitle>
            <DialogDescription className="m-0 mt-0.5 text-xs text-muted-foreground">当前位置、逻辑关系和最近进展，供下一次继续。</DialogDescription>
          </div>
          <DialogClose asChild><Button size="icon-sm" aria-label="关闭摘要"><X /></Button></DialogClose>
        </header>
        <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-5 text-subtle">{digest || '当前没有摘要。'}</pre>
        <footer className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">摘要仅记录上下文，不决定下一步。</span>
          <Button variant="outline" size="sm" onClick={onCopy}>{copied ? <Check /> : <Copy />}{copied ? '已复制' : '复制摘要'}</Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
