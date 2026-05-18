import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuth } from '@/auth/store';
import type { ApiErrorShape } from './types';

// Resolve the API base in a multi-domain-safe way.
// We deliberately prefer a *relative* path so a single build can be served
// from multiple hostnames (e.g. uat-med.icdcore.com AND nxtcodeai.com) and
// each request goes to whatever origin the browser is currently on. If
// VITE_API_BASE is set to an absolute URL we still respect it, but only
// when its host matches the current page — otherwise we fall back to the
// relative path so the call doesn't leak across domains.
function resolveApiBase(): string {
  const fallback = '/api/v1';
  const raw = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (!raw) return fallback;
  if (raw.startsWith('/')) return raw;
  if (typeof window === 'undefined') return raw;
  try {
    const u = new URL(raw);
    if (u.host === window.location.host) return raw;
    // Configured for a different host than the page is on — use relative
    // so the request stays on the current domain.
    return u.pathname.startsWith('/') ? u.pathname : fallback;
  } catch {
    return fallback;
  }
}

export const API_BASE = resolveApiBase();

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { Accept: 'application/json' },
});

/* ── Attach bearer ─────────────────────────────────────── */
api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

/* ── Single-flight refresh ─────────────────────────────── */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const { refreshToken, setTokens, clear, user } = useAuth.getState();
    if (!refreshToken || !user) {
      clear();
      return null;
    }
    try {
      const { data } = await axios.post(
        `${API_BASE}/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );
      setTokens(data.accessToken, data.refreshToken, user);
      return data.accessToken as string;
    } catch {
      clear();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/* ── Response interceptor: 401 → refresh → retry once ──── */
api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as
      | (AxiosRequestConfig & { _retried?: boolean })
      | undefined;

    // Don't try to refresh if the failing call WAS /auth/refresh itself,
    // and don't retry login/signup.
    const url = original?.url ?? '';
    const isAuthPath = /\/auth\/(refresh|login|signup|sso\/exchange)/.test(url);

    if (err.response?.status === 401 && original && !original._retried && !isAuthPath) {
      original._retried = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        original.headers = {
          ...(original.headers as Record<string, string>),
          Authorization: `Bearer ${newToken}`,
        };
        return api(original);
      }
      if (typeof window !== 'undefined') {
        window.location.href = '/login?expired=true';
      }
    }
    throw normalizeError(err);
  },
);

export function normalizeError(err: AxiosError): ApiErrorShape {
  const body = err.response?.data as
    | {
        error?: { code?: string; message?: string; details?: Record<string, string[]> } & Record<string, unknown>;
      }
    | undefined;
  // Pull any extra keys the server set alongside code/message/details into `meta`,
  // so callers can use them (e.g. timer_conflict carries activeChartId / activeChartNo).
  let meta: Record<string, unknown> | undefined;
  if (body?.error) {
    const { code: _c, message: _m, details: _d, ...rest } = body.error;
    if (Object.keys(rest).length) meta = rest;
  }
  return {
    code: body?.error?.code ?? 'network_error',
    message: body?.error?.message ?? err.message ?? 'Request failed',
    status: err.response?.status ?? 0,
    details: body?.error?.details,
    meta,
  };
}

/* ── Thin helpers used by feature files ─────────────────── */
export async function get<T>(url: string, params?: object): Promise<T> {
  const { data } = await api.get<T>(url, { params });
  return data;
}
export async function post<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.post<T>(url, body);
  return data;
}
export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.patch<T>(url, body);
  return data;
}
export async function put<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.put<T>(url, body);
  return data;
}
export async function del<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.delete<T>(url, { data: body });
  return data;
}
