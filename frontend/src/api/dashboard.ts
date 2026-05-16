import { get } from './client';
import type {
  AllocationStats,
  DashboardMilestones,
  DashboardStatus,
  DashboardUnallocated,
  DashboardSelf,
  ProductivityStats,
  UnallocatedVolume,
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
  get<AllocationStats>('/dashboard/allocation-stats', params);

export const getUnallocatedVolume = (params: DashboardFilters = {}) =>
  get<UnallocatedVolume>('/dashboard/unallocated-volume', params);

export const getProductivity = (params: DashboardFilters = {}) =>
  get<ProductivityStats>('/dashboard/productivity', params);

export const getSelfDashboard = () => get<DashboardSelf>('/dashboard/self');
