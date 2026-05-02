import { useState } from 'react';
import { CollapsibleCard } from '@/components/ui/Card';
import { Toast } from '@/components/ui/Primitives';
import { FormField, SkeletonGrid } from './shared';
import { CustomFieldsRenderer } from './CustomFieldsRenderer';
import type { FormDraft, CustomFieldValues } from './formState';
import type { FieldConfig } from './useFieldConfig';

/**
 * Enforce admit ≤ dateOfService ≤ discharge. Returns a user-facing message
 * naming which field needs to be greater, or null if all populated values
 * are in order. Empty strings ("") are skipped — only populated values are
 * compared. ISO `YYYY-MM-DD` strings sort lexically the same as by date.
 */
function validateDateOrder(d: {
  admitDate: string;
  dateOfService: string;
  dischargeDate: string;
}): string | null {
  const { admitDate: a, dateOfService: dos, dischargeDate: dd } = d;
  if (a && dos && a > dos)
    return 'Admit date must be on or before Date of Service — Date of Service should be greater.';
  if (dos && dd && dos > dd)
    return 'Date of Service must be on or before Discharge date — Discharge date should be greater.';
  if (a && dd && a > dd)
    return 'Admit date must be on or before Discharge date — Discharge date should be greater.';
  return null;
}

interface Props {
  draft: FormDraft;
  update: (k: keyof FormDraft, v: unknown) => void;
  readOnly?: boolean;
  isAuditor?: boolean;
  cfg: FieldConfig;
  customValues: CustomFieldValues;
  updateCustomValue: (id: number, v: unknown) => void;
  /** Clamp Date of Service to the parent worklist's service-date range. */
  dosMin?: string;
  dosMax?: string;
}

