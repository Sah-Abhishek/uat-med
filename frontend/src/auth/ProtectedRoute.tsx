import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './store';
import { refresh } from '@/api/auth';
import type { LoginResponse } from '@/api/types';
import { Loader2 } from 'lucide-react';

/**
 * Module-level single-flight guard. Survives React StrictMode's mount→unmount→mount
 * cycle so the refresh token (which the backend rotates on every use) is never sent
 * twice — a second send would trip the backend's reuse-detection and revoke all
 * sessions for the user.
 */
let bootstrapInFlight: Promise<LoginResponse> | null = null;

/**
 * Wraps protected routes:
 *  - If we have an access token: render.
 *  - If we have ONLY a refresh token (page reload): try to bootstrap a new access token.
 *  - Otherwise: redirect to /login.
 */
export function ProtectedRoute() {
  const { accessToken, refreshToken, user, setTokens, clear } = useAuth();
  const location = useLocation();
  const [bootstrapping, setBootstrapping] = useState<boolean>(
    !accessToken && !!refreshToken && !!user,
  );

  useEffect(() => {
    let cancelled = false;
    if (!accessToken && refreshToken && user) {
      setBootstrapping(true);
      const p = bootstrapInFlight ?? (bootstrapInFlight = refresh(refreshToken));
      p
        .then((res) => {
          if (cancelled) return;
          setTokens(res.accessToken, res.refreshToken, {
            id: res.user.id,
            email: res.user.email,
            fullName: res.user.fullName,
            role: res.user.role,
            clientId: res.user.clientId,
            locationId: res.user.locationId,
          });
        })
        .catch(() => {
          if (!cancelled) clear();
        })
        .finally(() => {
          bootstrapInFlight = null;
          if (!cancelled) setBootstrapping(false);
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!accessToken || !user) {
    return (
      <Navigate
        to={`/login${location.pathname !== '/' ? `?redirect=${encodeURIComponent(location.pathname)}` : ''}`}
        replace
      />
    );
  }

  return <Outlet />;
}
