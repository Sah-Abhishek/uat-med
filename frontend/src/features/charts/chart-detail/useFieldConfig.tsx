import { useQuery } from '@tanstack/react-query';
import { getWorklist } from '@/api/worklists';
import {
  getChartFieldsConfig,
  getCodingConfig,
  getSpecialitiesGeneral,
  getAuditingConfig,
} from '@/api/configurations';
import type { Chart } from '@/api/types';

export type FieldValidation = 'MANDATORY' | 'NON_MANDATORY' | 'NOT_APPLICABLE';

/** Option lists pulled from the per-(client, location) configurations. */
export interface ChartOptions {
  dispositions: string[];
  primaryHealthPlans: string[];
  facilities: string[];
  subSpecialities: string[];
  holdReasons: string[];
  responsibleParties: string[];
  auditOptions: string[];
  feedbackTypes: string[];
}

const EMPTY_OPTIONS: ChartOptions = {
  dispositions: [],
  primaryHealthPlans: [],
  facilities: [],
  subSpecialities: [],
  holdReasons: [],
  responsibleParties: [],
  auditOptions: [],
  feedbackTypes: [],
};

/**
 * Resolves the standard-fields config for the given chart's
 * (client, location, primary speciality) combo.
 *
 * The config is a baseline keyed by `fieldKey`, e.g. `chartNo`, `mrNumber`,
 * `dos`, etc. Anything not in the response defaults to `NON_MANDATORY`
 * (visible, optional) — same as having no row for it.
 */
export function useFieldConfig(chart: Chart) {
  const worklist = useQuery({
    queryKey: ['worklist', chart.worklistId],
    queryFn: () => getWorklist(chart.worklistId),
    enabled: !!chart.worklistId,
    staleTime: 60_000,
  });

  // Use the SAME query key the configurations page uses so a save there
  // invalidates this query automatically (no stale cache after edits).
  const config = useQuery({
    queryKey: [
      'configurations',
      'chart-fields',
      worklist.data?.clientId,
      worklist.data?.locationId,
      worklist.data?.primarySpecialityId ?? null,
    ],
    queryFn: () =>
      getChartFieldsConfig({
        clientId: worklist.data!.clientId,
        locationId: worklist.data!.locationId,
        specialityId: worklist.data!.primarySpecialityId,
      }),
    enabled: !!worklist.data,
  });

  const scopeReady = !!worklist.data;
  const scopeArgs = scopeReady
    ? { clientId: worklist.data!.clientId, locationId: worklist.data!.locationId }
    : null;

  const codingCfg = useQuery({
    queryKey: ['configurations', 'coding', scopeArgs?.clientId, scopeArgs?.locationId],
    queryFn: () => getCodingConfig(scopeArgs!),
    enabled: scopeReady,
  });
  const generalCfg = useQuery({
    queryKey: ['configurations', 'specialities-general', scopeArgs?.clientId, scopeArgs?.locationId],
    queryFn: () => getSpecialitiesGeneral(scopeArgs!),
    enabled: scopeReady,
  });
  const auditingCfg = useQuery({
    queryKey: ['configurations', 'auditing', scopeArgs?.clientId, scopeArgs?.locationId],
    queryFn: () => getAuditingConfig(scopeArgs!),
    enabled: scopeReady,
  });

  const map = new Map<string, FieldValidation>();
  for (const f of config.data?.standardFields ?? []) {
    map.set(f.key, f.validation as FieldValidation);
  }

  const options: ChartOptions = scopeReady
    ? {
        dispositions: (codingCfg.data?.dispositions ?? []).map((x) => x.name),
        primaryHealthPlans: (codingCfg.data?.primaryHealthPlans ?? []).map((x) => x.name),
        holdReasons: (codingCfg.data?.holdReasons ?? []).map((x) => x.name),
        responsibleParties: (codingCfg.data?.responsibleParties ?? []).map((x) => x.name),
        facilities: (generalCfg.data?.facilities ?? []).map((x) => x.name),
        // Filter sub-specialities to ones that belong to the chart's primary speciality
        // (when the entry has a primarySpecialityId). Entries without an id come through verbatim.
        subSpecialities: (generalCfg.data?.subSpecialities ?? [])
          .filter(
            (x) =>
              !x.primarySpecialityId ||
              x.primarySpecialityId === worklist.data?.primarySpecialityId,
          )
          .map((x) => x.name),
        auditOptions: (auditingCfg.data?.auditOptions ?? []).map((x) => x.name),
        feedbackTypes: (auditingCfg.data?.feedbackTypes ?? []).map((x) => x.name),
      }
    : EMPTY_OPTIONS;

  return {
    isLoading:
      worklist.isPending ||
      config.isPending ||
      codingCfg.isPending ||
      generalCfg.isPending ||
      auditingCfg.isPending,
    getValidation: (key: string): FieldValidation => map.get(key) ?? 'NON_MANDATORY',
    isVisible: (key: string) => map.get(key) !== 'NOT_APPLICABLE',
    isRequired: (key: string) => map.get(key) === 'MANDATORY',
    /** Raw map of fieldKey → validation — useful for save-time validation. */
    standardMap: map,
    customFields: config.data?.customFields ?? [],
    options,
  };
}

