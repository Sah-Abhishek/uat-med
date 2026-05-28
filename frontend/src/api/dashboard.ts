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

/* ── Throughput: charts allocated vs worked on (today + per day) ─────── */

export interface ThroughputFilters {
  clientId?: number;
  locationId?: number;
  specialityId?: number;
  facility?: string;
  days?: number;
}

export interface ThroughputStats {
  days: number;
  allocatedToday: number;
  workedToday: number;
  allocatedPerDay: Array<{ date: string; count: number }>;
  workedPerDay: Array<{ date: string; count: number }>;
}

export const getThroughput = (params: ThroughputFilters = {}) =>
  get<ThroughputStats>('/dashboard/throughput', params);

/** AI pipeline processing-status counts across charts (scoped like throughput). */
export interface AiProcessingStatus {
  processed: number;
  error: number;
  inProgress: number;
}

export const getAiProcessingStatus = (params: ThroughputFilters = {}) =>
  get<AiProcessingStatus>('/dashboard/ai-status', params);

/** Per-day AI processing-status series (scoped like throughput). */
export interface AiProcessingStatusSeries {
  days: number;
  processedPerDay: Array<{ date: string; count: number }>;
  errorPerDay: Array<{ date: string; count: number }>;
  inProgressPerDay: Array<{ date: string; count: number }>;
}

export const getAiProcessingStatusSeries = (params: ThroughputFilters = {}) =>
  get<AiProcessingStatusSeries>('/dashboard/ai-status/series', params);

export interface ThroughputChartRow {
  chartId: number;
  chartNo: string | null;
  worklistNumber: string | null;
  clientName: string | null;
  locationName: string | null;
  specialityName: string | null;
  milestone: string;
  assigneeName: string | null;
  allocatedAt: string | null;
  lastWorkedAt: string | null;
  decisions: number;
}

export interface ThroughputChartsResponse {
  kind: 'allocated' | 'worked';
  total: number;
  page: number;
  pageSize: number;
  items: ThroughputChartRow[];
}

export const getThroughputCharts = (
  params: ThroughputFilters & { kind?: 'allocated' | 'worked'; page?: number; pageSize?: number },
) => get<ThroughputChartsResponse>('/dashboard/throughput/charts', params);

/* ── Per-user productivity (reviewer view) ───────────────────────────── */

export interface UserProductivityParams {
  userId: number;
  /** YYYY-MM-DD (the "as-of" day). */
  date: string;
  clientId?: number;
  locationId?: number;
  page?: number;
  pageSize?: number;
}

export interface UserProductivityChartRow {
  chartId: string;
  chartNo: string | null;
  milestone: string;
  /** Earliest allocation timestamp to this user (across roles). Null if the
   * user has decisions on a chart never formally allocated to them. */
  assignedAt: string | null;
  /** First decision timestamp by this user — the "first worked" anchor. */
  firstWorkedAt: string;
  /** MAX(decided_at) - MIN(decided_at) for this user on the chart, in ms.
   * 0 when there's only one decision submission (single-shot review). */
  timeSpentMs: number;
}

export interface UserProductivityResponse {
  summary: {
    assignedThatDay: number;
    workedSameDay: number;
    carriedOver: number;
    eventuallyWorked: number;
  };
  charts: UserProductivityChartRow[];
  page: number;
  pageSize: number;
  total: number;
}

export const getUserProductivity = (params: UserProductivityParams) =>
  get<UserProductivityResponse>('/dashboard/user-productivity', params);
