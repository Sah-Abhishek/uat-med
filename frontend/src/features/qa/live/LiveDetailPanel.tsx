import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import { Avatar, PillBadge } from '@/components/ui/Primitives';
import { cn } from '@/lib/utils';
import type { CodeDecisionDraftEntry } from '@/api/charts';
import type { QaLiveDraft } from '@/api/qa';
import { DECISION_VARIANT, decodeDecisions, fmtAgo } from './shared';

const CATEGORY_ORDER: CodeDecisionDraftEntry['category'][] = ['PRIMARY', 'SECONDARY', 'PROCEDURE'];
const CATEGORY_LABEL: Record<CodeDecisionDraftEntry['category'], string> = {
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
  PROCEDURE: 'Procedure',
};

const VERDICT_BADGE: Record<string, string> = {
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
};

function DecisionRow({ e }: { e: CodeDecisionDraftEntry }) {
  const tone = DECISION_VARIANT[e.decision];
  const edited = e.decision === 'edited' || e.decision === 'added';
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-semibold text-ink">{e.code || '—'}</span>
        {edited && e.editedCode && e.editedCode !== e.code && (
          <span className="font-mono text-xs font-semibold text-ink-muted">→ {e.editedCode}</span>
        )}
        <span
          className={cn(
            'ml-auto text-[10px] uppercase tracking-wide font-bold rounded px-1.5 py-0.5',
            VERDICT_BADGE[tone],
          )}
        >
          {e.decision}
        </span>
      </div>
      {edited && e.editedDescription && (
        <p className="mt-1 text-[11px] text-ink-muted">{e.editedDescription}</p>
      )}
      {(e.reasonDropdown || e.rejectReason) && (
        <p className="mt-1 text-[11px] text-ink-subtle">
          {[e.reasonDropdown, e.rejectReason].filter(Boolean).join(' — ')}
        </p>
      )}
    </div>
  );
}

/** Right-anchored slide-over showing one coder's running decision list for a
 * chart. Reads the draft from the parent's live query data, so it keeps
 * updating on each poll while open. Reuses the Modal scroll-lock convention. */
export function LiveDetailPanel({
  draft,
  ageMs,
  onClose,
}: {
  draft: QaLiveDraft | null | undefined;
  ageMs: number | null;
  onClose: () => void;
}) {
  const open = !!draft;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const mainEl = document.querySelector('main') as HTMLElement | null;
    const prevMain = mainEl?.style.overflow ?? '';
    const prevBody = document.body.style.overflow;
    if (mainEl) mainEl.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      if (mainEl) mainEl.style.overflow = prevMain;
      document.body.style.overflow = prevBody;
    };
  }, [open, onClose]);

  if (!draft || typeof document === 'undefined') return null;

  const entries = decodeDecisions(draft.payload);
  const name = draft.user.fullName ?? `User #${draft.user.id}`;
  const place = [draft.clientName, draft.locationName, draft.subSpecialityName].filter(Boolean).join(' · ');

  return createPortal(
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-[min(440px,96vw)] h-full bg-surface border-l border-line shadow-pop flex flex-col animate-[toast-in_180ms_ease-out]"
      >
        <header className="flex items-start gap-3 px-5 py-4 border-b border-line shrink-0">
          <Avatar name={name} src={draft.user.avatarUrl ?? undefined} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink truncate">{name}</span>
              <PillBadge tone={draft.kind === 'AUDIT' ? 'sky' : 'mint'}>
                {draft.kind === 'AUDIT' ? 'Auditor' : 'Coder'}
              </PillBadge>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Link
                to={`/charts/${draft.chartId}?qa=1`}
                className="font-mono text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
              >
                {draft.chartNo || `#${draft.chartId}`}
                <ExternalLink className="w-3 h-3" />
              </Link>
              {ageMs != null && (
                <span className="text-[11px] text-ink-subtle">· updated {fmtAgo(ageMs)}</span>
              )}
            </div>
            {place && <p className="text-[11px] text-ink-muted truncate mt-0.5">{place}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:bg-surface-sunken transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {entries.length === 0 ? (
            <p className="text-sm text-ink-muted">No decisions yet on this chart.</p>
          ) : (
            CATEGORY_ORDER.map((cat) => {
              const rows = entries.filter((e) => e.category === cat);
              if (rows.length === 0) return null;
              return (
                <div key={cat}>
                  <h4 className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1.5">
                    {CATEGORY_LABEL[cat]} ({rows.length})
                  </h4>
                  <div className="space-y-1.5">
                    {rows.map((e, i) => (
                      <DecisionRow key={`${e.category}:${e.code}:${i}`} e={e} />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
