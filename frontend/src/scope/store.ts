import { create } from 'zustand';

/**
 * Global Client / Location scope, driven by the header pickers in TopBar and
 * consumed by data pages (Charts, Dashboard, Worklists) to scope their queries.
 * `null` means "All". Persisted to localStorage so the scope survives reloads,
 * matching the sticky behaviour users expect from a global filter.
 *
 * Pattern mirrors theme/store.ts (plain zustand + manual localStorage).
 */
const STORAGE_KEY = 'valerion-scope';

interface PersistedScope {
  clientId: number | null;
  locationId: number | null;
}

function readInitial(): PersistedScope {
  if (typeof window === 'undefined') return { clientId: null, locationId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedScope>;
      return {
        clientId: typeof parsed.clientId === 'number' ? parsed.clientId : null,
        locationId: typeof parsed.locationId === 'number' ? parsed.locationId : null,
      };
    }
  } catch {
    /* noop */
  }
  return { clientId: null, locationId: null };
}

function persist(s: PersistedScope) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

interface ScopeState extends PersistedScope {
  /** Set the active client. Clears location too — a location belongs to one
   * client, so a stale location must not survive a client switch. */
  setClient: (id: number | null) => void;
  setLocation: (id: number | null) => void;
  reset: () => void;
}

export const useScope = create<ScopeState>((set, get) => ({
  ...readInitial(),
  setClient: (id) => {
    const next = { clientId: id, locationId: null };
    persist(next);
    set(next);
  },
  setLocation: (id) => {
    const next = { clientId: get().clientId, locationId: id };
    persist(next);
    set({ locationId: id });
  },
  reset: () => {
    const next = { clientId: null, locationId: null };
    persist(next);
    set(next);
  },
}));
