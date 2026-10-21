import { useState } from 'react';
import { Check, Copy, ListTree, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '../i18n';

const EXAMPLE = `blackboard node add goal "${t('empty.example')}" --enter`;

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
            <strong className="text-sm font-medium">{t('empty.noVisible')}</strong>
            <p className="m-0 text-xs leading-5 text-muted-foreground">{t('empty.contextHint')}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={onShowAll}><ListTree />{t('empty.showAll')}</Button>
          </>
        ) : (
          <>
            <strong className="text-sm font-medium">{t('empty.title')}</strong>
            <p className="m-0 text-xs leading-5 text-muted-foreground">
              {isStatic ? t('empty.static') : t('empty.live')}
            </p>
            {!isStatic && (
              <div className="mt-2 flex w-full items-center gap-1 rounded-lg border bg-card py-1 pl-3 pr-1 text-left shadow-xs">
                <code className="min-w-0 flex-1 select-all whitespace-pre-wrap break-all font-mono text-[11px] text-subtle">{EXAMPLE}</code>
                <Button size="icon-sm" aria-label={copied ? t('common.copied') : t('empty.copyCommand')} onClick={copy}>{copied ? <Check /> : <Copy />}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
