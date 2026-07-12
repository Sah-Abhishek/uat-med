import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { CollapsibleCard } from '@/components/ui/Card';
import { Label, Textarea } from '@/components/ui/Field';
import { FormField, MultiSelect, SkeletonGrid, FieldSkeleton } from './shared';
import { CustomFieldsRenderer } from './CustomFieldsRenderer';
import { QC_STATUS_OPTIONS, type FormDraft, type CustomFieldValues } from './formState';
import { isFieldDisabledByStatus, type FieldConfig } from './useFieldConfig';
import { cn } from '@/lib/utils';

/**
 * Copy-to-clipboard button for a text field's value. It deliberately sets
 * `pointer-events-auto` so it keeps working even when its parent field wrapper
 * is disabled (`pointer-events-none` from Complete / read-only / auditor-lock) —
 * the whole point is to let a coder copy what they sent to the client after the
 * chart is finalized and the inputs go read-only. Renders nothing when empty.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!value?.trim()) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / denied) — leave the value visible */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied' : `Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="pointer-events-auto inline-flex items-center gap-1 text-[11.5px] text-ink-subtle hover:text-primary transition shrink-0"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

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
  /** Distinguish "loading user list" from "no users to allocate" so the
   *  picker can show a spinner-y placeholder while the request is in flight. */
  codersLoading?: boolean;
  auditorsLoading?: boolean;
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
  codersLoading,
  auditorsLoading,
}: Props) {
  // The auditor profile locks this whole section (they work in Audit
  // Information instead). Coder QC Status is the one cell gated independently
  // (see coderQcEditable below) — per the manual it's the coder's response, so
  // we apply the lock per-row rather than one wrapper.
  const lockForAuditor = isAuditor
    ? 'opacity-50 pointer-events-none grayscale'
    : readOnly
    ? 'pointer-events-none'
    : '';
  // Mirror the validation rule from useFieldConfig — keeps the asterisk in
  // sync with the actual mandatory check so it disappears when the field is
  // disabled by chart status.
  const coderCommentsDisabled = isFieldDisabledByStatus('coderCommentsToClient', draft.chartStatus);
  const holdReasonDisabled    = isFieldDisabledByStatus('holdReason', draft.chartStatus);
  // User Manual §5.2 / rule #511: "Coder QC Status" is the CODER's response to
  // an audit — editable only when the chart has been reallocated back to them by
  // an auditor whose QC Status is "Feedback Provided" (so it's disabled once the
  // auditor selects "Agree"). It is never editable in the auditor profile, nor
  // while the section is read-only (QA / stopped / paused timer).
  const coderQcEditable = !isAuditor && !readOnly && draft.auditorQcStatus === 'Feedback Provided';

  if (cfg.isLoading) {
    return (
      <CollapsibleCard
        title="Processing Info"
        subtitle="All fields related to processing this chart"
        defaultOpen={!isAuditor}
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
    <CollapsibleCard title="Processing Info" subtitle="All fields related to processing this chart" defaultOpen={!isAuditor}>
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
                // 'Open' is the implicit default state, surfaced as a
                // placeholder rather than a selectable option — coders only
                // pick between Complete and Incomplete.
                options={['Complete', 'Incomplete']}
                placeholder="Open"
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
            holdReasonDisabled && 'opacity-50 pointer-events-none',
            lockForAuditor,
          )}
        >
          <Label required={!holdReasonDisabled}>Hold reason</Label>
          <MultiSelect
            value={draft.holdReason}
            onChange={(v) => update('holdReason', v)}
            options={cfg.options.holdReasons}
            readOnly={readOnly || holdReasonDisabled}
          />
        </div>

        {/* Row 3: coder comments — disabled when Complete. Only the textarea is
            dimmed/disabled; the label row (with its Copy button) stays live so
            the comment can be copied verbatim after the chart is finalized. */}
        {visible('coderCommentsToClient') && (
          <div className={cn('mb-4', lockForAuditor)}>
            <div className="flex items-center justify-between gap-2">
              <Label
                required={!coderCommentsDisabled && required('coderCommentsToClient')}
                className={cn(coderCommentsDisabled && 'opacity-50')}
              >
                Coder comments to client
              </Label>
              <CopyButton value={draft.coderComments} label="coder comments to client" />
            </div>
            <div className={cn(coderCommentsDisabled && 'opacity-50 pointer-events-none')}>
              <Textarea
                rows={3}
                value={draft.coderComments}
                onChange={(e) => update('coderComments', e.target.value)}
                readOnly={readOnly || coderCommentsDisabled}
              />
            </div>
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
          {/* Coder QC Status (User Manual §5.2): the CODER's response after an
              auditor sends the chart back with QC "Feedback Provided"; disabled
              otherwise (incl. when the auditor "Agree"d — rule #511) and never
              editable in the auditor profile. */}
          <div className={cn(!coderQcEditable && 'opacity-50 pointer-events-none')}>
            <FormField
              label="Coder QC Status"
              type="select"
              value={draft.qcStatus}
              onChange={(v) => update('qcStatus', v)}
              options={QC_STATUS_OPTIONS}
              readOnly={!coderQcEditable}
            />
          </div>
        </div>

        <div className={cn('grid grid-cols-3 gap-4', lockForAuditor)}>
          <FormField
            label="Allocate to auditor"
            type="select"
            value={draft.allocateAuditor}
            onChange={(v) => update('allocateAuditor', v)}
            // Leading "None" entry lets users explicitly clear an existing
            // allocation. Selecting it sends an empty value, which the save
            // path turns into `undefined` (backend keeps the row but unsets
            // the FK).
            options={
              auditorsLoading
                ? []
                : [
                    { value: '', label: 'None' },
                    ...auditors.map((u) => ({ value: u.id, label: u.fullName })),
                  ]
            }
            searchable
            searchPlaceholder="Search auditors…"
            readOnly={readOnly || auditorsLoading}
            placeholder={auditorsLoading ? 'Loading auditors…' : 'Select auditor…'}
          />
          <FormField
            label="Allocate to Coder"
            type="select"
            value={draft.allocateCoder}
            onChange={(v) => update('allocateCoder', v)}
            options={
              codersLoading
                ? []
                : [
                    { value: '', label: 'None' },
                    ...coders.map((u) => ({ value: u.id, label: u.fullName })),
                  ]
            }
            searchable
            searchPlaceholder="Search coders…"
            readOnly={readOnly || codersLoading}
            placeholder={codersLoading ? 'Loading coders…' : 'Select coder…'}
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
