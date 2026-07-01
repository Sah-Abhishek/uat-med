import { useState, useEffect } from 'react';
import { CollapsibleCard } from '@/components/ui/Card';
import { Toast } from '@/components/ui/Primitives';
import { FormField, CodeSearchListInput, CodeAutocompleteField, SkeletonGrid } from './shared';
import { searchDrgCodes, searchPcsCodes } from '@/api/referenceCodes';
import { searchIcdCodes } from '@/api/icdCodes';
import type { DateMarker } from '@/components/ui/Field';
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
  /** True when the AI prediction returned at least one ICD-10-PCS procedure code
   * (code_type === 'procedure'). CPT procedure codes (code_type === 'cpt') do
   * NOT count. The PCS field is only shown when the AI produced one (or the
   * chart already has saved PCS values). */
  aiHasPcs?: boolean;
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
  aiHasPcs,
}: Props) {
  const dim = isAuditor ? 'opacity-50 pointer-events-none grayscale' : readOnly ? 'pointer-events-none' : '';
  const [orderAlert, setOrderAlert] = useState<string | null>(null);
  // Shared calendar position for the three order-dependent date fields
  // (admit ≤ DOS ≤ discharge): opening any of them lands on the month of
  // whatever's already entered. Seeded from whichever of the three is set.
  const [dateViewMonth, setDateViewMonth] = useState<Date>(() => {
    const iso = draft.dateOfService || draft.admitDate || draft.dischargeDate;
    const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
    const base = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  // Follow the Date of Service month whenever it's set — including when it's
  // auto-filled from the worklist and the user never opens its picker — so the
  // other two pickers open on the right month. Manual navigation in another
  // field still sticks (it doesn't change the DOS value, so this won't fire).
  useEffect(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.dateOfService || '');
    if (m) setDateViewMonth(new Date(Number(m[1]), Number(m[2]) - 1, 1));
  }, [draft.dateOfService]);
  // Cross-mark all three dates (fixed colours) on every one of their calendars.
  const dateMarkers: DateMarker[] = [
    { date: draft.admitDate, label: 'Admit date', color: 'rose' },
    { date: draft.dateOfService, label: 'Date of Service', color: 'sky' },
    { date: draft.dischargeDate, label: 'Discharge date', color: 'emerald' },
  ];

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
      <CollapsibleCard title="Chart Info" subtitle="All relevant chart fields" defaultOpen={!isAuditor}>
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
  const row5Visible = visible('poa') || visible('los');
  const row6Visible = visible('procedureCode') || visible('subSpeciality');

  // Order-aware ranges (admit ≤ DOS ≤ discharge): each picker greys out the
  // dates that would break the order, on top of the worklist's DOS range — so
  // out-of-order dates can't be picked, not just flagged afterwards.
  const earliest = (...ds: (string | undefined)[]): string | undefined =>
    ds.filter((d): d is string => !!d).sort()[0];
  const latest = (...ds: (string | undefined)[]): string | undefined =>
    ds.filter((d): d is string => !!d).sort().pop();
  const admitMax = earliest(draft.dateOfService, draft.dischargeDate);
  const dischargeMin = latest(draft.admitDate, draft.dateOfService);
  const dosMinEff = latest(draft.admitDate, dosMin);
  const dosMaxEff = earliest(draft.dischargeDate, dosMax);

  return (
    <CollapsibleCard title="Chart Info" subtitle="All relevant chart fields" defaultOpen={!isAuditor}>
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
              min={dosMinEff}
              max={dosMaxEff}
              dateMarkers={dateMarkers}
              viewMonth={dateViewMonth}
              onViewMonthChange={setDateViewMonth}
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
                max={admitMax}
                dateMarkers={dateMarkers}
                viewMonth={dateViewMonth}
                onViewMonthChange={setDateViewMonth}
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
                min={dischargeMin}
                dateMarkers={dateMarkers}
                viewMonth={dateViewMonth}
                onViewMonthChange={setDateViewMonth}
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
          <div />
        </div>

        {/* Primary diagnosis on its own full-width row so the description shows
            big, beside the code value (ICD descriptions can be long). */}
        {visible('primaryDiagnosis') && (
          <div className="mb-4">
            <CodeAutocompleteField
              label="Primary diagnosis"
              required={required('primaryDiagnosis')}
              code={draft.primaryDiagnosis}
              description={draft.primaryDiagnosisDescription}
              onChange={(c, d) => {
                update('primaryDiagnosis', c);
                update('primaryDiagnosisDescription', d);
              }}
              readOnly={readOnly}
              search={searchIcdCodes}
              queryKeyPrefix="icd-code-search"
              placeholder="Type an ICD code…"
              aiTag={draft._aiFields?.has('primaryDiagnosis')}
            />
          </div>
        )}

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

        {/* DRG value & PCS codes sit at the end as full-width blocks so a long
            code description can grow without stretching the 3-column grid rows
            above and breaking that layout. DRG is a single value (code +
            description); it's stored as a one-entry array for back-compat with
            charts saved while DRG was multi-value. */}
        {visible('drgValue') && (
          <div className="mt-4">
            <CodeAutocompleteField
              label="DRG Value"
              required={required('drgValue')}
              code={draft.drgValues[0]?.code ?? ''}
              description={draft.drgValues[0]?.description ?? ''}
              onChange={(c, d) =>
                update('drgValues', c.trim() || d.trim() ? [{ code: c, description: d }] : [])
              }
              readOnly={readOnly}
              search={searchDrgCodes}
              queryKeyPrefix="drg-codes-search"
              placeholder="Type a DRG code (min 2 chars)…"
            />
          </div>
        )}
        {/* PCS codes field is hidden for now (product decision). Flip the
            leading `false &&` to re-enable: it then appears only when the AI
            returned an ICD-10-PCS procedure code (aiHasPcs) or the chart already
            has saved PCS values, so existing data is never hidden. */}
        {false && visible('pcsCodes') && (aiHasPcs || draft.pcsCodes.length > 0) && (
          <div className="mt-4">
            <CodeSearchListInput
              label="PCS codes"
              required={required('pcsCodes')}
              values={draft.pcsCodes}
              onChange={(next) => update('pcsCodes', next)}
              readOnly={readOnly}
              search={searchPcsCodes}
              queryKeyPrefix="pcs-codes-search"
              placeholder="Type a PCS code (min 2 chars)…"
            />
          </div>
        )}
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
