import { create } from 'zustand';
import type { ChartListParams } from '@/api/charts';
import type { Priority } from '@/api/types';
import type { SortState } from '@/hooks/useTableSort';

/**
 * Persisted view-state for the Charts list (filters, search, priority tab,
 * pagination and client-side sort). Lives outside ChartsPage so it survives
 * navigating into a chart's detail page and back — without it, the page
 * unmounts and every filter resets.
 *
 * Backed by sessionStorage: filters stick across in-app navigation and tab
 * reloads but clear when the tab closes, so a fresh session starts clean
 * rather than silently re-applying yesterday's filters. Pattern mirrors
 * scope/store.ts (plain zustand + manual storage writes).
 *
 * Note: global Client/Location scope is intentionally NOT stored here — that
 * lives in scope/store.ts and is shared across pages.
 */
const STORAGE_KEY = 'charts.view.v1';

export interface ChartsViewState {
  filters: ChartListParams;
  tab: 'ALL' | Priority;
  page: number;
  pageSize: number;
  sort: SortState;
}

const DEFAULTS: ChartsViewState = {
  filters: {},
  tab: 'ALL',
  page: 1,
  pageSize: 20,
  sort: { sortBy: undefined, sortDir: 'asc' },
};

function readInitial(): ChartsViewState {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ChartsViewState>;
    return {
      filters:
        parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {},
      tab: parsed.tab ?? 'ALL',
      page: typeof parsed.page === 'number' && parsed.page > 0 ? parsed.page : 1,
      pageSize:
        typeof parsed.pageSize === 'number' && parsed.pageSize > 0 ? parsed.pageSize : 20,
      sort:
        parsed.sort && typeof parsed.sort === 'object'
          ? { sortBy: parsed.sort.sortBy, sortDir: parsed.sort.sortDir === 'desc' ? 'desc' : 'asc' }
          : DEFAULTS.sort,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(s: ChartsViewState) {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        filters: s.filters,
        tab: s.tab,
        page: s.page,
        pageSize: s.pageSize,
        sort: s.sort,
      } satisfies ChartsViewState),
    );
  } catch {
    /* ignore quota / disabled storage */
  }
}

interface ChartsViewStore extends ChartsViewState {
  setFilters: (filters: ChartListParams) => void;
  setTab: (tab: 'ALL' | Priority) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: SortState) => void;
  reset: () => void;
}

export const useChartsView = create<ChartsViewStore>((set, get) => ({
  ...readInitial(),
  setFilters: (filters) => {
    set({ filters });
    persist(get());
  },
  setTab: (tab) => {
    set({ tab });
    persist(get());
  },
  setPage: (page) => {
    set({ page });
    persist(get());
  },
  setPageSize: (pageSize) => {
    set({ pageSize });
    persist(get());
  },
  setSort: (sort) => {
    set({ sort });
    persist(get());
  },
  reset: () => {
    set({ ...DEFAULTS });
    persist(get());
  },
}));