export function ChartInfoSection({
  draft,
  update,
  readOnly,
  isAuditor,
  cfg,
  customValues,
  updateCustomValue,
  dosMin,
  dosMax,
}: Props) {
  const dim = isAuditor ? 'opacity-50 pointer-events-none grayscale' : readOnly ? 'pointer-events-none' : '';
  const [orderAlert, setOrderAlert] = useState<string | null>(null);

  function handleDateChange(
    field: 'admitDate' | 'dateOfService' | 'dischargeDate',
    v: string,
  ) {
    // Validate against the would-be next state. If it would break the order,
    // reject the value (don't call update) so the picker re-renders with the
    // previous one and the user sees a top-right toast naming the issue.
    const next = {
      admitDate: draft.admitDate,
      dateOfService: draft.dateOfService,
      dischargeDate: draft.dischargeDate,
      [field]: v,
    };
    const msg = validateDateOrder(next);
    if (msg) {
      setOrderAlert(msg);
      return;
    }
    update(field, v);
  }

  // Until the per-combo config arrives, render a skeleton instead of flashing
  // every field as visible/optional and then re-arranging once data loads.
  if (cfg.isLoading) {
    return (
      <CollapsibleCard title="Chart Info" subtitle="All relevant chart fields" defaultOpen>
        <div className="pt-3">
          <SkeletonGrid cols={3} count={3} />
          <SkeletonGrid cols={3} count={2} />
          <SkeletonGrid cols={3} count={3} />
          <SkeletonGrid cols={2} count={2} />
          <SkeletonGrid cols={3} count={3} />
          <SkeletonGrid cols={3} count={2} />
        </div>
      </CollapsibleCard>
    );
  }

  // Tiny helper so the field markup stays clean.
  const visible = (k: string) => cfg.isVisible(k);
  const required = (k: string) => cfg.isRequired(k);

  // Track whether either field in a row is visible to avoid empty grid rows.
  const row2Visible = visible('admitDate') || visible('dischargeDate');
  const row4Visible = visible('primaryHealthPlan') || visible('facility');
  const row5Visible = visible('poa') || visible('los') || visible('drgValue');
  const row6Visible = visible('procedureCode') || visible('subSpeciality');

  return (
    <CollapsibleCard title="Chart Info" subtitle="All relevant chart fields" defaultOpen>
      <div className={`pt-3 ${dim}`}>
        {/* Row 1 */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          {visible('chartNo') && (
            <FormField
              label="Chart #"
              required={required('chartNo')}
              value={draft.chartNo}
              onChange={(v) => update('chartNo', v)}
              readOnly={readOnly}
            />
          )}
          {visible('mrNumber') && (
            <FormField
              label="MR #"
              required={required('mrNumber')}
              value={draft.mrNo}
              onChange={(v) => update('mrNo', v)}
              readOnly={readOnly}
            />
          )}
          {visible('dos') && (
            <FormField
              label="Date of Service"
              type="date"
              required={required('dos')}
              value={draft.dateOfService}
              onChange={(v) => handleDateChange('dateOfService', v)}
              readOnly={readOnly}
              min={dosMin}
              max={dosMax}
            />
          )}
        </div>

        {/* Row 2 */}
        {row2Visible && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            {visible('admitDate') && (
              <FormField
                label="Admit date"
                type="date"
                required={required('admitDate')}
                value={draft.admitDate}
                onChange={(v) => handleDateChange('admitDate', v)}
                readOnly={readOnly}
              />
            )}
            {visible('dischargeDate') && (
              <FormField
                label="Discharge date"
                type="date"
                required={required('dischargeDate')}
                value={draft.dischargeDate}
                onChange={(v) => handleDateChange('dischargeDate', v)}
                readOnly={readOnly}
              />
            )}
            <div />
          </div>
        )}

        {/* Row 3 */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          {visible('disposition') && (
            <FormField
              label="Disposition"
              type="select"
              required={required('disposition')}
              value={draft.disposition}
              onChange={(v) => update('disposition', v)}
              options={cfg.options.dispositions}
              readOnly={readOnly}
            />
          )}
          {visible('emLevel') && (
            <FormField
              label="EM"
              required={required('emLevel')}
              value={draft.em}
              onChange={(v) => update('em', v)}
              readOnly={readOnly}
              aiTag={draft._aiFields?.has('em')}
            />
          )}
          {visible('primaryDiagnosis') && (
            <FormField
              label="Primary diagnosis"
              required={required('primaryDiagnosis')}
              value={draft.primaryDiagnosis}
              onChange={(v) => update('primaryDiagnosis', v)}
              readOnly={readOnly}
              aiTag={draft._aiFields?.has('primaryDiagnosis')}
            />
          )}
        </div>

        {/* Row 4 */}
        {row4Visible && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            {visible('primaryHealthPlan') && (
              <FormField
                label="Primary Health Plan"
                type="select"
                required={required('primaryHealthPlan')}
                value={draft.primaryHealth}
                onChange={(v) => update('primaryHealth', v)}
                options={cfg.options.primaryHealthPlans}
                readOnly={readOnly}
              />
            )}
            {visible('facility') && (
              <FormField
                label="Facility"
                type="select"
                required={required('facility')}
                value={draft.facility}
                onChange={(v) => update('facility', v)}
                options={cfg.options.facilities}
                readOnly={readOnly}
              />
            )}
          </div>
        )}

        {/* Row 5 */}
        {row5Visible && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            {visible('poa') && (
              <FormField
                label="POA"
                required={required('poa')}
                value={draft.poa}
                onChange={(v) => update('poa', v.slice(0, 1))}
                readOnly={readOnly}
              />
            )}
            {visible('los') && (
              <FormField
                label="LOS"
                required={required('los')}
                value={draft.los}
                onChange={(v) => update('los', v.slice(0, 3))}
                readOnly={readOnly}
              />
            )}
            {visible('drgValue') && (
              <FormField
                label="DRG Value"
                required={required('drgValue')}
                value={draft.drgValue}
                onChange={(v) => update('drgValue', v.slice(0, 8))}
                readOnly={readOnly}
              />
            )}
          </div>
        )}

        {/* Row 6 */}
        {row6Visible && (
          <div className="grid grid-cols-3 gap-4">
            {visible('procedureCode') && (
              <FormField
                label="Procedure code"
                required={required('procedureCode')}
                value={draft.procedureCode}
                onChange={(v) => update('procedureCode', v)}
                readOnly={readOnly}
                aiTag={draft._aiFields?.has('procedureCode')}
              />
            )}
            {visible('subSpeciality') && (
              <FormField
                label="Sub Specialty"
                type="select"
                required={required('subSpeciality')}
                value={draft.subSpecialty}
                onChange={(v) => update('subSpecialty', v)}
                options={cfg.options.subSpecialities}
                readOnly={readOnly}
              />
            )}
            <div />
          </div>
        )}

        <CustomFieldsRenderer
          fields={cfg.customFields}
          placement="Chart Info"
          values={customValues}
          onChange={updateCustomValue}
          readOnly={readOnly}
        />
      </div>

      <Toast
        open={!!orderAlert}
        message={orderAlert ?? ''}
        variant="warn"
        onClose={() => setOrderAlert(null)}
      />
    </CollapsibleCard>
  );
}
