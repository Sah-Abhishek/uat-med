import { useCallback, useState } from 'react';
import type { SortDir } from '@/api/types';

export interface SortState {
  /** Backend whitelist key for the active sort column, or undefined for default. */
  sortBy?: string;
  sortDir: SortDir;
}

/**
 * Drives server-side column sorting for a paginated table.
 *
 * `toggle(column)` cycles: clicking a new column sorts it ascending; clicking
 * the active column flips asc ⇄ desc. Feed `sort` into the list query params
 * and pass `toggle` to {@link SortableHeader}. Callers should reset to page 1
 * when the sort changes (the toggle handler is the natural place to do so).
 */
export function useTableSort(initial: SortState) {
  const [sort, setSort] = useState<SortState>(initial);

  const toggle = useCallback((column: string) => {
    setSort((prev) =>
      prev.sortBy === column
        ? { sortBy: column, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' }
        : { sortBy: column, sortDir: 'asc' },
    );
  }, []);

  return { sort, toggle, setSort };
}

/**
 * Client-side sort of the rows currently in hand (this is purely in the
 * browser — it reorders whatever page the API already returned, it does not
 * fetch a globally-sorted dataset). `accessors` maps each sortable column key
 * to a value getter for the row. Unknown/absent `sortBy` returns rows
 * unchanged. Nulls always sort last regardless of direction; numbers compare
 * numerically, everything else as numeric-aware strings (so "WL-2" < "WL-10").
 */
export function sortRows<T>(
  rows: T[],
  sort: SortState,
  accessors: Record<string, (row: T) => unknown>,
): T[] {
  const get = sort.sortBy ? accessors[sort.sortBy] : undefined;
  if (!get) return rows;
  const dir = sort.sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    const aEmpty = av === null || av === undefined || av === '';
    const bEmpty = bv === null || bv === undefined || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return (
      String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir
    );
  });
}
