import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Icon-only button: always has an accessible name and a tooltip. */
export function IconButton({ label, shortcut, children, size = 'icon-sm', ...props }: Omit<ComponentProps<typeof Button>, 'children'> & { label: string; shortcut?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size={size} aria-label={label} {...props}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}{shortcut && <span className="opacity-60">{shortcut}</span>}</TooltipContent>
    </Tooltip>
  );
}
