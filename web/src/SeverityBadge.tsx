import { cn } from '@/lib/utils';
import { severityLabel } from './presentation';

/** Preserve the recorded label; unknown and unset levels use the neutral tone. */
export function SeverityBadge({ severity, className }: { severity?: string | null; className?: string }) {
  return (
    <span data-severity={severity || undefined} className={cn('severity-badge inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1 font-medium text-[10px] leading-4', className)}>
      {severityLabel(severity)}
    </span>
  );
}
