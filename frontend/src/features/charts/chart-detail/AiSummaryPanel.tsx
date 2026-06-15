import { Clock } from 'lucide-react';
import type { AiEncounterResult, AiPredictedCode } from '@/api/types';
import { cn } from '@/lib/utils';
import { PriorityBadge } from './shared';

/** Human-readable duration for AI processing time. */
function fmtProcessing(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return rs ? `${m}m ${rs}s` : `${m}m`;
}

/**
 * Single source of truth for the "AI Summary" panel. Used inside ReviewEditModal
 * and DocumentViewerModal so both surfaces show every AI-generated artifact:
 *   • clinical_summary blob (chief complaint, context, narrative diagnoses, labs)
 *   • structured ICD codes (primary / secondary / procedures with justification)
 *   • documentation gaps
 *   • physician queries
 *   • coding tips
 *   • compliance alerts
 *   • auditor notes
 */
export function AiSummaryPanel({
  prediction,
}: {
  prediction?: AiEncounterResult | null;
}) {
  if (!prediction) {
    return (
      <div className="p-6 text-sm text-ink-muted">
        AI summary will appear here once the chart's documents are processed.
      </div>
    );
  }

  const cs = (prediction.clinicalSummary ?? {}) as Record<string, unknown>;
  const text = (k: string) => (typeof cs[k] === 'string' ? (cs[k] as string) : '');
  const list = (k: string) => (Array.isArray(cs[k]) ? (cs[k] as unknown[]) : []);
  const labs =
    cs.significant_labs && typeof cs.significant_labs === 'object'
      ? Object.entries(cs.significant_labs as Record<string, unknown>)
      : [];

  const hasIcdCodes =
    !!prediction.primary?.length ||
    !!prediction.secondary?.length ||
    !!prediction.procedures?.length;

  const gaps = (prediction.documentationGaps ?? []).filter((g) => g.gap);
  const queries = (prediction.physicianQueries ?? []).filter((q) => q.query);
  const tips = (prediction.codingTips ?? []).filter((t) => t.tip);
  const alerts = (prediction.complianceAlerts ?? []).filter((a) => a.alert);
  const auditNotes = prediction.auditNotes?.trim() || '';

  return (
    <div className="p-6 space-y-6 text-sm">
      {(prediction.processingMs != null || prediction.generatedAt) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted -mt-1">
          {prediction.processingMs != null && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              AI processed documents in{' '}
              <span className="font-semibold text-ink">{fmtProcessing(prediction.processingMs)}</span>
            </span>
          )}
          {prediction.generatedAt && (
            <span title={new Date(prediction.generatedAt).toLocaleString()}>
              Generated {new Date(prediction.generatedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}
      <SummaryBlock title="Chief Complaint" body={text('chief_complaint')} />
      <SummaryBlock title="Clinical Context" body={text('clinical_context')} />

      {hasIcdCodes && (
        <Section title="AI ICD Predictions">
          <div className="space-y-3">
            {!!prediction.primary?.length && (
              <CodeGroup label="Primary" tone="warn" codes={prediction.primary} />
            )}
            {!!prediction.secondary?.length && (
              <CodeGroup label="Secondary" tone="muted" codes={prediction.secondary} />
            )}
            {!!prediction.procedures?.length && (
              <CodeGroup label="Procedures" tone="success" codes={prediction.procedures} />
            )}
          </div>
        </Section>
      )}

      <SummaryListBlock title="Primary Diagnoses (narrative)" items={list('primary_diagnoses')} />
      <SummaryListBlock title="Secondary Diagnoses (narrative)" items={list('secondary_diagnoses')} />
      <SummaryListBlock title="Procedures Performed (narrative)" items={list('procedures_performed')} />

      {labs.length > 0 && (
        <Section title="Significant Labs">
          <div className="rounded-md border border-line divide-y divide-line">
            {labs.map(([t, v]) => (
              <div key={t} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-semibold text-ink">{t}</span>
                <span className="text-xs text-ink-muted font-mono">{String(v)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {gaps.length > 0 && (
        <Section title="Documentation Gaps">
          <div className="space-y-3">
            {gaps.map((g, i) => (
              <div key={i} className="border-l-2 border-warn pl-3">
                {g.priority && (
                  <div className="mb-1">
                    <PriorityBadge priority={g.priority} />
                  </div>
                )}
                <p className="text-xs font-semibold text-ink mb-1">{g.gap}</p>
                {g.impact && (
                  <p className="text-[11px] text-ink-muted mb-2">{g.impact}</p>
                )}
                {g.suggestion && (
                  <p className="text-[11px] text-success bg-success-soft rounded-md px-2 py-1">
                    {g.suggestion}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {queries.length > 0 && (
        <Section title="Physician Queries Needed">
          <div className="space-y-3">
            {queries.map((q, i) => (
              <div key={i} className="border-l-2 border-info pl-3">
                {q.priority && (
                  <div className="mb-1">
                    <PriorityBadge priority={q.priority} />
                  </div>
                )}
                <p className="text-xs font-semibold text-ink mb-1">{q.query}</p>
                {q.reason && (
                  <p className="text-[11px] text-ink-muted mb-1">
                    <span className="font-semibold">Reason:</span> {q.reason}
                  </p>
                )}
                {q.impactOnCoding && (
                  <p className="text-[11px] text-ink-muted">
                    <span className="font-semibold">Coding impact:</span> {q.impactOnCoding}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {tips.length > 0 && (
        <Section title="Coding Tips" titleClassName="text-info">
          <div className="space-y-2">
            {tips.map((t, i) => (
              <div key={i} className="rounded-md bg-info-soft p-2.5">
                <p className="text-xs text-ink mb-1">{t.tip}</p>
                {t.relatedCode && (
                  <p className="text-[11px] text-ink-muted">
                    <span className="font-semibold">Related code:</span>{' '}
                    <span className="font-mono">{t.relatedCode}</span>
                  </p>
                )}
                {t.potentialImpact && (
                  <p className="text-[11px] text-ink-muted">
                    <span className="font-semibold">Impact:</span> {t.potentialImpact}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {alerts.length > 0 && (
        <Section title="Compliance Alerts" titleClassName="text-warn">
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className="rounded-md bg-warn-soft p-2.5">
                <div className="flex items-start gap-2 mb-1">
                  <p className="text-xs text-ink flex-1">{a.alert}</p>
                  {a.severity && (
                    <span className="text-[10px] font-bold uppercase text-warn">
                      {a.severity}
                    </span>
                  )}
                </div>
                {a.regulation && (
                  <p className="text-[11px] text-ink-muted">
                    <span className="font-semibold">Regulation:</span> {a.regulation}
                  </p>
                )}
                {a.recommendedAction && (
                  <p className="text-[11px] text-ink-muted">
                    <span className="font-semibold">Action:</span> {a.recommendedAction}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {auditNotes && <SummaryBlock title="Auditor Notes" body={auditNotes} />}
    </div>
  );
}

function Section({
  title,
  titleClassName,
  children,
}: {
  title: string;
  titleClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p
        className={cn(
          'text-[11px] uppercase tracking-wide font-semibold mb-2',
          titleClassName ?? 'text-ink-muted',
        )}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function SummaryBlock({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">
        {title}
      </p>
      <p className="text-sm text-ink leading-relaxed whitespace-pre-line">{body}</p>
    </div>
  );
}

function SummaryListBlock({ title, items }: { title: string; items: unknown[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">
        {title}
      </p>
      <ul className="text-sm text-ink list-disc list-inside space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>{typeof it === 'string' ? it : JSON.stringify(it)}</li>
        ))}
      </ul>
    </div>
  );
}

type CodeTone = 'warn' | 'muted' | 'success';

function CodeGroup({
  label,
  tone,
  codes,
}: {
  label: string;
  tone: CodeTone;
  codes: AiPredictedCode[];
}) {
  const labelTone = {
    warn: 'text-warn',
    muted: 'text-ink-muted',
    success: 'text-success',
  }[tone];
  return (
    <div>
      <p className={cn('text-[10px] uppercase tracking-wide font-semibold mb-1.5', labelTone)}>
        {label}
      </p>
      <div className="space-y-1">
        {codes.map((c, i) => (
          <CodeRow key={`${label}-${i}`} c={c} tone={tone} />
        ))}
      </div>
    </div>
  );
}

function CodeRow({ c, tone }: { c: AiPredictedCode; tone: CodeTone }) {
  const bg = {
    warn: 'bg-warn-soft text-warn',
    muted: 'bg-surface-sunken text-ink',
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
      <div className="flex-1 min-w-0">
        {c.description && (
          <p className="text-[11px] leading-snug text-ink-muted break-words">
            {c.description}
          </p>
        )}
        {c.justification && (
          <p className="text-[11px] leading-snug text-ink-subtle break-words mt-0.5 italic">
            {c.justification}
          </p>
        )}
      </div>
    </div>
  );
}
