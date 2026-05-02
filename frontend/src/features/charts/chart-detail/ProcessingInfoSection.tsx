import { CollapsibleCard } from '@/components/ui/Card';
import { Label, Textarea } from '@/components/ui/Field';
import { FormField, MultiSelect, SkeletonGrid, FieldSkeleton } from './shared';
import { CustomFieldsRenderer } from './CustomFieldsRenderer';
import type { FormDraft, CustomFieldValues } from './formState';
import type { FieldConfig } from './useFieldConfig';
import { cn } from '@/lib/utils';

interface UserOption {
  id: string;
  fullName: string;
}

interface Props {
  draft: FormDraft;
  update: (k: keyof FormDraft, v: unknown) => void;
  readOnly?: boolean;
  isAuditor?: boolean;
  cfg: FieldConfig;
  customValues: CustomFieldValues;
  updateCustomValue: (id: number, v: unknown) => void;
  coders?: UserOption[];
  auditors?: UserOption[];
}

export function ProcessingInfoSection({
  draft,
  update,
  readOnly,
  isAuditor,
  cfg,
  customValues,
  updateCustomValue,
  coders = [],
  auditors = [],
}: Props) {
  // Auditor profile only edits Coder QC Status here; everything else is locked.
  // Coder profile edits everything except Coder QC Status. We apply this per-row
  // (instead of one wrapper) so the Coder QC Status cell can stay un-dimmed and
  // interactive for auditors despite living in the same section.
  const lockForAuditor = isAuditor
    ? 'opacity-50 pointer-events-none grayscale'
    : readOnly
    ? 'pointer-events-none'
    : '';
  const isIncomplete = draft.chartStatus === 'Incomplete';
  const isComplete = draft.chartStatus === 'Complete';

  if (cfg.isLoading) {
    return (
      <CollapsibleCard
        title="Processing Info"
        subtitle="All fields related to processing this chart"
        defaultOpen
      >
        <div className="pt-3 space-y-4">
          <div className="grid grid-cols-[1fr_3fr] gap-4">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
          <SkeletonGrid cols={3} count={3} />
          <SkeletonGrid cols={3} count={3} />
        </div>
      </CollapsibleCard>
    );
  }

  const visible = (k: string) => cfg.isVisible(k);
  const required = (k: string) => cfg.isRequired(k);

  return (
    <CollapsibleCard title="Processing Info" subtitle="All fields related to processing this chart" defaultOpen>
      <div className="pt-3">
        {/* Row 1: chart status + responsible party */}
        {(visible('chartStatus') || visible('responsibleParty')) && (
          <div
            className={cn(
              'grid gap-4 mb-4',
              visible('chartStatus') && visible('responsibleParty')
                ? 'grid-cols-[1fr_3fr]'
                : 'grid-cols-1',
              lockForAuditor,
            )}
          >
            {visible('chartStatus') && (
              <FormField
                label="Chart status"
                type="select"
                required={required('chartStatus')}
                value={draft.chartStatus}
                onChange={(v) => update('chartStatus', v)}
                options={['Open', 'Complete', 'Incomplete']}
                readOnly={readOnly}
              />
            )}
            {visible('responsibleParty') && (
              <div>
                <Label required={required('responsibleParty')}>Responsible party</Label>
                <MultiSelect
                  value={draft.responsibleParty}
                  onChange={(v) => update('responsibleParty', v)}
                  options={cfg.options.responsibleParties}
                  readOnly={readOnly}
                />
              </div>
            )}
          </div>
        )}

        {/* Row 2: hold reason — only enabled when Incomplete */}
        <div
          className={cn(
            'mb-4',
            !isIncomplete && 'opacity-50 pointer-events-none',
            lockForAuditor,
          )}
        >
          <Label required={isIncomplete}>Hold reason</Label>
          <MultiSelect
            value={draft.holdReason}
            onChange={(v) => update('holdReason', v)}
            options={cfg.options.holdReasons}
            readOnly={readOnly || !isIncomplete}
          />
        </div>

        {/* Row 3: coder comments — disabled when Complete */}
        {visible('coderCommentsToClient') && (
          <div
            className={cn(
              'mb-4',
              isComplete && 'opacity-50 pointer-events-none',
              lockForAuditor,
            )}
          >
            <Label required={required('coderCommentsToClient')}>Coder comments to client</Label>
            <Textarea
              rows={3}
              value={draft.coderComments}
              onChange={(e) => update('coderComments', e.target.value)}
              readOnly={readOnly || isComplete}
            />
          </div>
        )}

        {visible('rejectionDenialComments') && (
          <div className={cn('mb-4', lockForAuditor)}>
            <Label required={required('rejectionDenialComments')}>Rejection / Denial Comments</Label>
            <Textarea
              rows={3}
              value={draft.rejectionComments}
              onChange={(e) => update('rejectionComments', e.target.value)}
              readOnly={readOnly}
            />
          </div>
        )}

        {visible('deficiencyComments') && (
          <div className={cn('mb-4', lockForAuditor)}>
            <Label required={required('deficiencyComments')}>Deficiency Comments</Label>
            <Textarea
              rows={3}
              value={draft.deficiencyComments}
              onChange={(e) => update('deficiencyComments', e.target.value)}
              readOnly={readOnly}
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className={lockForAuditor}>
            <FormField
              label="Date of completion"
              value={new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
              readOnly
            />
          </div>
          <div className={lockForAuditor}>
            <Label required>Audit options</Label>
            <MultiSelect
              value={draft.auditOption}
              onChange={(v) => update('auditOption', v)}
              options={cfg.options.auditOptions}
              readOnly={readOnly}
            />
          </div>
          {/* Coder QC Status is auditor-owned: editable only in the auditor
              profile, read-only for coders. */}
          <div className={cn(!isAuditor && 'opacity-50 pointer-events-none')}>
            <FormField
              label="Coder QC Status"
              type="select"
              value={draft.qcStatus}
              onChange={(v) => update('qcStatus', v)}
              options={['Pending', 'Approved', 'Reject']}
              readOnly={!isAuditor}
            />
          </div>
        </div>

        <div className={cn('grid grid-cols-3 gap-4', lockForAuditor)}>
          <FormField
            label="Allocate to auditor"
            type="select"
            value={draft.allocateAuditor}
            onChange={(v) => update('allocateAuditor', v)}
            options={auditors.map((u) => ({ value: u.id, label: u.fullName }))}
            readOnly={readOnly || !!draft.allocateCoder}
            placeholder="Select auditor…"
          />
          <FormField
            label="Allocate to Coder"
            type="select"
            value={draft.allocateCoder}
            onChange={(v) => update('allocateCoder', v)}
            options={coders.map((u) => ({ value: u.id, label: u.fullName }))}
            readOnly={readOnly}
            placeholder="Select coder…"
          />
          <FormField
            label="Priority"
            type="select"
            value={draft.priority}
            onChange={(v) => update('priority', v)}
            options={[
              { value: 'CRITICAL', label: 'Critical' },
              { value: 'HIGH', label: 'High' },
              { value: 'MEDIUM', label: 'Medium' },
              { value: 'LOW', label: 'Low' },
            ]}
            readOnly={readOnly}
          />
        </div>

        <div className={lockForAuditor}>
          <CustomFieldsRenderer
            fields={cfg.customFields}
            placement="Processing Info"
            values={customValues}
            onChange={updateCustomValue}
            readOnly={readOnly}
          />
        </div>
      </div>
    </CollapsibleCard>
  );
}
