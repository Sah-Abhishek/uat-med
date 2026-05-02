import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Menu,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { getActiveTimer } from '@/api/charts';
import type {
  AiEncounterResult,
  AiPredictedCode,
  UploadedDocument,
} from '@/api/types';
import { Input } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { AiSummaryPanel } from './AiSummaryPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  prediction: AiEncounterResult | null;
  docs?: UploadedDocument[];
}

type Decision = 'pending' | 'accepted' | 'rejected' | 'edited' | 'added';
type Category = 'ADMIT CODE' | 'PRIMARY' | 'SECONDARY' | 'PROCEDURE';

interface CodeItem {
  key: string;
  category: Category;
  code: string;
  description: string;
  confidence?: number;
  reasoning?: string;
}

interface CodeState {
  decision: Decision;
  editedCode: string;
  editedDescription: string;
  rejectReason: string;
}

const CATEGORY_ORDER: Category[] = ['ADMIT CODE', 'PRIMARY', 'SECONDARY', 'PROCEDURE'];

const CATEGORY_DOT: Record<Category, string> = {
  'ADMIT CODE': 'bg-success',
  PRIMARY: 'bg-info',
  SECONDARY: 'bg-success',
  PROCEDURE: 'bg-success',
};

const LEGEND: { d: Decision; label: string; cls: string }[] = [
  { d: 'accepted', label: 'Accepted', cls: 'bg-success' },
  { d: 'rejected', label: 'Rejected', cls: 'bg-danger' },
  { d: 'edited', label: 'Edited', cls: 'bg-info' },
  { d: 'added', label: 'Added', cls: 'bg-violet-500' },
  { d: 'pending', label: 'Pending', cls: 'bg-ink-subtle' },
];

/**
 * The encounter API returns no distinct admit slot. We mirror the first
 * primary code into the ADMIT CODE section so the UI matches the design,
 * while keeping the rest of the categories backed by their own arrays.
 */
function buildItems(prediction: AiEncounterResult | null): CodeItem[] {
  if (!prediction) return [];
  const mk = (c: AiPredictedCode, category: Category, i: number): CodeItem => ({
    key: `${category}-${i}-${c.code}`,
    category,
    code: c.code,
    description: c.description,
    confidence: c.confidence,
    reasoning: c.justification,
  });
  const admit = prediction.primary[0]
    ? [mk(prediction.primary[0], 'ADMIT CODE', 0)]
    : [];
  return [
    ...admit,
    ...prediction.primary.map((c, i) => mk(c, 'PRIMARY', i)),
    ...prediction.secondary.map((c, i) => mk(c, 'SECONDARY', i)),
    ...prediction.procedures.map((c, i) => mk(c, 'PROCEDURE', i)),
  ];
}

