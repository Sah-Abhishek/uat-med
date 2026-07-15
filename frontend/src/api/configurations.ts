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

/** Pass `includeInactive` from management views to also list soft-deleted
 * (deactivated) rows; omit it elsewhere so deactivated clients stay hidden. */
export const listClients = (opts?: { includeInactive?: boolean }) =>
  get<{ items: Client[] }>('/configurations/clients', opts?.includeInactive ? { includeInactive: true } : undefined);
export const createClient = (dto: Omit<Client, 'id' | 'locations'>) =>
  post<{ id: number }>('/configurations/clients', dto);
export const updateClient = (id: number, dto: Partial<Omit<Client, 'id' | 'locations'>>) =>
  patch<{ id: number }>(`/configurations/clients/${id}`, dto);
/** Soft delete — deactivates the client (isActive=false). */
export const deleteClient = (id: number) =>
  del<{ id: number; isActive: boolean }>(`/configurations/clients/${id}`);
/** Hard delete with cascade — permanently removes the client, its locations,
 * and all worklists/charts under it. Irreversible. */
export const cascadeDeleteClient = (id: number) =>
  del<{ id: number; deleted: boolean }>(`/configurations/clients/${id}/cascade`);

export const listLocations = (clientId: number, opts?: { includeInactive?: boolean }) =>
  get<{ items: Location[] }>('/configurations/locations', {
    clientId,
    ...(opts?.includeInactive ? { includeInactive: true } : {}),
  });
export const createLocation = (dto: Omit<Location, 'id'>) =>
  post<{ id: number }>('/configurations/locations', dto);
export const updateLocation = (id: number, dto: Partial<Omit<Location, 'id' | 'clientId'>>) =>
  patch<{ id: number }>(`/configurations/locations/${id}`, dto);
/** Soft delete — deactivates the location (isActive=false). */
export const deleteLocation = (id: number) =>
  del<{ id: number; isActive: boolean }>(`/configurations/locations/${id}`);
/** Hard delete with cascade — permanently removes the location and all
 * worklists/charts under it. Irreversible. */
export const cascadeDeleteLocation = (id: number) =>
  del<{ id: number; deleted: boolean }>(`/configurations/locations/${id}/cascade`);

/* ── Service Lines (global lookup, picked at document upload) ── */

export interface ServiceLine {
  id: number;
  name: string;
  code?: string;
  sortOrder: number;
  isActive: boolean;
}

/** List service lines. Pass `includeInactive` from the management view to also
 * show soft-deleted (deactivated) rows; omit it everywhere else (the upload
 * dropdown) so deactivated lines stay hidden. Ordered by sortOrder server-side. */
export const listServiceLines = (opts?: { includeInactive?: boolean }) =>
  get<{ items: ServiceLine[] }>(
    '/configurations/service-lines',
    opts?.includeInactive ? { includeInactive: true } : undefined,
  );
export const createServiceLine = (dto: { name: string; code?: string; sortOrder?: number; isActive?: boolean }) =>
  post<{ id: number }>('/configurations/service-lines', dto);
export const updateServiceLine = (
  id: number,
  dto: Partial<{ name: string; code?: string; sortOrder: number; isActive: boolean }>,
) => patch<{ id: number }>(`/configurations/service-lines/${id}`, dto);
/** Soft delete — deactivates the service line (isActive=false). */
export const deleteServiceLine = (id: number) =>
  del<{ id: number; isActive: boolean }>(`/configurations/service-lines/${id}`);

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

export interface SubSpecialityRecord {
  id: number;
  locationId: number;
  name: string;
}
/** Active sub-specialities for a location (location-scoped, like processes). */
export const listSubSpecialities = (locationId: number) =>
  get<{ items: SubSpecialityRecord[] }>('/configurations/sub-specialities', { locationId });

/** Every distinct sub-speciality NAME across all locations (deduped) — for the
 * charts "all unique sub-specialities" filter, which matches by name. */
export const listAllSubSpecialities = () =>
  get<{ items: Array<{ name: string }> }>('/configurations/sub-specialities/all');

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
  /** Whether this area renders as a row in the chart Audit Information table.
   * Deactivating hides it (including built-ins) without losing its reasons. */
  isActive: boolean;
  reasons: FeedbackReason[];
}

export const getFeedbackCategories = (scope: { clientId: number; locationId: number }) =>
  get<{ areas: FeedbackArea[] }>('/configurations/specialities/feedback-categories', scope);

export const updateFeedbackCategories = (
  dto: {
    clientId: number;
    locationId: number;
    areas: Array<{ id: number; reasons: FeedbackReason[]; isActive?: boolean }>;
  },
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
  post<{ status: string; areasAdded: number; reasonsAdded: number; areas: FeedbackArea[] }>(
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

export const copyCustomChartFields = (dto: {
  source: { clientId: number; locationId: number };
  destination: { clientId: number; locationId: number; specialityId?: number | null };
}) =>
  post<{ status: string; fieldsAdded: number } & ChartFieldsConfig>(
    '/configurations/specialities/chart-fields/custom/copy',
    dto,
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

/* ── Code Review Reasons ───────────────────────────────── */

export type CodeReviewType = 'PRIMARY' | 'SECONDARY' | 'PROCEDURE' | 'EM_LEVEL' | 'MODIFIER';
export type CodeReviewAction = 'REJECT' | 'EDIT';

export const CODE_REVIEW_TYPES: CodeReviewType[] = ['PRIMARY', 'SECONDARY', 'PROCEDURE', 'EM_LEVEL', 'MODIFIER'];
export const CODE_REVIEW_ACTIONS: CodeReviewAction[] = ['REJECT', 'EDIT'];

export const CODE_REVIEW_TYPE_LABEL: Record<CodeReviewType, string> = {
  PRIMARY: 'Primary Diagnosis',
  SECONDARY: 'Secondary Diagnosis',
  PROCEDURE: 'CPT / Procedures',
  EM_LEVEL: 'ED/EM Level',
  MODIFIER: 'Modifier',
};

export const CODE_REVIEW_ACTION_LABEL: Record<CodeReviewAction, string> = {
  REJECT: 'Reject',
  EDIT: 'Edit',
};

export interface CodeReviewReasonRow {
  id: number;
  codeType: CodeReviewType;
  action: CodeReviewAction;
  text: string;
  displayOrder: number;
  isActive: boolean;
}

export interface CodeReviewReasonInput {
  id?: number;
  text: string;
  displayOrder?: number;
  isActive?: boolean;
}

export const getCodeReviewReasons = (scope: { clientId: number; locationId: number }) =>
  get<{ items: CodeReviewReasonRow[] }>('/configurations/code-review-reasons', scope);

export const updateCodeReviewReasons = (dto: {
  clientId: number;
  locationId: number;
  codeType: CodeReviewType;
  action: CodeReviewAction;
  reasons: CodeReviewReasonInput[];
}) => put<{ items: CodeReviewReasonRow[] }>('/configurations/code-review-reasons', dto);

export const copyCodeReviewReasons = (dto: {
  sourceClientId: number;
  sourceLocationId: number;
  targetClientId: number;
  targetLocationId: number;
  codeTypes?: CodeReviewType[];
  actions?: CodeReviewAction[];
  includeDisabled?: boolean;
}) => post<{ copied: number; skipped: number }>('/configurations/code-review-reasons/copy', dto);