import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortState } from '@/hooks/useTableSort';

interface SortableHeaderProps {
  /** Children rendered as the column label. */
  children: React.ReactNode;
  /**
   * Backend whitelist key this column sorts by. Omit to render a plain,
   * non-sortable header (e.g. computed/derived columns).
   */
  column?: string;
  /** Current sort state from `useTableSort`. */
  sort?: SortState;
  /** Click handler — pass `toggle` from `useTableSort`. */
  onSort?: (column: string) => void;
  align?: 'left' | 'right';
  /** Replaces the default `table-head` cell styling (e.g. QA's compact table). */
  className?: string;
}

/**
 * A `<th>` whose label is clickable to sort the table server-side. Shows a
 * dimmed up/down chevron when sortable-but-inactive, and a solid arrow for the
 * active sort direction. Renders a plain header when `column`/`onSort` are
 * absent, so the same component covers sortable and non-sortable columns.
 */
export function SortableHeader({
  children,
  column,
  sort,
  onSort,
  align = 'left',
  className,
}: SortableHeaderProps) {
  const sortable = !!column && !!onSort;
  const active = sortable && sort?.sortBy === column;

  return (
    <th className={cn(className ?? 'table-head', 'whitespace-nowrap', align === 'right' && 'text-right')}>
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort!(column!)}
          className={cn(
            'inline-flex items-center gap-1 select-none transition hover:text-ink',
            align === 'right' && 'flex-row-reverse',
            active && 'text-ink',
          )}
        >
          {children}
          {active ? (
            sort!.sortDir === 'asc' ? (
              <ArrowUp className="w-3 h-3" />
            ) : (
              <ArrowDown className="w-3 h-3" />
            )
          ) : (
            <ChevronsUpDown className="w-3 h-3 opacity-40" />
          )}
        </button>
      ) : (
        <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
          {children}
        </span>
      )}
    </th>
  );
}
