import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPredictedCodes, type PredictedCodeWithId } from '@/api/charts';
import type { AiEncounterResult, AiPredictedCode } from '@/api/types';

/**
 * The single source of truth for a chart's AI ICD codes.
 *
 * The sidebar "AI ICD Prediction" card and the "Review & Edit" modal used to
 * read different sources (a persisted snapshot vs. a live gateway call) and so
 * could drift apart for the same chart. This hook unifies them: it runs the
 * SAME `getPredictedCodes` query the modal uses — under the SAME query key, so
 * react-query dedupes it into one network call — and exposes one normalized
 * prediction both consumers derive from. If they read the same data, they
 * cannot disagree. (See docs/AI_CODES_SINGLE_SOURCE_FIX.md.)
 */
export interface UnifiedAiCodes {
  /** AI prediction in the sidebar's `AiEncounterResult` shape. When the live
   * gateway codes-with-IDs response is available it wins (and every code
   * carries `predictedCodeId`); otherwise this is the persisted snapshot. Null
   * when the chart has neither. */
  prediction: AiEncounterResult | null;
  /** Provenance of `prediction`, for debugging the live-vs-snapshot path. */
  source: 'live' | 'snapshot' | 'none';
  /** The shared predicted-codes query has settled (success/error) or was never
   * enabled — i.e. `prediction` is in its final shape. The modal gates its
   * draft restore/autosave on this so it never stamps decisions onto a board
   * that's about to swap from snapshot codes to live ones. */
  isSettled: boolean;
}

type Bucket = 'primary' | 'secondary' | 'procedures';

function bucketOf(codeType: string | undefined): Bucket | null {
  const t = (codeType ?? '').toLowerCase();
  if (t === 'primary') return 'primary';
  if (t === 'secondary') return 'secondary';
  if (t === 'procedure' || t === 'cpt') return 'procedures';
  return null;
}

/** Map a gateway codes-with-IDs row onto the sidebar's `AiPredictedCode` shape,
 * preserving the `predicted_code_id` UUID the modal needs on submit. Mirrors the
 * field mapping in ReviewEditModal#buildItemsFromPredictedCodes so the two
 * consumers see byte-identical codes. */
function toAiCode(r: PredictedCodeWithId): AiPredictedCode {
  return {
    code: r.icd_code,
    description: r.description,
    confidence: r.confidence,
    codeType: r.code_type,
    sequencePos: r.sequence_pos ?? undefined,
    justification: (r.evidence_json as { justification?: string } | null)?.justification,
    predictedCodeId: r.id,
  };
}

const normalize = (code: string) => code.replace(/\./g, '').trim().toUpperCase();

export function useChartAiCodes(
  chartId: string,
  persistedAiPrediction: AiEncounterResult | null,
  opts?: { enabled?: boolean },
): UnifiedAiCodes {
  // The gateway resolves live codes by the encounter id stored ON the snapshot,
  // so a chart with no snapshot encounter has nothing live to fetch — skip the
  // round-trip and fall straight back to the (null) snapshot.
  const enabled =
    (opts?.enabled ?? true) && !!chartId && !!persistedAiPrediction?.encounterId;

  const q = useQuery({
    // Same key the Review modal uses → react-query dedupes: one network call
    // shared by the sidebar and the modal.
    queryKey: ['chart-predicted-codes', chartId],
    queryFn: () => getPredictedCodes(chartId),
    enabled,
  });

  return useMemo<UnifiedAiCodes>(() => {
    // A disabled query never settles on its own — treat "nothing to fetch" as
    // settled so the modal's board doesn't wait forever on a non-AI chart.
    const isSettled = !enabled || q.isSuccess || q.isError;
    const rows = q.data?.codes;

    if (rows && rows.length > 0) {
      // Stable order: by sequence position, then code — independent of the
      // gateway's response order, so the backend snapshot self-heal produces a
      // deterministic codes array and doesn't churn on every read.
      const sorted = [...rows].sort(
        (a, b) =>
          (a.sequence_pos ?? Number.MAX_SAFE_INTEGER) -
            (b.sequence_pos ?? Number.MAX_SAFE_INTEGER) ||
          a.icd_code.localeCompare(b.icd_code),
      );
      const buckets: Record<Bucket, AiPredictedCode[]> = {
        primary: [],
        secondary: [],
        procedures: [],
      };
      const seen = new Set<string>();
      for (const r of sorted) {
        const bucket = bucketOf(r.code_type);
        if (!bucket) continue;
        const key = `${bucket}|${normalize(r.icd_code)}`;
        if (seen.has(key)) continue; // same (category, code) twice → keep first
        seen.add(key);
        buckets[bucket].push(toAiCode(r));
      }
      const codes = [...buckets.primary, ...buckets.secondary, ...buckets.procedures];
      // Preserve the snapshot's narrative + timing fields (the gateway codes
      // endpoint returns none of them) — only the code arrays come from live.
      // `enabled` guarantees a non-null snapshot here, but stay defensive.
      const base = persistedAiPrediction ?? ({} as AiEncounterResult);
      return {
        prediction: {
          ...base,
          encounterId: q.data?.encounterId ?? base.encounterId,
          codes,
          primary: buckets.primary,
          secondary: buckets.secondary,
          procedures: buckets.procedures,
        },
        source: 'live',
        isSettled,
      };
    }

    // No live codes (query disabled, empty, still loading, or errored): fall
    // back to the persisted snapshot so the sidebar still renders offline.
    return {
      prediction: persistedAiPrediction,
      source: persistedAiPrediction ? 'snapshot' : 'none',
      isSettled,
    };
  }, [enabled, q.data, q.isSuccess, q.isError, persistedAiPrediction]);
}
