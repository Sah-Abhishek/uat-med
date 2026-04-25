import { get } from './client';
import type {
  DashboardMilestones,
  DashboardStatus,
  DashboardUnallocated,
  DashboardSelf,
} from './types';

export interface DashboardFilters {
  clientId?: number;
  locationId?: number;
}

export const getMilestones = (params: DashboardFilters = {}) =>
  get<DashboardMilestones>('/dashboard/milestones', params);

export const getStatus = (params: DashboardFilters = {}) =>
  get<DashboardStatus>('/dashboard/status', params);

export const getUnallocated = (params: DashboardFilters = {}) =>
  get<DashboardUnallocated>('/dashboard/unallocated', params);

export const getAllocationStats = (params: DashboardFilters = {}) =>
  get<Record<string, unknown>>('/dashboard/allocation-stats', params);

export const getSelfDashboard = () => get<DashboardSelf>('/dashboard/self');
