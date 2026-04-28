import { Card } from '@/components/ui/Card';
import { PriorityBadge } from '../shared';
import type { AiEncounterResult } from '@/api/types';

export interface Gap {
  priority: 'High' | 'Medium' | 'Low';
  description: string;
  impact: string;
  suggestion: string;
}

interface Props {
  prediction?: AiEncounterResult | null;
  /** Override extracted gaps with an explicit list (used in tests/storybooks). */
  gaps?: Gap[];
}

/**
 * The ICD Predictor encounter response doesn't currently carry structured
 * `documentation_gaps[]` — the reference med-ex backend leaves the array empty
 * too. We render the card whenever a prediction has been generated, with an
 * empty state, so the user sees the section instead of it silently disappearing.
 */
export function DocumentationGaps({ prediction, gaps }: Props) {
  if (!prediction && !gaps?.length) return null;
  const items = gaps ?? extractGaps(prediction);

  return (
    <Card padding="default">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
        Documentation Gaps
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-ink-muted">No documentation gaps identified by AI.</p>
      ) : (
        <div className="space-y-3">
          {items.map((g, i) => (
            <div key={i} className="border-l-2 border-warn pl-3">
              <div className="flex items-center gap-2 mb-1">
                <PriorityBadge priority={g.priority} />
              </div>
              <p className="text-xs font-semibold text-ink mb-1">{g.description}</p>
              <p className="text-[11px] text-ink-muted mb-2">{g.impact}</p>
              <p className="text-[11px] text-success bg-success-soft rounded-md px-2 py-1">
                {g.suggestion}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function extractGaps(prediction?: AiEncounterResult | null): Gap[] {
  if (!prediction) return [];
  // Prefer the structured field surfaced from agent4_full.feedback. Fall back
  // to the legacy clinical_summary.documentation_gaps shape for older runs.
  if (prediction.documentationGaps?.length) {
    return prediction.documentationGaps
      .map((g) => ({
        priority: (g.priority as Gap['priority']) ?? 'Medium',
        description: g.gap ?? '',
        impact: g.impact ?? '',
        suggestion: g.suggestion ?? '',
      }))
      .filter((g) => g.description);
  }
  const raw = (prediction.clinicalSummary as Record<string, unknown> | undefined)?.documentation_gaps;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((g) => ({
      priority: (g.priority as Gap['priority']) ?? 'Medium',
      description: String(g.description ?? g.gap ?? ''),
      impact: String(g.impact ?? ''),
      suggestion: String(g.suggestion ?? g.recommendation ?? ''),
    }))
    .filter((g) => g.description);
}
