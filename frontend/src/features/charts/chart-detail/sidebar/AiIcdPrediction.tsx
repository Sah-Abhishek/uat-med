import { Bot, Eye, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { AiPredictedCode } from '@/api/types';

/** A predicted code annotated with what the coder did to it in review, so the
 *  sidebar can surface every outcome (accepted / rejected / edited / untouched /
 *  added) with colour coding — not just the codes that survived. */
export interface AnnotatedCode extends AiPredictedCode {
  decisionState?: 'accepted' | 'rejected' | 'edited' | 'untouched' | 'added';
  /** For 'edited' — the AI's original code/description before the coder changed it. */
  originalCode?: string;
  originalDescription?: string;
  /** The decision is only in the coder's draft — not yet submitted. */
  notSubmitted?: boolean;
}
export interface AnnotatedPrediction {
  primary: AnnotatedCode[];
  secondary: AnnotatedCode[];
  procedures: AnnotatedCode[];
  codes: AnnotatedCode[];
}

interface Props {
  /** Coder-decision-annotated prediction — null until upload finishes. */
  prediction?: AnnotatedPrediction | null;
  hasUploadedDocs: boolean;
  timerRunning: boolean;
  onReview?: () => void;
  /** QA / read-only viewer (TL dashboard). Bypasses the timer requirement
   * and renames the button to reflect that nothing can be edited. */
  readOnly?: boolean;
  /** Submitted per-code audit counts — surfaces "auditor feedback exists" on
   * the chart page so the coder knows to open the codes view. */
  auditSummary?: { agreed: number; disagreed: number } | null;
}

export function AiIcdPrediction({ prediction, hasUploadedDocs, timerRunning, onReview, readOnly, auditSummary }: Props) {
  const empty = !prediction || prediction.codes.length === 0;

  return (
    <Card padding="default">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="w-4 h-4 text-primary-ink dark:text-primary" />
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold">
          AI ICD Prediction
        </p>
      </div>

      {auditSummary && (
        <button
          type="button"
          onClick={onReview}
          className={cn(
            'w-full mb-3 rounded-lg border p-2.5 text-left transition',
            auditSummary.disagreed > 0
              ? 'border-danger/30 bg-danger-soft/40 hover:bg-danger-soft/70'
              : 'border-success/30 bg-success-soft/40 hover:bg-success-soft/70',
          )}
        >
          <p className={cn(
            'text-[11px] font-semibold uppercase tracking-wide',
            auditSummary.disagreed > 0 ? 'text-danger' : 'text-success',
          )}>
            Auditor feedback
          </p>
          <p className="text-xs text-ink mt-0.5">
            {auditSummary.disagreed > 0
              ? `${auditSummary.disagreed} code${auditSummary.disagreed === 1 ? '' : 's'} disagreed · ${auditSummary.agreed} agreed — click to view`
              : `All ${auditSummary.agreed} audited code${auditSummary.agreed === 1 ? '' : 's'} agreed — click to view`}
          </p>
        </button>
      )}

      {!hasUploadedDocs ? (
        <p className="text-xs text-ink-muted">Upload a document to get ICD prediction.</p>
      ) : empty ? (
        <p className="text-xs text-ink-muted">No predictions available yet.</p>
      ) : (
        <div className="space-y-3">
          {!!prediction!.primary.length && (
            <Section label="Primary" tone="warn">
              {prediction!.primary.map((c, i) => (
                <CodeRow key={`p-${i}`} c={c} />
              ))}
            </Section>
          )}
          {!!prediction!.secondary.length && (
            <Section label="Secondary" tone="muted">
              {prediction!.secondary.map((c, i) => (
                <CodeRow key={`s-${i}`} c={c} />
              ))}
            </Section>
          )}
          {!!prediction!.procedures.length && (
            <Section label="Procedures" tone="success">
              {prediction!.procedures.map((c, i) => (
                <CodeRow key={`pr-${i}`} c={c} />
              ))}
            </Section>
          )}
        </div>
      )}

      <Button
        size="sm"
        variant="soft"
        leftIcon={readOnly ? <Eye className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
        disabled={(!readOnly && !timerRunning) || empty}
        onClick={onReview}
        className="w-full mt-4"
      >
        {readOnly ? "View Coder's Decisions" : 'Review and Edit'}
      </Button>
    </Card>
  );
}

type Tone = 'primary' | 'warn' | 'muted' | 'info' | 'success';

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  const labelTone = {
    primary: 'text-primary-ink dark:text-primary',
    warn: 'text-warn',
    muted: 'text-ink-muted',
    info: 'text-info',
    success: 'text-success',
  }[tone];
  return (
    <div>
      <p className={cn('text-[10px] uppercase tracking-wide font-semibold mb-1.5', labelTone)}>
        {label}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Per-decision styling so each code's outcome is legible at a glance. */
const DECISION_STYLE: Record<
  NonNullable<AnnotatedCode['decisionState']>,
  { pill: string; tag: string; tagClass: string; strike: boolean }
> = {
  accepted:  { pill: 'bg-success-soft text-success', tag: 'Accepted', tagClass: 'text-success', strike: false },
  rejected:  { pill: 'bg-danger-soft text-danger', tag: 'Rejected', tagClass: 'text-danger', strike: true },
  edited:    { pill: 'bg-warn-soft text-warn', tag: 'Edited', tagClass: 'text-warn', strike: false },
  untouched: { pill: 'bg-surface-sunken text-ink-muted', tag: 'Untouched', tagClass: 'text-ink-subtle', strike: false },
  added:     { pill: 'bg-info-soft text-info', tag: 'Added', tagClass: 'text-info', strike: false },
};

/**
 * Shows the ICD code in a colored pill alongside its description, coloured by
 * what the coder did with it in review (accepted / rejected / edited /
 * untouched / added). Rejected codes are struck through; edited codes show the
 * AI's original value beneath. Justification stays in the row tooltip on hover.
 */
function CodeRow({ c }: { c: AnnotatedCode }) {
  const s = c.decisionState ? DECISION_STYLE[c.decisionState] : null;
  return (
    <div className="flex items-start gap-2" title={c.justification || undefined}>
      <span
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-semibold flex-shrink-0',
          s ? s.pill : 'bg-surface-sunken text-ink',
          s?.strike && 'line-through',
          // Dashed outline reinforces that this decision isn't finalised yet.
          c.notSubmitted && 'border border-dashed border-current',
        )}
      >
        {c.code}
      </span>
      <div className="flex-1 min-w-0">
        {c.description && (
          <span className={cn('text-[11px] leading-snug text-ink-muted break-words', s?.strike && 'line-through')}>
            {c.description}
          </span>
        )}
        {c.decisionState === 'edited' && c.originalCode && (
          <p className="text-[10px] text-ink-subtle mt-0.5">
            was <span className="line-through">{c.originalCode}</span>
            {c.originalDescription ? ` · ${c.originalDescription}` : ''}
          </p>
        )}
      </div>
      {(s || c.notSubmitted) && (
        <div className="shrink-0 flex flex-col items-end gap-0.5 mt-0.5">
          {s && (
            <span className={cn('text-[9px] uppercase tracking-wide font-bold', s.tagClass)}>{s.tag}</span>
          )}
          {c.notSubmitted && (
            <span className="text-[8px] uppercase tracking-wide font-bold text-ink-subtle border border-dashed border-ink-subtle/60 rounded px-1 py-px whitespace-nowrap">
              Not submitted
            </span>
          )}
        </div>
      )}
    </div>
  );
}
