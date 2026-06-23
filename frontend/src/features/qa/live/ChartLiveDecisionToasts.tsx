import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodeDecisionDraft } from '@/api/charts';
import { LiveToastStack, type LiveToast } from './LiveToastStack';
import { DECISION_VARIANT, DECISION_VERB, decodeDecisions, type LiveDecision } from './shared';

const POLL_MS = 4_000;
const COALESCE = 3; // more than this in one poll → a single summary toast
const STACK_CAP = 4;

interface DiffEvent {
  kind: 'decide' | 'reopen';
  code: string;
  decision?: LiveDecision;
}

/**
 * Live decision toasts for ONE chart, scoped to ONE coder/auditor. Mounted on
 * the chart page when QA opened it from the Live tab (`?qa=1&liveUserId=`), it
 * polls that coder's in-progress draft and pops "{name} rejected F54.4" as new
 * decisions land. Shares the draft query key with the Review & Edit modal, so
 * one poll drives both the toasts here and the modal's live board.
 */
export function ChartLiveDecisionToasts({
  chartId,
  coderUserId,
  coderName,
  onSeeMore,
}: {
  chartId: string;
  coderUserId: number;
  coderName: string;
  /** Opens the Review & Edit modal so QA can see the decision in context. */
  onSeeMore?: () => void;
}) {
  const q = useQuery({
    // Same key the modal's draftQ uses → a single shared, deduped poll.
    queryKey: ['chart-code-decision-draft', chartId, coderUserId],
    queryFn: () => getCodeDecisionDraft(chartId, coderUserId),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const prevByKey = useRef<Map<string, LiveDecision>>(new Map());
  const seededRef = useRef(false);
  const toastIdRef = useRef(0);

  // Diff each successful fetch once (keyed on dataUpdatedAt — see LiveTab).
  useEffect(() => {
    if (!q.data) return;
    // A null draft means the coder hasn't started OR just submitted (the row is
    // deleted on submit). Either way there's nothing to diff against keys that
    // vanished — treat it as a baseline reset, never a burst of "reopened".
    const draftPresent = !!q.data.draft;
    const decisions = decodeDecisions(q.data.draft?.payload ?? null);

    const newMap = new Map<string, LiveDecision>();
    for (const e of decisions) {
      const code = e.code?.trim();
      if (!code) continue;
      newMap.set(`${e.category}:${code}`, e.decision);
    }

    // First poll seeds the baseline silently — only decisions made AFTER QA
    // opened the chart produce toasts.
    if (!seededRef.current) {
      prevByKey.current = newMap;
      seededRef.current = true;
      return;
    }

    const events: DiffEvent[] = [];
    for (const e of decisions) {
      const code = e.code?.trim();
      if (!code) continue;
      const prev = prevByKey.current.get(`${e.category}:${code}`);
      if (prev === e.decision) continue; // unchanged / silent edit
      events.push({ kind: 'decide', code, decision: e.decision });
    }
    if (draftPresent) {
      for (const [key] of prevByKey.current) {
        if (newMap.has(key)) continue; // reopened (removed from the still-present draft)
        events.push({ kind: 'reopen', code: key.split(':').slice(1).join(':') });
      }
    }
    prevByKey.current = newMap;

    if (events.length === 0) return;

    const nextId = () => (toastIdRef.current += 1);
    const seeMoreKey = onSeeMore ? 'review' : null;
    const fresh: LiveToast[] =
      events.length > COALESCE
        ? [{ id: nextId(), variant: 'info', message: `${coderName} updated ${events.length} codes`, draftKey: seeMoreKey }]
        : events.map((e) =>
            e.kind === 'reopen'
              ? { id: nextId(), variant: 'info', message: `${coderName} reopened ${e.code}`, draftKey: seeMoreKey }
              : {
                  id: nextId(),
                  variant: DECISION_VARIANT[e.decision!],
                  message: `${coderName} ${DECISION_VERB[e.decision!]} ${e.code}`,
                  draftKey: seeMoreKey,
                },
          );

    setToasts((p) => [...p, ...fresh].slice(-STACK_CAP));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on dataUpdatedAt so
    // each fetch is processed once; q.data is consistent with it.
  }, [q.dataUpdatedAt]);

  const dismiss = (id: number) => setToasts((p) => p.filter((t) => t.id !== id));

  return <LiveToastStack toasts={toasts} onDismiss={dismiss} onSeeMore={() => onSeeMore?.()} />;
}
