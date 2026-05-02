import { get, post, patch, del } from './client';
import type {
  Paginated,
  Worklist,
  WorklistDetail,
  WorklistStatus,
  WorklistStatusSummary,
  SortDir,
} from './types';

export interface WorklistListParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: SortDir;
  status?: WorklistStatus;
  clientId?: number;
  locationId?: number;
  primarySpecialityId?: number;
  processId?: number;
  receivedDateFrom?: string;
  receivedDateTo?: string;
  search?: string;
}

export const listWorklists = (params: WorklistListParams = {}) =>
  get<Paginated<Worklist>>('/worklists', params);

export const getStatusSummary = () =>
  get<WorklistStatusSummary>('/worklists/status-summary');

export const getWorklist = (id: string) =>
  get<WorklistDetail>(`/worklists/${id}`);

export interface CreateWorklistDto {
  worklistNumber: string;
  clientId: number;
  locationId: number;
  primarySpecialityId: number;
  processId: number;
  receivedDate: string;
  dateOfService?: string;
  dateOfServiceTo?: string;
  numberOfCharts?: number;
}

export const createWorklist = (dto: CreateWorklistDto) =>
  post<Worklist>('/worklists', dto);

export const updateWorklist = (id: string, dto: Partial<CreateWorklistDto>) =>
  patch<Worklist>(`/worklists/${id}`, dto);

export const deleteWorklist = (id: string, worklistNumber: string) =>
  del<{ status: string }>(`/worklists/${id}`, { worklistNumber });

export interface AllocationRange {
  from: number;
  to: number;
  assigneeId: number;
  role: 'CODER' | 'AUDITOR';
}

export const allocateWorklist = (id: string, allocations: AllocationRange[]) =>
  post<{ allocated: number; remaining: number; conflicts: unknown[] }>(
    `/worklists/${id}/allocate`,
    { allocations },
  );

export const reallocateWorklist = (id: string, range: AllocationRange) =>
  post<{ reallocated: number; remaining: number; incompleteAllocation: boolean }>(
    `/worklists/${id}/reallocate`,
    range,
  );
