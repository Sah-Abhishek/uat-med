import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiEncounterResult, UploadedDocument } from '@/api/types';

interface Props {
  open: boolean;
  onClose: () => void;
  docs: UploadedDocument[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Optional — when present, an "AI Summary" pseudo-doc appears in the sidebar. */
  prediction?: AiEncounterResult | null;
}

export function DocumentViewerModal({ open, onClose, docs, activeId, onSelect, prediction }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [view, setView] = useState<'doc' | 'ai-summary'>('doc');
  const active = docs.find((d) => d.id === activeId);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-card shadow-2xl w-[min(1200px,95vw)] h-[85vh] flex overflow-hidden border border-line"
      >
        {/* Sidebar */}
        <aside
          className={cn(
            'border-r border-line bg-surface-sunken/40 transition-[width] duration-200 flex flex-col',
            sidebarOpen ? 'w-64' : 'w-16',
          )}
        >
          <div className="flex items-center justify-between p-3 border-b border-line">
            {sidebarOpen && (
              <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                Documents ({docs.length})
              </span>
            )}
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="w-7 h-7 rounded-full bg-surface flex items-center justify-center hover:bg-surface-2"
            >
              {sidebarOpen ? (
                <ChevronLeft className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {docs.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onSelect(d.id);
                  setView('doc');
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition',
                  d.id === activeId && view === 'doc'
                    ? 'bg-warn-soft text-warn'
                    : 'hover:bg-surface-2/60',
                )}
                title={d.filename}
              >
                <FileText className="w-4 h-4 shrink-0 text-ink-muted" />
                {sidebarOpen && (
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{d.filename}</p>
                    <p className="text-[10px] text-ink-subtle truncate">{d.reportType}</p>
                  </div>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setView('ai-summary')}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition mt-2',
                view === 'ai-summary'
                  ? 'bg-primary-soft text-primary-ink dark:text-primary'
                  : 'hover:bg-surface-2/60',
              )}
            >
              <Sparkles className="w-4 h-4 shrink-0 text-primary-ink dark:text-primary" />
              {sidebarOpen && <span className="text-xs font-semibold truncate">AI Summary</span>}
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center justify-between px-5 py-3 border-b border-line">
            <h3 className="text-sm font-semibold text-ink truncate">
              {view === 'ai-summary' ? 'AI Summary' : active?.filename ?? 'Select a document'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-surface-2 flex items-center justify-center text-ink-muted"
            >
              <X className="w-4 h-4" />
            </button>
          </header>
          <div className="flex-1 bg-surface-sunken/40 overflow-auto">
            {view === 'ai-summary' ? (
              <AiSummaryPanel prediction={prediction} />
            ) : active?.url ? (
              <iframe
                src={active.url}
                className="w-full h-full bg-surface"
                title={active.filename}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-ink-muted p-6">
                Select a document on the left to preview it.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── AI summary view — renders the gateway's clinical_summary blob ──────── */

function AiSummaryPanel({ prediction }: { prediction?: AiEncounterResult | null }) {
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
  const labs = cs.significant_labs && typeof cs.significant_labs === 'object'
    ? Object.entries(cs.significant_labs as Record<string, unknown>)
    : [];

  return (
    <div className="p-6 space-y-5 text-sm">
      <SummaryBlock title="Chief Complaint" body={text('chief_complaint')} />
      <SummaryBlock title="Clinical Context" body={text('clinical_context')} />

      <SummaryListBlock title="Primary Diagnoses" items={list('primary_diagnoses')} />
      <SummaryListBlock title="Secondary Diagnoses" items={list('secondary_diagnoses')} />
      <SummaryListBlock title="Procedures Performed" items={list('procedures_performed')} />

      {labs.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-2">
            Significant Labs
          </p>
          <div className="rounded-md border border-line divide-y divide-line">
            {labs.map(([test, value]) => (
              <div key={test} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-semibold text-ink">{test}</span>
                <span className="text-xs text-ink-muted font-mono">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {prediction.auditNotes && (
        <SummaryBlock title="Auditor Notes" body={prediction.auditNotes} />
      )}
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
