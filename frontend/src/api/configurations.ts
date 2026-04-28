import { get, put, post, patch, del } from './client';
import type { HccFieldDef, HccFieldType, ValidationRule } from './types';

/* ── General tab ───────────────────────────────────────── */

export interface GeneralConfig {
  chartListViewDays?: number;
  defaultPageSize?: number;
  allowSelfAllocation?: boolean;
  autoCloseCompletedAfterDays?: number;
  timezone?: string;
  designations?: { id: number; role: string; name: string }[];
}

export const getGeneralConfig = () => get<GeneralConfig>('/configurations/general');
export const updateGeneralConfig = (dto: Partial<GeneralConfig>) =>
  put<GeneralConfig>('/configurations/general', dto);

/* ── Clients & Locations ──────────────────────────────── */

export interface Client {
  id: number;
  name: string;
  code?: string;
  isActive: boolean;
  locations?: Location[];
}

export interface Location {
  id: number;
  clientId: number;
  name: string;
  code?: string;
  isActive: boolean;
}

export const listClients = () => get<{ items: Client[] }>('/configurations/clients');
export const createClient = (dto: Omit<Client, 'id' | 'locations'>) =>
  post<{ id: number }>('/configurations/clients', dto);

export const listLocations = (clientId: number) =>
  get<{ items: Location[] }>('/configurations/locations', { clientId });

export const createLocation = (dto: Omit<Location, 'id'>) =>
  post<{ id: number }>('/configurations/locations', dto);

/* ── Specialities → General sub-tab ───────────────────── */

export interface PrimarySpecialityEntry {
  id?: number;
  name: string;
  isActive?: boolean;
}

export interface SubSpecialityEntry {
  id?: number;
  name: string;
  primarySpecialityId?: number;
  isActive?: boolean;
}

export interface NamedEntry {
  id?: number;
  name: string;
  isActive?: boolean;
}

export interface SpecialitiesGeneralDto {
  primarySpecialities: PrimarySpecialityEntry[];
  subSpecialities: SubSpecialityEntry[];
  processes: NamedEntry[];
  facilities: NamedEntry[];
  designations: NamedEntry[];
  doesSupportProcessWiseCoding?: boolean;
}

export interface PrimarySpecialityRecord {
  id: number;
  clientId: number;
  name: string;
}
export const listPrimarySpecialities = (clientId?: number) =>
  get<{ items: PrimarySpecialityRecord[] }>(
    '/configurations/primary-specialities',
    clientId ? { clientId } : {},
  );

export interface ProcessRecord {
  id: number;
  locationId: number;
  name: string;
}
export const listProcessesByLocation = (locationId: number) =>
  get<{ items: ProcessRecord[] }>('/configurations/processes', { locationId });

export const getSpecialitiesGeneral = (scope: { clientId: number; locationId: number }) =>
  get<SpecialitiesGeneralDto>('/configurations/specialities/general', scope);

export const updateSpecialitiesGeneral = (
  dto: SpecialitiesGeneralDto & { clientId: number; locationId: number },
) => put<SpecialitiesGeneralDto>('/configurations/specialities/general', dto);

/* ── Specialities → Feedback Categories ──────────────── */

export interface FeedbackReason {
  id?: number;
  name: string;
}
export interface FeedbackArea {
  id: number;
  name: string;
  isBuiltin: boolean;
  isSystem: boolean;
  reasons: FeedbackReason[];
}

export const getFeedbackCategories = (scope: { clientId: number; locationId: number }) =>
  get<{ areas: FeedbackArea[] }>('/configurations/specialities/feedback-categories', scope);

export const updateFeedbackCategories = (
  dto: { clientId: number; locationId: number; areas: Array<{ id: number; reasons: FeedbackReason[] }> },
) =>
  put<{ areas: FeedbackArea[] }>('/configurations/specialities/feedback-categories', dto);

export const createAuditArea = (dto: { clientId: number; locationId: number; name: string }) =>
  post<{ id: number }>('/configurations/specialities/audit-areas', dto);

