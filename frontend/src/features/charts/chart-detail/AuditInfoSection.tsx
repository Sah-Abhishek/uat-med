import { CollapsibleCard } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Field';
import { AUDIT_ROWS, FormField, MultiSelect } from './shared';
import type { FormDraft } from './formState';
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
  /** Drives default-open: this card opens by default for auditors. */
  isAuditor?: boolean;
  feedbackTypes?: string[];
  /** Per-row feedback category options, keyed by AUDIT_ROWS.key. Sourced from the
   * /configurations Feedback Categories tab and scoped to the chart's client + location. */
  feedbackOptionsByRow?: Record<string, string[]>;
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
  feedbackTypes,
  feedbackOptionsByRow,
  coders = [],
  codersLoading,
}: Props) {
  /** Strip everything except digits — Total / Correct codes are integer counts. */
  const onlyDigits = (s: string) => s.replace(/\D+/g, '');
  const totalSum = Object.values(audit).reduce(
    (s, r) => s + (parseInt(r.totalCodes, 10) || 0),
    0,
  );
  const correctSum = Object.values(audit).reduce(
    (s, r) => s + (parseInt(typeof r.correctCodes === 'string' ? r.correctCodes : '', 10) || 0),
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

          {AUDIT_ROWS.map((row) => {
            const cell = audit[row.key] ?? { totalCodes: '', correctCodes: '', feedbackCategory: row.multiFeedback ? [] : '' };
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
                  {row.totalCodesOptions ? (
                    <FormField
                      label=""
                      type="select"
                      value={cell.totalCodes}
                      onChange={(v) => updateAudit(row.key, 'totalCodes', v)}
                      options={row.totalCodesOptions}
                      readOnly={disabled}
                    />
                  ) : (
                    <Input
                      value={cell.totalCodes}
                      readOnly={disabled}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onChange={(e) => updateAudit(row.key, 'totalCodes', onlyDigits(e.target.value))}
                    />
                  )}
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
                  {row.multiFeedback ? (
                    <MultiSelect
                      value={Array.isArray(cell.feedbackCategory) ? cell.feedbackCategory : []}
                      onChange={(v) => updateAudit(row.key, 'feedbackCategory', v)}
                      options={feedbackOptionsByRow?.[row.key] ?? []}
                      readOnly={!feedbackEnabled}
                    />
                  ) : (
                    <FormField
                      label=""
                      type="select"
                      value={typeof cell.feedbackCategory === 'string' ? cell.feedbackCategory : ''}
                      onChange={(v) => updateAudit(row.key, 'feedbackCategory', v)}
                      options={feedbackOptionsByRow?.[row.key] ?? []}
                      readOnly={!feedbackEnabled}
                    />
                  )}
                </BodyCell>
              </div>
            );
          })}

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
            draft.auditorQcStatus === 'Agreed' ? 'grid-cols-2' : 'grid-cols-3',
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
          <FormField
            label="Auditor QC Status"
            required
            type="select"
            value={draft.auditorQcStatus}
            onChange={(v) => update('auditorQcStatus', v)}
            options={['Agreed', 'Feedback Provided']}
            readOnly={disabled}
          />
          {draft.auditorQcStatus !== 'Agreed' && (
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
