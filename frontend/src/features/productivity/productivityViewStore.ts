import { create } from 'zustand';
import type { ThroughputFilters } from '@/api/dashboard';

/**
 * Persisted filter-state for the Productivity page. Lives outside
 * ProductivityPage so the chosen window / client / location / speciality /
 * facility / user survive navigating away (e.g. into a chart) and back —
 * without it the page unmounts and every filter resets to the default window.
 *
 * Backed by sessionStorage (mirrors charts/chartsViewStore.ts): filters stick
 * across in-app navigation and tab reloads but clear when the tab closes, so a
 * fresh session starts clean rather than re-applying yesterday's filters.
 */
const STORAGE_KEY = 'productivity.view.v1';

/** Default window = last 30 days, no scope. Reset returns here. */
const DEFAULT_FILTERS: ThroughputFilters = { days: 30 };

interface ProductivityViewState {
  filters: ThroughputFilters;
}

function readInitial(): ProductivityViewState {
  if (typeof window === 'undefined') return { filters: { ...DEFAULT_FILTERS } };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { filters: { ...DEFAULT_FILTERS } };
    const parsed = JSON.parse(raw) as Partial<ProductivityViewState>;
    return {
      filters:
        parsed.filters && typeof parsed.filters === 'object'
          ? parsed.filters
          : { ...DEFAULT_FILTERS },
    };
  } catch {
    return { filters: { ...DEFAULT_FILTERS } };
  }
}

function persist(s: ProductivityViewState) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters: s.filters }));
  } catch {
    /* ignore quota / disabled storage */
  }
}

interface ProductivityViewStore extends ProductivityViewState {
  setFilters: (filters: ThroughputFilters) => void;
  reset: () => void;
}

export const useProductivityView = create<ProductivityViewStore>((set, get) => ({
  ...readInitial(),
  setFilters: (filters) => {
    set({ filters });
    persist(get());
  },
  reset: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    persist(get());
  },
}));
