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
 * SSO exchange — trade a Microsoft-issued access token for a Valerion JWT.
 * Backend validates the token against Entra, matches the email to a local user,
 * and returns the standard LoginResponse shape.
 */
export const ssoExchange = (microsoftAccessToken: string) =>
  post<LoginResponse>('/auth/sso/exchange', { accessToken: microsoftAccessToken });