import { Card } from '@/components/ui/Card';
import { PriorityBadge } from '../shared';
import type { AiEncounterResult } from '@/api/types';

export interface PhysicianQuery {
  priority: 'High' | 'Medium' | 'Low';
  description: string;
  reason: string;
  codingImpact: string;
}

interface Props {
  prediction?: AiEncounterResult | null;
  queries?: PhysicianQuery[];
}

export function PhysicianQueries({ prediction, queries }: Props) {
  if (!prediction && !queries?.length) return null;
  const items = queries ?? extractQueries(prediction);

  return (
    <Card padding="default">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
        Physician Queries Needed
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-ink-muted">No physician queries flagged by AI.</p>
      ) : (
        <div className="space-y-3">
          {items.map((q, i) => (
            <div key={i} className="border-l-2 border-info pl-3">
              <div className="flex items-center gap-2 mb-1">
                <PriorityBadge priority={q.priority} />
              </div>
              <p className="text-xs font-semibold text-ink mb-1">{q.description}</p>
              <p className="text-[11px] text-ink-muted mb-1">
                <span className="font-semibold">Reason:</span> {q.reason}
              </p>
              <p className="text-[11px] text-ink-muted">
                <span className="font-semibold">Coding Impact:</span> {q.codingImpact}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function extractQueries(prediction?: AiEncounterResult | null): PhysicianQuery[] {
  if (!prediction) return [];
  if (prediction.physicianQueries?.length) {
    return prediction.physicianQueries
      .map((q) => ({
        priority: (q.priority as PhysicianQuery['priority']) ?? 'Medium',
        description: q.query ?? '',
        reason: q.reason ?? '',
        codingImpact: q.impactOnCoding ?? '',
      }))
      .filter((q) => q.description);
  }
  const raw = (prediction.clinicalSummary as Record<string, unknown> | undefined)?.physician_queries_needed;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((q) => ({
      priority: (q.priority as PhysicianQuery['priority']) ?? 'Medium',
      description: String(q.description ?? q.query ?? ''),
      reason: String(q.reason ?? ''),
      codingImpact: String(q.coding_impact ?? q.codingImpact ?? ''),
    }))
    .filter((q) => q.description);
}