export const deleteAuditArea = (id: number, scope: { clientId: number; locationId: number }) =>
  del<{ status: string }>(`/configurations/specialities/audit-areas/${id}`, scope);

export const copyFeedbackCategories = (dto: {
  source: { clientId: number; locationId: number };
  destination: { clientId: number; locationId: number };
}) =>
  post<{ status: string }>(
    '/configurations/specialities/feedback-categories/copy',
    dto,
  );

/* ── Specialities → Auditing ──────────────────────────── */

export interface AuditingConfig {
  auditOptions: Array<{ id?: number; name: string }>;
  feedbackTypes: Array<{ id?: number; name: string }>;
}

export const getAuditingConfig = (scope: { clientId: number; locationId: number }) =>
  get<AuditingConfig>('/configurations/specialities/auditing', scope);

export const updateAuditingConfig = (
  dto: AuditingConfig & { clientId: number; locationId: number },
) => put<AuditingConfig>('/configurations/specialities/auditing', dto);

/* ── Specialities → Coding ────────────────────────────── */

export interface CodingConfig {
  holdReasons: Array<{ id?: number; name: string }>;
  responsibleParties: Array<{ id?: number; name: string }>;
  dispositions: Array<{ id?: number; name: string }>;
  primaryHealthPlans: Array<{ id?: number; name: string }>;
}

export const getCodingConfig = (scope: { clientId: number; locationId: number }) =>
  get<CodingConfig>('/configurations/specialities/coding', scope);

export const updateCodingConfig = (
  dto: CodingConfig & { clientId: number; locationId: number },
) => put<CodingConfig>('/configurations/specialities/coding', dto);

/* ── Specialities → Chart Field Configuration ─────────── */

export interface StandardFieldConfig {
  key: string;
  validation: ValidationRule;
}

export interface CustomChartField {
  id: number;
  name: string;
  type: HccFieldType;
  isMultiSelect: boolean;
  validation: ValidationRule;
  placement?: string;
  options?: string[];
}

export interface ChartFieldsConfig {
  standardFields: StandardFieldConfig[];
  customFields: CustomChartField[];
}

export const getChartFieldsConfig = (scope: {
  clientId: number;
  locationId: number;
  specialityId?: number | null;
}) =>
  get<ChartFieldsConfig>('/configurations/specialities/chart-fields', {
    clientId: scope.clientId,
    locationId: scope.locationId,
    ...(scope.specialityId ? { specialityId: scope.specialityId } : {}),
  });

export const updateChartFieldsConfig = (
  dto: ChartFieldsConfig & { clientId: number; locationId: number; specialityId?: number | null },
) => put<ChartFieldsConfig>('/configurations/specialities/chart-fields', dto);

export type CreateCustomChartFieldDto = Omit<CustomChartField, 'id'> & {
  clientId: number;
  locationId: number;
  specialityId?: number | null;
};

export const createCustomChartField = (dto: CreateCustomChartFieldDto) =>
  post<{ id: number }>('/configurations/specialities/chart-fields/custom', dto);

export const updateCustomChartField = (id: number, dto: Partial<CustomChartField>) =>
  patch<CustomChartField>(
    `/configurations/specialities/chart-fields/custom/${id}`,
    dto,
  );

export const deleteCustomChartField = (id: number) =>
  del<{ status: string }>(
    `/configurations/specialities/chart-fields/custom/${id}`,
  );

/* ── HCC Fields config ─────────────────────────────────── */

export const listHccFieldConfig = () =>
  get<HccFieldDef[]>('/configurations/hcc/fields');

export type CreateHccFieldDto = Omit<HccFieldDef, 'id'>;

export const createHccField = (dto: CreateHccFieldDto) =>
  post<{ id: number }>('/configurations/hcc/fields', dto);

export const updateHccField = (id: number, dto: Partial<HccFieldDef>) =>
  patch<HccFieldDef>(`/configurations/hcc/fields/${id}`, dto);

export const deleteHccField = (id: number) =>
  del<{ status: string }>(`/configurations/hcc/fields/${id}`);