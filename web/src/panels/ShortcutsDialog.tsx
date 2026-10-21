import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { t } from '../i18n';

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: t('shortcuts.navigation'),
    items: [
      { keys: ['⌘ K', '/'], label: t('shortcuts.search') },
      { keys: ['['], label: t('shortcuts.sidebar') },
      { keys: ['?'], label: t('shortcuts.help') },
      { keys: ['Esc'], label: t('shortcuts.escape') },
    ],
  },
  {
    title: t('shortcuts.canvas'),
    items: [
      { keys: ['← ↑ → ↓'], label: t('shortcuts.arrows') },
      { keys: ['Tab'], label: t('shortcuts.tab') },
      { keys: ['Enter', 'Space'], label: t('shortcuts.enter') },
      { keys: [t('shortcuts.wheel'), t('shortcuts.drag')], label: t('shortcuts.zoomPan') },
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <DialogTitle className="m-0 text-[15px] font-semibold">{t('shortcuts.title')}</DialogTitle>
            <DialogDescription className="m-0 mt-0.5 text-xs text-muted-foreground">{t('shortcuts.hint')}</DialogDescription>
          </div>
          <DialogClose asChild><Button size="icon-sm" aria-label={t('shortcuts.close')}><X /></Button></DialogClose>
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
                          {index > 0 && <span className="text-[11px] text-muted-foreground">{t('common.or')}</span>}
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
