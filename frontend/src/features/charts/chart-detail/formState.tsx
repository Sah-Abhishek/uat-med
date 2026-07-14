import { useState, useCallback } from 'react';

/**
 * Single source of truth for the chart-detail form sections.
 * Keys mirror the source's `formData` object (snake-cased fields collapsed
 * to camelCase). All optional — backend doesn't yet persist most of these.
 */
export interface FormDraft {
  // Chart Info
  chartNo: string;
  mrNo: string;
  dateOfService: string;
  admitDate: string;
  dischargeDate: string;
  disposition: string;
  em: string;
  primaryDiagnosis: string;
  primaryDiagnosisDescription: string;
  primaryHealth: string;
  facility: string;
  poa: string;
  los: string;
  drgValues: Array<{ code: string; description: string }>;
  procedureCode: string;
  pcsCodes: Array<{ code: string; description: string }>;
  subSpecialty: string;

  // Processing Info
  chartStatus: string;
  responsibleParty: string[];
  holdReason: string[];
  coderComments: string;
  rejectionComments: string;
  deficiencyComments: string;
  auditOption: string[];
  qcStatus: string;
  allocateAuditor: string;
  allocateCoder: string;
  priority: string;

  // Audit (below-table)
  feedbackType: string;
  auditorQcStatus: string;
  auditAllocateCoder: string;

  /** Tracks fields that were AI-prefilled. Cleared on user edit. */
  _aiFields?: Set<string>;
}

export interface AuditCell {
  totalCodes: string;
  correctCodes: string;
  feedbackCategory: string | string[];
}

/**
 * Canonical QC Status options — the single source of truth for every QC Status
 * dropdown (Coder QC Status, Auditor QC Status) and mirrored by the Reports
 * QC Status filter (backend reports.service.ts). "Blank" carries an empty value
 * meaning "not set", so it's only offered on optional fields; required fields
 * use QC_STATUS_OPTIONS_REQUIRED (the concrete statuses only).
 */
export const QC_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'Agree', label: 'Agree' },
  { value: 'Feedback Implemented', label: 'Feedback Implemented' },
  { value: 'Feedback Rejected', label: 'Feedback Rejected' },
  { value: 'Feedback Provided', label: 'Feedback Provided' },
  { value: '', label: 'Blank' },
];
export const QC_STATUS_OPTIONS_REQUIRED = QC_STATUS_OPTIONS.filter((o) => o.value !== '');

// User Manual §4.1: "Only 'Feedback Provided' and 'Agree' are available to the
// Auditor to change, whilst 'Feedback Implemented' and 'Feedback Rejected' are
// available to the Coder to change." Each role's QC-status dropdown offers only
// its own values.
export const CODER_QC_STATUS_OPTIONS = QC_STATUS_OPTIONS.filter(
  (o) => o.value === 'Feedback Implemented' || o.value === 'Feedback Rejected',
);
export const AUDITOR_QC_STATUS_OPTIONS = QC_STATUS_OPTIONS.filter(
  (o) => o.value === 'Agree' || o.value === 'Feedback Provided',
);

export const EMPTY_FORM_DRAFT: FormDraft = {
  chartNo: '',
  mrNo: '',
  dateOfService: '',
  admitDate: '',
  dischargeDate: '',
  disposition: '',
  em: '',
  primaryDiagnosis: '',
  primaryDiagnosisDescription: '',
  primaryHealth: '',
  facility: '',
  poa: '',
  los: '',
  drgValues: [],
  procedureCode: '',
  pcsCodes: [],
  subSpecialty: '',
  // Empty draft slot renders as the "Open" placeholder in the chart-status
  // select. The user only sees / picks "Complete" or "Incomplete"; saving an
  // empty value writes ChartStatus.OPEN on the API.
  chartStatus: '',
  responsibleParty: [],
  holdReason: [],
  coderComments: '',
  rejectionComments: '',
  deficiencyComments: '',
  auditOption: [],
  qcStatus: '',
  allocateAuditor: '',
  allocateCoder: '',
  priority: '',
  feedbackType: '',
  auditorQcStatus: '',
  auditAllocateCoder: '',
};

export type FormUpdater = (k: keyof FormDraft, v: unknown) => void;

export function useFormDraft(initial?: Partial<FormDraft>) {
  const [draft, setDraft] = useState<FormDraft>({ ...EMPTY_FORM_DRAFT, ...initial });

  const update: FormUpdater = useCallback((k, v) => {
    setDraft((prev) => {
      const ai = prev._aiFields;
      if (ai && typeof k === 'string' && ai.has(k)) {
        const next = new Set(ai);
        next.delete(k);
        return { ...prev, [k]: v, _aiFields: next } as FormDraft;
      }
      return { ...prev, [k]: v } as FormDraft;
    });
  }, []);

  return { draft, update, setDraft };
}

/**
 * Custom-field values keyed by field id. Stored as plain JSON so the same
 * shape can be persisted on `Chart.customFields` (jsonb).
 */
export type CustomFieldValues = Record<string, unknown>;

export function useCustomFieldValues(initial?: CustomFieldValues) {
  const [values, setValues] = useState<CustomFieldValues>(initial ?? {});
  const updateValue = useCallback((id: number, v: unknown) => {
    setValues((prev) => ({ ...prev, [String(id)]: v }));
  }, []);
  return { values, updateValue, setValues };
}

export function useAuditDraft(initial?: Record<string, AuditCell>) {
  const [audit, setAudit] = useState<Record<string, AuditCell>>(initial ?? {});

  const updateAudit = useCallback(
    (rowKey: string, field: keyof AuditCell, value: string | string[]) => {
      setAudit((prev) => {
        const row: AuditCell = { ...(prev[rowKey] ?? { totalCodes: '', correctCodes: '', feedbackCategory: '' }) };
        (row as unknown as Record<string, unknown>)[field] = value;
        // Cap correct ≤ total
        const total = parseInt(row.totalCodes, 10);
        const correct = parseInt(typeof row.correctCodes === 'string' ? row.correctCodes : '', 10);
        if (!isNaN(total) && !isNaN(correct) && correct > total) {
          row.correctCodes = String(total);
        }
        return { ...prev, [rowKey]: row };
      });
    },
    [],
  );

  return { audit, updateAudit, setAudit };
}
