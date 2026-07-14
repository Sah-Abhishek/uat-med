import { CollapsibleCard } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Field';
import { FormField, MultiSelect, type AuditAreaRow } from './shared';
import { AUDITOR_QC_STATUS_OPTIONS, type FormDraft } from './formState';
import type { AuditCell } from './formState';
import { cn } from '@/lib/utils';

interface CoderOption {
  id: string;
  fullName: string;
}

interface Props {
  draft: FormDraft;
  update: (k: keyof FormDraft, v: unknown) => void;
  audit: Record<string, AuditCell>;
  updateAudit: (rowKey: string, field: keyof AuditCell, value: string | string[]) => void;
  /** When true, the whole section is disabled. Source rule: only auditor can edit and only while timer is running. */
  disabled?: boolean;
  /** User Manual §6.2.2: when any feedback category is selected, Auditor QC
   * Status is auto-set to "Feedback Provided" and locked (can't be changed). */
  qcAutoProvided?: boolean;
  /** Drives default-open: this card opens by default for auditors. */
  isAuditor?: boolean;
  feedbackTypes?: string[];
  /** The audit areas to render as rows, configured per the chart's client +
   * location (Configurations → Feedback Categories). One row per area, each
   * carrying its own Feedback Category options. */
  auditAreas?: AuditAreaRow[];
  /** True while the configured areas are still loading. */
  areasLoading?: boolean;
  /** Coders the auditor can hand the chart back to when picking "Feedback Provided". */
  coders?: CoderOption[];
  codersLoading?: boolean;
}

export function AuditInfoSection({
  draft,
  update,
  audit,
  updateAudit,
  disabled,
  isAuditor,
  qcAutoProvided,
  feedbackTypes,
  auditAreas = [],
  areasLoading,
  coders = [],
  codersLoading,
}: Props) {
  /** Strip everything except digits — Total / Correct codes are integer counts. */
  const onlyDigits = (s: string) => s.replace(/\D+/g, '');
  /** Coerce a stored feedback value (legacy single-string or multi array) to an
   * array, so rows that were saved before the table became uniform still load. */
  const asArray = (v: AuditCell['feedbackCategory']): string[] =>
    Array.isArray(v) ? v : v ? [v] : [];
  // Sum only over the rendered rows so stale localStorage keys from a different
  // area config don't leak into the totals.
  const totalSum = auditAreas.reduce(
    (s, row) => s + (parseInt(audit[row.key]?.totalCodes ?? '', 10) || 0),
    0,
  );
  const correctSum = auditAreas.reduce(
    (s, row) => s + (parseInt(audit[row.key]?.correctCodes ?? '', 10) || 0),
    0,
  );

  return (
    <CollapsibleCard title="Audit Information" defaultOpen={!!isAuditor}>
      <div
        className={cn(
          'pt-3',
          disabled && 'opacity-50 pointer-events-none grayscale',
        )}
      >
        <div className="rounded-card border border-line overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[160px_1fr_1fr_1fr] bg-surface-2 border-b border-line">
            <HeaderCell border>Area</HeaderCell>
            <HeaderCell>Total Codes</HeaderCell>
            <HeaderCell>Correct Codes</HeaderCell>
            <HeaderCell>
              <span className="bg-warn-soft px-1 rounded">Feedback</span> Category
            </HeaderCell>
          </div>

          {auditAreas.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-[13px] text-ink-muted">
              {areasLoading
                ? 'Loading audit areas…'
                : 'No audit areas configured for this client / location. Add them in Configurations → Feedback Categories.'}
            </div>
          ) : (
            auditAreas.map((row) => {
              const cell = audit[row.key] ?? { totalCodes: '', correctCodes: '', feedbackCategory: [] };
              const total = parseInt(cell.totalCodes, 10);
              const correct = parseInt(typeof cell.correctCodes === 'string' ? cell.correctCodes : '', 10);
              const feedbackEnabled =
                !disabled && cell.totalCodes !== '' && cell.correctCodes !== '' && !isNaN(total) && !isNaN(correct) && correct < total;

              return (
                <div
                  key={row.key}
                  className="grid grid-cols-[160px_1fr_1fr_1fr] border-b border-line last:border-b-0 items-center"
                >
                  <BodyCell border>{row.label}</BodyCell>
                  <BodyCell>
                    <Input
                      value={cell.totalCodes}
                      readOnly={disabled}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onChange={(e) => updateAudit(row.key, 'totalCodes', onlyDigits(e.target.value))}
                    />
                  </BodyCell>
                  <BodyCell>
                    <Input
                      value={typeof cell.correctCodes === 'string' ? cell.correctCodes : ''}
                      readOnly={disabled}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onChange={(e) => updateAudit(row.key, 'correctCodes', onlyDigits(e.target.value))}
                    />
                  </BodyCell>
                  <BodyCell>
                    <MultiSelect
                      value={asArray(cell.feedbackCategory)}
                      onChange={(v) => updateAudit(row.key, 'feedbackCategory', v)}
                      options={row.options}
                      readOnly={!feedbackEnabled}
                    />
                  </BodyCell>
                </div>
              );
            })
          )}

          {/* Total row */}
          <div className="grid grid-cols-[160px_1fr_1fr_1fr] bg-surface-sunken/60 items-center">
            <BodyCell border bold>
              Total
            </BodyCell>
            <BodyCell>
              <Input value={totalSum || ''} readOnly className="font-semibold" />
            </BodyCell>
            <BodyCell>
              <Input value={correctSum || ''} readOnly className="font-semibold" />
            </BodyCell>
            <BodyCell />
          </div>
        </div>

        {/* Below-table fields */}
        <div
          className={cn(
            'grid gap-4 mt-5',
            draft.auditorQcStatus === 'Agree' ? 'grid-cols-2' : 'grid-cols-3',
          )}
        >
          <div>
            <Label required>
              <span className="bg-warn-soft px-1 rounded">Feedback</span> Type
            </Label>
            <FormField
              label=""
              type="select"
              value={draft.feedbackType}
              onChange={(v) => update('feedbackType', v)}
              options={feedbackTypes ?? []}
              readOnly={disabled}
            />
          </div>
          {/* User Manual §6.2.2: "Feedback Provided" is auto-selected and locked
              whenever the auditor flags a feedback category; otherwise the
              auditor picks (e.g. "Agree"). */}
          <FormField
            label="Auditor QC Status"
            required
            type="select"
            value={draft.auditorQcStatus}
            onChange={(v) => update('auditorQcStatus', v)}
            options={AUDITOR_QC_STATUS_OPTIONS}
            readOnly={disabled || qcAutoProvided}
          />
          {draft.auditorQcStatus !== 'Agree' && (
            <FormField
              label="Allocate to Coder"
              type="select"
              value={draft.auditAllocateCoder}
              onChange={(v) => update('auditAllocateCoder', v)}
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
              readOnly={disabled || draft.auditorQcStatus !== 'Feedback Provided' || codersLoading}
              placeholder={codersLoading ? 'Loading coders…' : 'Select coder…'}
            />
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}

function HeaderCell({ children, border }: { children: React.ReactNode; border?: boolean }) {
  return (
    <div
      className={cn(
        'px-3.5 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-ink-subtle',
        border && 'border-r border-dashed border-line',
      )}
    >
      {children}
    </div>
  );
}

function BodyCell({
  children,
  border,
  bold,
}: {
  children?: React.ReactNode;
  border?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        'px-3 py-2 text-[13px]',
        border && 'border-r border-dashed border-line',
        bold && 'font-bold text-ink',
      )}
    >
      {children}
    </div>
  );
}
