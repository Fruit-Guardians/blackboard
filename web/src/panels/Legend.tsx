import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/icon-button';
import { TypeDot } from '../SecurityNode';
import { RELATION_DASH, RELATION_GROUPS, typeLabel, type RelationGroup } from '../graph';
import { t } from '../i18n';

type Props = {
  types: string[];
  groups: RelationGroup[];
  onClose: () => void;
};

const COLOR = (group: RelationGroup) => `var(--edge-${group})`;

/** What the colours on the canvas mean; lists only what the current view actually contains. */
export function Legend({ types, groups, onClose }: Props) {
  const relations = RELATION_GROUPS.filter((group) => groups.includes(group.id));
  if (!types.length) return null;
  return (
    <aside aria-label={t('legend.label')} className="react-flow absolute left-3 top-3 z-10 max-w-[min(300px,calc(100%-24px))] rounded-xl border bg-card/95 p-3 shadow-float backdrop-blur max-sm:hidden">
      <div className="flex items-start gap-2">
        <ul className="m-0 flex min-w-0 flex-1 list-none flex-wrap gap-x-3 gap-y-1.5 p-0 text-xs">
          {types.map((type) => (
            <li key={type} className="flex items-center gap-1.5"><TypeDot type={type} />{typeLabel(type)}</li>
          ))}
        </ul>
        <IconButton label={t('toolbar.hideLegend')} className="-mr-1.5 -mt-1.5 size-6" onClick={onClose}><X /></IconButton>
      </div>
      {relations.length > 0 && (
        <ul className={cn('m-0 mt-2.5 flex list-none flex-wrap gap-x-3 gap-y-1.5 border-t p-0 pt-2.5 text-xs text-subtle')}>
          {relations.map((group) => (
            <li key={group.id} className="flex items-center gap-1.5">
              <svg width="30" height="6" aria-hidden><line x1="0" y1="3" x2="30" y2="3" stroke={COLOR(group.id)} strokeWidth="2" strokeDasharray={RELATION_DASH[group.id]} /></svg>
              {group.label}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
