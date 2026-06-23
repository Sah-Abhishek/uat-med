import { Avatar, PillBadge } from '@/components/ui/Primitives';
import { cn } from '@/lib/utils';
import type { QaLiveDraft } from '@/api/qa';
import { decodeDecisions, draftKey, fmtAgo, summarize } from './shared';

const ACTIVE_WINDOW_MS = 90_000;

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
  ageMs,
  onOpen,
}: {
  draft: QaLiveDraft;
  ageMs: number;
  onOpen: (chartId: number, userId: number) => void;
}) {
  const s = summarize(decodeDecisions(draft.payload));
  const live = ageMs < ACTIVE_WINDOW_MS;
  const name = draft.user.fullName ?? `User #${draft.user.id}`;
  const place = [draft.clientName, draft.locationName, draft.subSpecialityName].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={() => onOpen(draft.chartId, draft.user.id)}
      title="Open the chart and review this coder's decisions"
      className={cn(
        'w-full text-left rounded-xl border border-line bg-surface p-4 transition hover:bg-surface-2/50 hover:border-primary/40',
        !live && 'opacity-60',
      )}
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
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] shrink-0',
            live ? 'text-success' : 'text-ink-subtle',
          )}
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              live ? 'bg-success animate-pulse' : 'bg-ink-subtle/50',
            )}
          />
          {live ? 'live' : fmtAgo(ageMs)}
        </span>
      </div>

      {place && <p className="mt-2 text-[11px] text-ink-muted truncate">{place}</p>}

      <div className="mt-2.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-ink">
          {s.total} decided
        </span>
        <VerdictCount label="accepted" n={s.accepted} tone="text-success" />
        <VerdictCount label="rejected" n={s.rejected} tone="text-danger" />
        <VerdictCount label="edited" n={s.edited} tone="text-warn" />
        <VerdictCount label="added" n={s.added} tone="text-info" />
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
  onOpen: (chartId: number, userId: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {drafts.map((d) => {
        // Skew-correct the server timestamp before comparing to the local clock.
        const ageMs = now - skewMs - Date.parse(d.updatedAt);
        return <LiveCard key={draftKey(d)} draft={d} ageMs={ageMs} onOpen={onOpen} />;
      })}
    </div>
  );
}
