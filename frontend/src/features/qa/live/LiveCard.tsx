import { Avatar, PillBadge } from '@/components/ui/Primitives';
import { cn } from '@/lib/utils';
import type { QaLiveDraft } from '@/api/qa';
import { decodeDecisions, draftKey, fmtDur, summarize } from './shared';

function VerdictCount({ label, n, tone }: { label: string; n: number; tone: string }) {
  if (n === 0) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', tone)}>
      <span className="tabular-nums">{n}</span>
      <span className="text-ink-subtle font-normal">{label}</span>
    </span>
  );
}

function LiveCard({
  draft,
  workingMs,
  onOpen,
}: {
  draft: QaLiveDraft;
  workingMs: number;
  onOpen: (chartId: number, userId: number, name: string) => void;
}) {
  const s = summarize(decodeDecisions(draft.payload));
  const name = draft.user.fullName ?? `User #${draft.user.id}`;
  const place = [draft.clientName, draft.locationName, draft.subSpecialityName].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={() => onOpen(draft.chartId, draft.user.id, name)}
      title="Open the chart and review this coder's decisions"
      className="w-full text-left rounded-xl border border-line bg-surface p-4 transition hover:bg-surface-2/50 hover:border-primary/40"
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={name} src={draft.user.avatarUrl ?? undefined} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink truncate">{name}</span>
            <PillBadge tone={draft.kind === 'AUDIT' ? 'sky' : 'mint'}>
              {draft.kind === 'AUDIT' ? 'Auditor' : 'Coder'}
            </PillBadge>
          </div>
          <span className="block text-[11px] text-ink-muted font-mono">
            {draft.chartNo || `#${draft.chartId}`}
          </span>
        </div>
        {/* Every card is an open timer session, so it's always live. */}
        <span className="inline-flex items-center gap-1.5 text-[11px] shrink-0 text-success">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          live · {fmtDur(workingMs)}
        </span>
      </div>

      {place && <p className="mt-2 text-[11px] text-ink-muted truncate">{place}</p>}

      <div className="mt-2.5 flex items-center gap-3 flex-wrap">
        {s.total === 0 ? (
          <span className="text-xs text-ink-muted">No decisions yet</span>
        ) : (
          <>
            <span className="text-xs font-semibold text-ink">{s.total} decided</span>
            <VerdictCount label="accepted" n={s.accepted} tone="text-success" />
            <VerdictCount label="rejected" n={s.rejected} tone="text-danger" />
            <VerdictCount label="edited" n={s.edited} tone="text-warn" />
            <VerdictCount label="added" n={s.added} tone="text-info" />
            <VerdictCount label="recategorizing" n={s.moved} tone="text-warn" />
          </>
        )}
      </div>
    </button>
  );
}

export function LiveCardList({
  drafts,
  now,
  skewMs,
  onOpen,
}: {
  drafts: QaLiveDraft[];
  now: number;
  skewMs: number;
  onOpen: (chartId: number, userId: number, name: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {drafts.map((d) => {
        // Skew-correct the timer start before measuring how long they've worked.
        const workingMs = now - skewMs - Date.parse(d.startedAt);
        return <LiveCard key={draftKey(d)} draft={d} workingMs={workingMs} onOpen={onOpen} />;
      })}
    </div>
  );
}
