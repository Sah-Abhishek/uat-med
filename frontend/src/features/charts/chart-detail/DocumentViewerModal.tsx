import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiEncounterResult, UploadedDocument } from '@/api/types';
import { AiSummaryPanel } from './AiSummaryPanel';

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

