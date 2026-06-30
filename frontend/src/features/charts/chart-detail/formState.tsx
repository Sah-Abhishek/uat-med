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
