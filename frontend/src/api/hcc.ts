import { get, post, patch, del } from './client';
import type {
  HccFieldDef,
  HccRecord,
  HccValidate,
  Paginated,
  SortDir,
} from './types';

/* ── List ──────────────────────────────────────────────── */

export interface HccListParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: SortDir;
  memberId?: string;
  medicareNo?: string;
  coderId?: number | string;
  v24Icd?: string;
  v28Icd?: string;
  validate?: HccValidate;
  dateOfServiceFrom?: string;
  dateOfServiceTo?: string;
  receivedDateFrom?: string;
  receivedDateTo?: string;
}

export const listHccRecords = (params: HccListParams = {}) =>
  get<Paginated<HccRecord>>('/hcc/records', params);

/* ── CRUD ──────────────────────────────────────────────── */

export interface CreateHccRecordDto {
  memberId: string;
  memberName: string;
  medicareNo?: string;
  dob?: string;
  coderId?: number;
  payor?: string;
  dos?: string;
  reviewDate?: string;
  receivedDate?: string;
  v24Icd?: string;
  v24IcdDescription?: string;
  v24HccValue?: number;
  v28Icd?: string;
  v28IcdDescription?: string;
  v28HccValue?: number;
  validate?: HccValidate;
  reasonCode?: string;
  source?: string;
  reviewerNote?: string;
  customFields?: Record<string, unknown>;
}

export const createHccRecord = (dto: CreateHccRecordDto) =>
  post<{ id: string }>('/hcc/records', dto);

export interface SaveAndNextResponse {
  saved: { id: string };
  nextTemplate: Partial<CreateHccRecordDto>;
}
export const saveAndNextHccRecord = (dto: CreateHccRecordDto) =>
  post<SaveAndNextResponse>('/hcc/records/save-and-next', dto);

export const getHccRecord = (id: string) => get<HccRecord>(`/hcc/records/${id}`);

export const updateHccRecord = (id: string, dto: Partial<CreateHccRecordDto>) =>
  patch<HccRecord>(`/hcc/records/${id}`, dto);

export const deleteHccRecord = (id: string) =>
  del<{ status: string }>(`/hcc/records/${id}`);

/* ── Fields ────────────────────────────────────────────── */

export const getHccFields = () => get<HccFieldDef[]>('/hcc/fields');