function fmtTimer(secs: number) {
  const total = Math.max(0, Math.floor(secs));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm.toString().padStart(2, '0')} : ${ss.toString().padStart(2, '0')}`;
}

type TopTab = 'documents' | 'ai-summary';

export function ReviewEditModal({ open, onClose, prediction, docs = [] }: Props) {
  const items = useMemo(() => buildItems(prediction), [prediction]);
  const [state, setState] = useState<Record<string, CodeState>>({});
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Two-level left pane: top picks Documents vs AI Summary, sub picks
  // which uploaded document is in view.
  const [topTab, setTopTab] = useState<TopTab>('documents');
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // Hydrate per-row state when the modal opens or the prediction changes.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, CodeState> = {};
    for (const it of items) {
      next[it.key] = {
        decision: 'pending',
        editedCode: it.code,
        editedDescription: it.description,
        rejectReason: '',
      };
    }
    setState(next);
    setSelectedIdx(0);
    setEditing(false);
    setActiveDocId(docs[0]?.id ?? null);
    setTopTab(docs.length > 0 ? 'documents' : 'ai-summary');
  }, [open, items, docs]);

  // Live timer pill mirrors the chart's running session. Cached by react-query
  // with the same key the header uses, so no extra network round-trip.
  const activeTimer = useQuery({
    queryKey: ['active-timer'],
    queryFn: getActiveTimer,
    enabled: open,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [open]);
  const elapsed = activeTimer.data
    ? Math.max(0, Math.floor((now - Date.parse(activeTimer.data.startedAt)) / 1000))
    : 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const reviewedCount = items.filter((it) => state[it.key]?.decision !== 'pending').length;
  const selected = items[selectedIdx];
  const selectedSt = selected ? state[selected.key] : undefined;

  const update = (key: string, patch: Partial<CodeState>) =>
    setState((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const setDecision = (d: Decision) => {
    if (!selected) return;
    update(selected.key, { decision: d });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-stretch p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="m-auto bg-surface rounded-xl shadow-2xl w-[min(1500px,98vw)] h-[min(940px,94vh)] flex flex-col overflow-hidden border border-line"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 bg-[#1A1F2B] text-white">
          <div className="flex items-center gap-4">
            <span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-white/70">
              Review &amp; Edit
            </span>
            <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/10 text-warn text-xs font-mono">
              <Clock className="w-3.5 h-3.5" />
              {fmtTimer(elapsed)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-pill bg-success text-white text-sm font-semibold hover:brightness-110 transition"
            >
              <Check className="w-3.5 h-3.5" />
              Review &amp; Submit
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 rounded-md hover:bg-white/10 flex items-center justify-center text-white/70"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_460px] min-h-0">
          <DocumentPane
            docs={docs}
            topTab={topTab}
            setTopTab={setTopTab}
            activeDocId={activeDocId}
            setActiveDocId={setActiveDocId}
            prediction={prediction}
          />
          <CodesPane
            items={items}
            state={state}
            selected={selected}
            selectedSt={selectedSt}
            selectedIdx={selectedIdx}
            setSelectedIdx={setSelectedIdx}
            update={update}
            setDecision={setDecision}
            editing={editing}
            setEditing={setEditing}
            reviewedCount={reviewedCount}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Document pane ───────────────────────────────────────── */

function DocumentPane({
  docs,
  topTab,
  setTopTab,
  activeDocId,
  setActiveDocId,
  prediction,
}: {
  docs: UploadedDocument[];
  topTab: TopTab;
  setTopTab: (t: TopTab) => void;
  activeDocId: string | null;
  setActiveDocId: (id: string) => void;
  prediction: AiEncounterResult | null;
}) {
  const showDocs = topTab === 'documents';
  const activeDoc =
    docs.find((d) => d.id === activeDocId) ?? (docs.length > 0 ? docs[0] : undefined);

  return (
    <div className="flex flex-col min-h-0 border-r border-line">
      {/* Top-level tabs */}
      <div className="flex items-stretch border-b border-line bg-surface">
        <TopLevelTab
          active={showDocs}
          onClick={() => setTopTab('documents')}
          icon={<FileText className="w-3.5 h-3.5" />}
        >
          Documents
          {docs.length > 0 && (
            <span className="ml-1 text-[10px] font-mono text-ink-muted">({docs.length})</span>
          )}
        </TopLevelTab>
        <TopLevelTab
          active={!showDocs}
          onClick={() => setTopTab('ai-summary')}
          icon={<Sparkles className="w-3.5 h-3.5" />}
        >
          AI Summary
        </TopLevelTab>
      </div>

      {/* Sub-tabs — one per uploaded doc, only visible under Documents */}
      {showDocs && docs.length > 0 && (
        <div className="flex items-stretch border-b border-line bg-surface-sunken/40 overflow-x-auto">
          {docs.map((d) => (
            <SubTab
              key={d.id}
              active={d.id === activeDoc?.id}
              onClick={() => setActiveDocId(d.id)}
              label={d.filename}
              sublabel={d.reportType}
            />
          ))}
        </div>
      )}

      {/* Toolbar — purely chrome; the embedded PDF viewer renders its own
          real controls inside the iframe. */}
      {showDocs && activeDoc && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-sunken/60 border-b border-line text-xs text-ink-muted">
          <ToolbarButton><Menu className="w-3.5 h-3.5" /></ToolbarButton>
          <span className="font-medium text-ink truncate max-w-[280px]">{activeDoc.filename}</span>
          <span className="mx-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface border border-line font-mono text-[11px]">
            1
          </span>
          <span>/&nbsp;1</span>
          <span className="flex-1" />
          <ToolbarButton><Minus className="w-3.5 h-3.5" /></ToolbarButton>
          <span className="px-2 py-0.5 rounded bg-surface border border-line font-mono text-[11px]">100%</span>
          <ToolbarButton><Plus className="w-3.5 h-3.5" /></ToolbarButton>
          <ToolbarButton><RotateCw className="w-3.5 h-3.5" /></ToolbarButton>
          <ToolbarButton><Pencil className="w-3.5 h-3.5" /></ToolbarButton>
          <span className="w-px h-4 bg-line mx-1" />
          <ToolbarButton><Undo2 className="w-3.5 h-3.5" /></ToolbarButton>
          <ToolbarButton><Redo2 className="w-3.5 h-3.5" /></ToolbarButton>
          <span className="flex-1" />
          <ToolbarButton><Download className="w-3.5 h-3.5" /></ToolbarButton>
          <ToolbarButton><Printer className="w-3.5 h-3.5" /></ToolbarButton>
          <ToolbarButton><MoreVertical className="w-3.5 h-3.5" /></ToolbarButton>
        </div>
      )}

      <div className="flex-1 bg-surface-sunken/40 overflow-auto">
        {!showDocs ? (
          <AiSummaryPanel prediction={prediction} />
        ) : activeDoc?.url ? (
          <iframe
            src={activeDoc.url}
            className="w-full h-full bg-surface"
            title={activeDoc.filename}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-ink-muted p-6">
            No documents uploaded yet.
          </div>
        )}
      </div>
    </div>
  );
}

function TopLevelTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition',
        active
          ? 'border-warn text-ink bg-surface'
          : 'border-transparent text-ink-muted hover:bg-surface-sunken/40',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function SubTab({
  active,
  onClick,
  label,
  sublabel,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sublabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={sublabel ? `${label} · ${sublabel}` : label}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 border-r border-r-line/60 transition flex-shrink-0 max-w-[220px]',
        active
          ? 'border-b-warn text-ink bg-surface'
          : 'border-b-transparent text-ink-muted hover:text-ink hover:bg-surface/40',
      )}
    >
      <FileText className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function ToolbarButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="w-7 h-7 rounded hover:bg-surface flex items-center justify-center text-ink-muted hover:text-ink transition"
    >
      {children}
    </button>
  );
}

/* ── Codes pane ──────────────────────────────────────────── */

function CodesPane({
  items,
  state,
  selected,
  selectedSt,
  selectedIdx,
  setSelectedIdx,
  update,
  setDecision,
  editing,
  setEditing,
  reviewedCount,
}: {
  items: CodeItem[];
  state: Record<string, CodeState>;
  selected: CodeItem | undefined;
  selectedSt: CodeState | undefined;
  selectedIdx: number;
  setSelectedIdx: (i: number) => void;
  update: (key: string, patch: Partial<CodeState>) => void;
  setDecision: (d: Decision) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  reviewedCount: number;
}) {
  const groups = CATEGORY_ORDER
    .map((cat) => ({ cat, list: items.filter((it) => it.category === cat) }))
    .filter((g) => g.list.length > 0);

  return (
    <div className="flex flex-col min-h-0 bg-surface">
      {/* Header row */}
      <div className="px-5 py-4 border-b border-line">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">ICD &amp; CPT Codes</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {items.length} code{items.length === 1 ? '' : 's'} · {reviewedCount} reviewed
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 px-3 h-8 rounded-md border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Code
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 px-3 h-8 rounded-md border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Rule
            </button>
          </div>
        </div>
      </div>

      {/* Code groups + legend */}
      <div className="px-5 py-4 space-y-3 border-b border-line">
        {groups.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-6">
            No predicted codes yet. Upload documents and run the AI pipeline first.
          </p>
        ) : (
          groups.map(({ cat, list }) => (
            <CategoryRow
              key={cat}
              category={cat}
              list={list}
              allItems={items}
              state={state}
              selectedIdx={selectedIdx}
              setSelectedIdx={setSelectedIdx}
            />
          ))
        )}
        {groups.length > 0 && <Legend />}
      </div>

      {/* Selected detail card */}
      <div className="flex-1 overflow-auto p-5">
        {selected && selectedSt && (
          <SelectedCard
            item={selected}
            st={selectedSt}
            update={(p) => update(selected.key, p)}
            setDecision={setDecision}
            editing={editing}
            setEditing={setEditing}
          />
        )}
      </div>

      {/* Pagination */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 items-center px-5 py-3 border-t border-line bg-surface-sunken/30">
          <button
            type="button"
            onClick={() => setSelectedIdx(Math.max(0, selectedIdx - 1))}
            disabled={selectedIdx === 0}
            className="justify-self-start inline-flex items-center gap-1 px-3 h-8 rounded-md border border-line text-xs font-semibold text-ink-muted hover:bg-surface-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Previous
          </button>
          <span className="justify-self-center text-xs text-ink-muted font-mono">
            {selectedIdx + 1} / {items.length}
          </span>
          <button
            type="button"
            onClick={() => setSelectedIdx(Math.min(items.length - 1, selectedIdx + 1))}
            disabled={selectedIdx >= items.length - 1}
            className="justify-self-end inline-flex items-center gap-1 px-3 h-8 rounded-md border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  list,
  allItems,
  state,
  selectedIdx,
  setSelectedIdx,
}: {
  category: Category;
  list: CodeItem[];
  allItems: CodeItem[];
  state: Record<string, CodeState>;
  selectedIdx: number;
  setSelectedIdx: (i: number) => void;
}) {
  const dot = CATEGORY_DOT[category];
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />
        <span className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted">
          {category} ({list.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-3">
        {list.map((it) => {
          const idx = allItems.findIndex((a) => a.key === it.key);
          const st = state[it.key];
          const isSelected = idx === selectedIdx;
          const dec = (st?.decision ?? 'pending') as Decision;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={cn(
                'inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold border transition',
                isSelected
                  ? 'border-warn bg-warn-soft text-warn shadow-sm'
                  : decisionChip(dec),
              )}
            >
              {st?.editedCode || it.code}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function decisionChip(d: Decision) {
  switch (d) {
    case 'accepted':
      return 'border-success/40 bg-success-soft/50 text-success hover:bg-success-soft';
    case 'rejected':
      return 'border-danger/40 bg-danger-soft/50 text-danger line-through hover:bg-danger-soft';
    case 'edited':
      return 'border-info/40 bg-info-soft/50 text-info hover:bg-info-soft';
    case 'added':
      return 'border-violet-400/40 bg-violet-100/60 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/15 dark:text-violet-300';
    default:
      return 'border-line bg-surface text-ink hover:bg-surface-2';
  }
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2">
      {LEGEND.map((l) => (
        <span key={l.d} className="inline-flex items-center gap-1.5 text-[10px] text-ink-muted">
          <span className={cn('w-1.5 h-1.5 rounded-full', l.cls)} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

function SelectedCard({
  item,
  st,
  update,
  setDecision,
  editing,
  setEditing,
}: {
  item: CodeItem;
  st: CodeState;
  update: (patch: Partial<CodeState>) => void;
  setDecision: (d: Decision) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-sunken/30 p-4">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
        {item.category}
      </p>
      {editing ? (
        <div className="space-y-2 mb-3">
          <Input
            value={st.editedCode}
            onChange={(e) => update({ editedCode: e.target.value })}
            className="font-mono"
          />
          <Input
            value={st.editedDescription}
            onChange={(e) => update({ editedDescription: e.target.value })}
          />
        </div>
      ) : (
        <>
          <p className="text-2xl font-bold font-mono text-ink mb-1.5">{st.editedCode}</p>
          <p className="text-sm text-ink leading-snug">{st.editedDescription}</p>
        </>
      )}

      {item.reasoning && (
        <div className="mt-4 rounded-lg border border-warn/30 bg-warn-soft/40 p-3">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-warn mb-1">
            AI Reasoning
          </p>
          <p className="text-xs text-ink leading-relaxed">{item.reasoning}</p>
        </div>
      )}

      {typeof item.confidence === 'number' && (
        <p className="mt-3 text-[10px] uppercase tracking-wide font-semibold text-danger">
          {item.confidence.toFixed(1)} confidence
        </p>
      )}

      {st.decision === 'rejected' && !editing && (
        <Input
          placeholder="Reason for rejection…"
          value={st.rejectReason}
          onChange={(e) => update({ rejectReason: e.target.value })}
          className="mt-3"
        />
      )}

      <div className="grid grid-cols-3 gap-2 mt-4">
        {editing ? (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDecision('edited');
            }}
            className="col-span-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg border border-info/30 bg-info-soft/50 text-info hover:bg-info-soft transition"
          >
            <Save className="w-3.5 h-3.5" /> Save Edit
          </button>
        ) : (
          <>
            <DecisionButton
              tone="success"
              active={st.decision === 'accepted'}
              icon={<Check className="w-3.5 h-3.5" />}
              onClick={() => setDecision(st.decision === 'accepted' ? 'pending' : 'accepted')}
            >
              Accept
            </DecisionButton>
            <DecisionButton
              tone="danger"
              active={st.decision === 'rejected'}
              icon={<X className="w-3.5 h-3.5" />}
              onClick={() => setDecision(st.decision === 'rejected' ? 'pending' : 'rejected')}
            >
              Reject
            </DecisionButton>
            <DecisionButton
              tone="info"
              active={false}
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => setEditing(true)}
            >
              Edit
            </DecisionButton>
          </>
        )}
      </div>
    </div>
  );
}

function DecisionButton({
  tone,
  active,
  icon,
  children,
  onClick,
}: {
  tone: 'success' | 'danger' | 'info';
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  const cls = {
    success: active
      ? 'bg-success text-white border-success'
      : 'bg-success-soft/50 text-success border-success/30 hover:bg-success-soft',
    danger: active
      ? 'bg-danger text-white border-danger'
      : 'bg-danger-soft/50 text-danger border-danger/30 hover:bg-danger-soft',
    info: active
      ? 'bg-info text-white border-info'
      : 'bg-info-soft/50 text-info border-info/30 hover:bg-info-soft',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg border transition',
        cls,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

