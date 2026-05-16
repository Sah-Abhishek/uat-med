import { Bot, Eye, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { AiEncounterResult, AiPredictedCode } from '@/api/types';

interface Props {
  /** Encounter result from /charts/:id/process-documents — null until upload finishes. */
  prediction?: AiEncounterResult | null;
  hasUploadedDocs: boolean;
  timerRunning: boolean;
  onReview?: () => void;
  /** QA / read-only viewer (TL dashboard). Bypasses the timer requirement
   * and renames the button to reflect that nothing can be edited. */
  readOnly?: boolean;
}

export function AiIcdPrediction({ prediction, hasUploadedDocs, timerRunning, onReview, readOnly }: Props) {
  const empty = !prediction || prediction.codes.length === 0;

  return (
    <Card padding="default">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="w-4 h-4 text-primary-ink dark:text-primary" />
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold">
          AI ICD Prediction
        </p>
      </div>

      {!hasUploadedDocs ? (
        <p className="text-xs text-ink-muted">Upload a document to get ICD prediction.</p>
      ) : empty ? (
        <p className="text-xs text-ink-muted">No predictions available yet.</p>
      ) : (
        <div className="space-y-3">
          {!!prediction!.primary.length && (
            <Section label="Primary" tone="warn">
              {prediction!.primary.map((c, i) => (
                <CodeRow key={`p-${i}`} c={c} tone="warn" />
              ))}
            </Section>
          )}
          {!!prediction!.secondary.length && (
            <Section label="Secondary" tone="muted">
              {prediction!.secondary.map((c, i) => (
                <CodeRow key={`s-${i}`} c={c} tone="muted" />
              ))}
            </Section>
          )}
          {!!prediction!.procedures.length && (
            <Section label="Procedures" tone="success">
              {prediction!.procedures.map((c, i) => (
                <CodeRow key={`pr-${i}`} c={c} tone="success" />
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

/**
 * Shows the ICD code in a colored pill alongside its description, with the AI
 * justification (if present) tucked into the row tooltip for hover context.
 */
function CodeRow({ c, tone }: { c: AiPredictedCode; tone: Tone }) {
  const bg = {
    primary: 'bg-primary-soft text-primary-ink dark:text-primary',
    warn: 'bg-warn-soft text-warn',
    muted: 'bg-surface-sunken text-ink',
    info: 'bg-info-soft text-info',
    success: 'bg-success-soft text-success',
  }[tone];

  return (
    <div className="flex items-start gap-2" title={c.justification || undefined}>
      <span
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-semibold flex-shrink-0',
          bg,
        )}
      >
        {c.code}
      </span>
      {c.description && (
        <span className="text-[11px] leading-snug text-ink-muted flex-1 min-w-0 break-words">
          {c.description}
        </span>
      )}
    </div>
  );
}
