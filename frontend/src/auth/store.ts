import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LoginResponse, Role } from '@/api/types';

interface StoredUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  clientId: number | null;
  locationId: number | null;
}

interface AuthState {
  user: StoredUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** Transient — true only while we are bootstrapping a refresh on mount */
  bootstrapping: boolean;

  setTokens: (accessToken: string, refreshToken: string, user: StoredUser) => void;
  setFromLogin: (res: LoginResponse) => void;
  setAccessToken: (accessToken: string) => void;
  setBootstrapping: (b: boolean) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      bootstrapping: false,

      setTokens: (accessToken, refreshToken, user) =>
        set({ accessToken, refreshToken, user }),

      setFromLogin: (res) =>
        set({
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          user: {
            id: res.user.id,
            email: res.user.email,
            fullName: res.user.fullName,
            role: res.user.role,
            clientId: res.user.clientId,
            locationId: res.user.locationId,
          },
        }),

      setAccessToken: (accessToken) => set({ accessToken }),
      setBootstrapping: (b) => set({ bootstrapping: b }),
      clear: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          bootstrapping: false,
        }),
    }),
    {
      name: 'valerion-auth',
      storage: createJSONStorage(() => sessionStorage),
      // Access token stays in memory only; survives page reload via refresh bootstrap.
      partialize: (s) => ({ refreshToken: s.refreshToken, user: s.user }),
    },
  ),
);
