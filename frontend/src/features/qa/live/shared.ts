import type { CodeDecisionDraftEntry, CodeDecisionDraftPayload } from '@/api/charts';
import type { QaLiveDraft } from '@/api/qa';

/** The four verdicts a coder can land on a code. */
export type LiveDecision = CodeDecisionDraftEntry['decision'];

/** Mirrors the variants the shared <Toast> understands. */
export type LiveVariant = 'warn' | 'danger' | 'success' | 'info';

export const DECISION_VARIANT: Record<LiveDecision, LiveVariant> = {
  accepted: 'success',
  rejected: 'danger',
  edited: 'warn',
  added: 'info',
  moved: 'warn',
};

/** Past-tense verb for "{name} {verb} {code}" toast lines. */
export const DECISION_VERB: Record<LiveDecision, string> = {
  accepted: 'accepted',
  rejected: 'rejected',
  edited: 'edited',
  added: 'added',
  moved: 'recategorized',
};

/** Stable identity for one coder's board on one chart — the card key and the
 * scope a (category, code) decision belongs to. */
export const draftKey = (d: Pick<QaLiveDraft, 'chartId'> & { user: { id: number } }) =>
  `${d.chartId}:${d.user.id}`;

/** Decode the autosaved draft blob defensively — unknown versions are dropped
 * (the payload is versioned precisely so we can skip incompatible shapes). */
export function decodeDecisions(payload: CodeDecisionDraftPayload | null): CodeDecisionDraftEntry[] {
  if (!payload || payload.version !== 1) return [];
  return payload.decisions ?? [];
}

export interface DecisionSummary {
  total: number;
  accepted: number;
  rejected: number;
  edited: number;
  added: number;
  moved: number;
}

export function summarize(entries: CodeDecisionDraftEntry[]): DecisionSummary {
  const s: DecisionSummary = { total: entries.length, accepted: 0, rejected: 0, edited: 0, added: 0, moved: 0 };
  for (const e of entries) s[e.decision] += 1;
  return s;
}

/** Compact "just now / 12s / 4m ago" from a millisecond age. */
export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** Compact elapsed duration "45s / 12m / 1h 5m" from a millisecond span. */
export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