export type FieldConfig = ReturnType<typeof useFieldConfig>;

/**
 * Map config field keys → form draft keys + display labels.
 * Config keys (from `STANDARD_CHART_FIELDS` in the configurations page) sometimes
 * differ slightly from the keys we used in `FormDraft` (e.g. `mrNumber` vs `mrNo`,
 * `dos` vs `dateOfService`). Centralise the mapping so save-time validation can
 * resolve the right draft slot.
 */
export const STANDARD_FIELD_MAP: Array<{
  key: string;
  draftKey: string;
  label: string;
  placement: 'Chart Info' | 'Processing Info';
  /** True when an empty array (not just empty string) counts as "missing". */
  isArray?: boolean;
}> = [
  { key: 'chartNo', draftKey: 'chartNo', label: 'Chart #', placement: 'Chart Info' },
  { key: 'mrNumber', draftKey: 'mrNo', label: 'MR #', placement: 'Chart Info' },
  { key: 'dos', draftKey: 'dateOfService', label: 'Date of Service', placement: 'Chart Info' },
  { key: 'admitDate', draftKey: 'admitDate', label: 'Admit date', placement: 'Chart Info' },
  { key: 'dischargeDate', draftKey: 'dischargeDate', label: 'Discharge date', placement: 'Chart Info' },
  { key: 'disposition', draftKey: 'disposition', label: 'Disposition', placement: 'Chart Info' },
  { key: 'emLevel', draftKey: 'em', label: 'EM', placement: 'Chart Info' },
  { key: 'primaryDiagnosis', draftKey: 'primaryDiagnosis', label: 'Primary diagnosis', placement: 'Chart Info' },
  { key: 'primaryHealthPlan', draftKey: 'primaryHealth', label: 'Primary Health Plan', placement: 'Chart Info' },
  { key: 'facility', draftKey: 'facility', label: 'Facility', placement: 'Chart Info' },
  { key: 'poa', draftKey: 'poa', label: 'POA', placement: 'Chart Info' },
  { key: 'los', draftKey: 'los', label: 'LOS', placement: 'Chart Info' },
  { key: 'drgValue', draftKey: 'drgValue', label: 'DRG Value', placement: 'Chart Info' },
  { key: 'procedureCode', draftKey: 'procedureCode', label: 'Procedure code', placement: 'Chart Info' },
  { key: 'subSpeciality', draftKey: 'subSpecialty', label: 'Sub Specialty', placement: 'Chart Info' },
  { key: 'chartStatus', draftKey: 'chartStatus', label: 'Chart status', placement: 'Processing Info' },
  { key: 'responsibleParty', draftKey: 'responsibleParty', label: 'Responsible party', placement: 'Processing Info', isArray: true },
  { key: 'coderCommentsToClient', draftKey: 'coderComments', label: 'Coder comments to client', placement: 'Processing Info' },
  { key: 'rejectionDenialComments', draftKey: 'rejectionComments', label: 'Rejection / Denial Comments', placement: 'Processing Info' },
  { key: 'deficiencyComments', draftKey: 'deficiencyComments', label: 'Deficiency Comments', placement: 'Processing Info' },
];
