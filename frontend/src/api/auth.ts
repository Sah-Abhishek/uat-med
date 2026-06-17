import { post, get } from './client';
import type { LoginResponse, User } from './types';

export const login = (username: string, password: string) =>
  post<LoginResponse>('/auth/login', { username, password });

export const refresh = (refreshToken: string) =>
  post<LoginResponse>('/auth/refresh', { refreshToken });

export const logout = (refreshToken: string) =>
  post<{ status: string }>('/auth/logout', { refreshToken });

export const logoutAll = () => post<{ status: string }>('/auth/logout/all');

export const me = () => get<User>('/auth/me');

export const changePassword = (currentPassword: string, newPassword: string) =>
  post<{ status: string }>('/auth/password/change', { currentPassword, newPassword });

export const signup = (email: string) =>
  post<{ status: string; message: string }>('/auth/signup', { email });

/**
 * SSO exchange — trade Microsoft-issued tokens for a Valerion JWT.
 * The backend verifies the ID token against Entra and matches the email to a
 * local user. The Graph access token (User.Read) is passed separately and used
 * best-effort to fetch the profile photo — Graph rejects ID tokens, so the two
 * cannot be the same token. Returns the standard LoginResponse shape.
 */
export const ssoExchange = (idToken: string, accessToken?: string) =>
  post<LoginResponse>('/auth/sso/exchange', { idToken, accessToken });