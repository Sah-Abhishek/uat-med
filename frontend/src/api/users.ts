import { get, post, patch } from './client';
import type {
  MonthAttendance,
  Paginated,
  Role,
  SignupRequest,
  AttendanceStatus,
  User,
  UserStatus,
} from './types';

/* ── Users CRUD ────────────────────────────────────────── */

export interface UserListParams {
  page?: number;
  pageSize?: number;
  status?: UserStatus;
  role?: Role;
  search?: string;
}

export const listUsers = (params: UserListParams = {}) =>
  get<Paginated<User>>('/users', params);

export const getUserStats = () =>
  get<{ active: number; inactive: number; pending: number }>('/users/stats');

export const getUser = (id: string) => get<User>(`/users/${id}`);

export interface CreateUserDto {
  email: string;
  fullName: string;
  password: string;
  role: Role;
  clientId?: number;
  locationId?: number;
  primarySpecialityId?: number;
  designation?: string;
  dateOfBirth?: string;
  dateOfJoining?: string;
}

export const createUser = (dto: CreateUserDto) => post<{ id: string }>('/users', dto);

export interface UpdateUserDto {
  fullName?: string;
  role?: Role;
  clientId?: number;
  locationId?: number;
  primarySpecialityId?: number;
  designation?: string;
  dateOfBirth?: string;
  dateOfJoining?: string;
}

export const updateUser = (id: string, dto: UpdateUserDto) =>
  patch<User>(`/users/${id}`, dto);

export const deactivateUser = (id: string, reason: string) =>
  post<{ status: string }>(`/users/${id}/deactivate`, { reason });

export const activateUser = (id: string) =>
  post<{ status: string }>(`/users/${id}/activate`);

/* ── Signup approval queue ─────────────────────────────── */

export const listSignupRequests = () =>
  get<Paginated<SignupRequest>>('/users/signup-requests');

export const approveSignupRequest = (id: string, dto: CreateUserDto) =>
  post<{ userId: string; status: string }>(
    `/users/signup-requests/${id}/approve`,
    dto,
  );

export const declineSignupRequest = (id: string, reason: string) =>
  post<{ status: string }>(`/users/signup-requests/${id}/decline`, { reason });

/* ── Attendance ────────────────────────────────────────── */

export const getAttendance = (userId: string, month: string) =>
  get<MonthAttendance>(`/users/${userId}/attendance`, { month });

export const markAttendance = (
  userId: string,
  dto: { date: string; status: AttendanceStatus },
) => post<{ status: string }>(`/users/${userId}/attendance/mark`, dto);
