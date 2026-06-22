import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  GripVertical,
  Loader2,
  Menu,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Search,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { IS_PRODUCTION_DEPLOYMENT, DEPLOYMENT } from '@/config/deployment';
import {
  getActiveTimer,
  getCodeDecisionDraft,
  getPredictedCodes,
  listCodeDecisions,
  saveCodeDecisionDraft,
  submitCodeDecisions,
  type CodeDecisionDraftEntry,
  type CodeDecisionDraftPayload,
  type CodeDecisionInput,
  type CodeDecisionType,
  type CodeDecisionVerdict,
  type CodeDraftCategory,
  type PredictedCodeWithId,
} from '@/api/charts';
import { useAuth } from '@/auth/store';
import {
  getCodeReviewReasons,
  type CodeReviewReasonRow,
} from '@/api/configurations';
import { AddRuleModal } from '@/features/coder-rules/AddRuleModal';
import type {
  AiEncounterResult,
  AiPredictedCode,
  UploadedDocument,
} from '@/api/types';
import { FancySelect, Input, Textarea } from '@/components/ui/Field';
import { searchIcdCodes, type IcdCodeHit } from '@/api/icdCodes';
import { cn } from '@/lib/utils';
import { AiSummaryPanel } from './AiSummaryPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  prediction: AiEncounterResult | null;
  docs?: UploadedDocument[];
  chartId: string;
  clientId?: number;
  locationId?: number;
  onSubmitted?: () => void;
  /** QA / Team Lead viewer. Loads previously-submitted decisions, hydrates
   * the on-screen state from them, and locks every control — no submit, no
   * decision buttons, no edits. */
  readOnly?: boolean;
}

type Decision = 'pending' | 'accepted' | 'rejected' | 'edited' | 'added';
// 'ADMIT CODE' kept in the type for now — the section is currently disabled
// in buildItems() because admit code and primary diagnosis are the same
// thing. Re-enable by uncommenting the admit lines below.
type Category = 'ADMIT CODE' | 'PRIMARY' | 'SECONDARY' | 'PROCEDURE';
const REASON_MIN_CHARS = 20;

/** Canonical form for comparing ICD/CPT codes when deciding whether a code is
 * already on the board: dots stripped, trimmed, upper-cased. So `K64.9`,
 * `k649` and `K649` all collapse to the same key and count as one code. Used by
 * the Add-Code duplicate guard. */
function normalizeCode(code: string): string {
  return code.replace(/\./g, '').trim().toUpperCase();
}

/**
 * Maps the on-screen Category onto the API's CodeReviewType. ADMIT CODE
 * is a UI mirror of the first PRIMARY, so we treat it as PRIMARY for
 * persistence (and skip it in the submit payload to avoid a duplicate
 * (chart, type, code) row — the PRIMARY row is the source of truth).
 */
function categoryToCodeType(c: Category): CodeDecisionType | null {
  switch (c) {
    case 'PRIMARY': return 'PRIMARY';
    case 'SECONDARY': return 'SECONDARY';
    case 'PROCEDURE': return 'PROCEDURE';
    case 'ADMIT CODE': return null; // mirror of PRIMARY
    default: return null;
  }
}

/** Inverse of categoryToCodeType — maps a persisted decision's codeType back
 * onto the on-screen Category. EM_LEVEL / MODIFIER aren't rendered as ICD
 * code rows, so they map to null and are skipped. */
function codeTypeToCategory(t: CodeDecisionType): Category | null {
  switch (t) {
    case 'PRIMARY': return 'PRIMARY';
    case 'SECONDARY': return 'SECONDARY';
    case 'PROCEDURE': return 'PROCEDURE';
    default: return null;
  }
}

/** Maps a persisted verdict onto the modal's local Decision state. */
function verdictToDecision(v: CodeDecisionVerdict): Decision {
  switch (v) {
    case 'ACCEPTED': return 'accepted';
    case 'REJECTED': return 'rejected';
    case 'EDITED': return 'edited';
    case 'ADDED': return 'added';
  }
}

interface CodeItem {
  key: string;
  category: Category;
  code: string;
  description: string;
  confidence?: number;
  reasoning?: string;
  /** Orchestrator UUID — only present when the items were sourced from
   * /charts/:id/predicted-codes. Required for the orchestrator forward. */
  predictedCodeId?: string;
}

interface CodeState {
  decision: Decision;
  editedCode: string;
  editedDescription: string;
  /** Free-text reason; required (≥20 chars) on Reject/Edit. */
  rejectReason: string;
  /** Dropdown reason; required on Reject/Edit. Picked from Settings. */
  reasonDropdown: string;
}

// 'ADMIT CODE' intentionally omitted — admit code === primary diagnosis.
const CATEGORY_ORDER: Category[] = [/* 'ADMIT CODE', */ 'PRIMARY', 'SECONDARY', 'PROCEDURE'];

const CATEGORY_DOT: Record<Category, string> = {
  'ADMIT CODE': 'bg-success', // unused while admit is hidden; kept so the type stays satisfied.
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
 * Builds the reviewable code list. Admit code and primary diagnosis are
 * the same thing in this workflow, so the ADMIT CODE mirror has been
 * disabled — the first PRIMARY row is the source of truth. Restore by
 * uncommenting the `admit` block below.
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
  // const admit = prediction.primary[0]
  //   ? [mk(prediction.primary[0], 'ADMIT CODE', 0)]
  //   : [];
  const all: CodeItem[] = [
    // ...admit,
    ...prediction.primary.map((c, i) => mk(c, 'PRIMARY', i)),
    ...prediction.secondary.map((c, i) => mk(c, 'SECONDARY', i)),
    ...prediction.procedures.map((c, i) => mk(c, 'PROCEDURE', i)),
  ];
  return dedupeByCategoryCode(all);
}

/** AI sometimes returns the same code more than once in the same category
 * (different sequence positions or duplicate hits). Show each unique
 * (category, code) pair just once — first occurrence wins. Same code
 * across DIFFERENT categories is allowed (rare but valid clinically). */
function dedupeByCategoryCode(items: CodeItem[]): CodeItem[] {
  const seen = new Set<string>();
  const out: CodeItem[] = [];
  for (const it of items) {
    const key = `${it.category}|${it.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** Builds items from the orchestrator's codes-with-IDs response — the
 * preferred source because each item carries `predictedCodeId` (the UUID
 * the orchestrator needs back on submit). Falls back to buildItems() when
 * this fetch fails. */
function buildItemsFromPredictedCodes(rows: PredictedCodeWithId[]): CodeItem[] {
  const categoryFor = (codeType: string): Category | null => {
    const t = codeType?.toLowerCase();
    if (t === 'primary')   return 'PRIMARY';
    if (t === 'secondary') return 'SECONDARY';
    if (t === 'procedure' || t === 'cpt') return 'PROCEDURE';
    return null;
  };
  const out: CodeItem[] = [];
  // Sort so the modal's category order is stable: Primary → Secondary → Procedure.
  const order: Record<Category, number> = {
    'ADMIT CODE': 0, PRIMARY: 1, SECONDARY: 2, PROCEDURE: 3,
  };
  const tagged = rows
    .map((r, i) => ({ r, i, cat: categoryFor(r.code_type) }))
    .filter((x): x is { r: PredictedCodeWithId; i: number; cat: Category } => x.cat !== null)
    .sort((a, b) =>
      order[a.cat] - order[b.cat] ||
      (a.r.sequence_pos ?? a.i) - (b.r.sequence_pos ?? b.i),
    );
  for (const { r, i, cat } of tagged) {
    out.push({
      key: `${cat}-${i}-${r.icd_code}-${r.id}`,
      category: cat,
      code: r.icd_code,
      description: r.description,
      confidence: r.confidence,
      reasoning: (r.evidence_json as any)?.justification,
      predictedCodeId: r.id,
    });
  }
  return dedupeByCategoryCode(out);
}

function fmtTimer(secs: number) {
  const total = Math.max(0, Math.floor(secs));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm.toString().padStart(2, '0')} : ${ss.toString().padStart(2, '0')}`;
}

type TopTab = 'documents' | 'ai-summary';

export function ReviewEditModal({
  open,
  onClose,
  prediction,
  docs = [],
  chartId,
  clientId,
  locationId,
  onSubmitted,
  readOnly = false,
}: Props) {
  // Prefer the orchestrator codes-with-IDs response (each item carries
  // `predictedCodeId` for the submit forward). Fall back to the AI
  // prediction blob if the fetch hasn't returned yet or fails.
  const predictedCodesQ = useQuery({
    queryKey: ['chart-predicted-codes', chartId],
    queryFn: () => getPredictedCodes(chartId),
    enabled: open && !!chartId,
  });
  const aiItems = useMemo(() => {
    const rows = predictedCodesQ.data?.codes;
    if (rows && rows.length > 0) return buildItemsFromPredictedCodes(rows);
    return buildItems(prediction);
  }, [predictedCodesQ.data, prediction]);
  const [state, setState] = useState<Record<string, CodeState>>({});
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Two-level left pane: top picks Documents vs AI Summary, sub picks
  // which uploaded document is in view.
  const [topTab, setTopTab] = useState<TopTab>('documents');
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Codes the coder added that the AI didn't suggest. Persisted into
  // chart_code_decisions and forwarded to the orchestrator as ADD actions.
  const [addedItems, setAddedItems] = useState<CodeItem[]>([]);
  const [addCodeOpen, setAddCodeOpen] = useState(false);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  // In-place category moves, keyed by item.key. Lets a coder change ANY code's
  // category (AI-predicted or user-added) straight from its detail card, instead
  // of removing + re-adding it. Applied over the derived `items` below so the
  // override survives the AI items being recomputed. Reset on every open.
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, Category>>({});

  // Resizable split between the document pane (left) and codes pane (right).
  // We drive only the codes-pane width and let the document pane take the rest,
  // applied via a CSS var so the stacked layout below `lg` is untouched. Width is
  // persisted so a coder's preferred split sticks across charts.
  const SPLIT_MIN_CODES = 340;
  const SPLIT_MIN_DOC = 460;
  const SPLIT_DEFAULT = 460;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [codesW, setCodesW] = useState<number>(() => {
    if (typeof window === 'undefined') return SPLIT_DEFAULT;
    const saved = Number(window.localStorage.getItem('reviewEditCodesW'));
    return Number.isFinite(saved) && saved >= SPLIT_MIN_CODES && saved <= 1000 ? saved : SPLIT_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);

  // Translate the pointer X into a codes-pane width measured from the modal's
  // right edge, clamped so neither pane collapses.
  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return;
      const max = Math.max(SPLIT_MIN_CODES, rect.width - SPLIT_MIN_DOC);
      const next = Math.round(rect.right - e.clientX);
      setCodesW(Math.min(Math.max(next, SPLIT_MIN_CODES), max));
    }
    function onUp() {
      setResizing(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('reviewEditCodesW', String(codesW));
  }, [codesW]);
  // AI items first (in their natural category order), user-added items
  // after — added codes show up at the end of their respective category
  // section because CategoryRow filters by `it.category`. Declared after
  // addedItems to keep the closure reference order valid.
  const items = useMemo(
    () =>
      [...aiItems, ...addedItems].map((it) => {
        const moved = categoryOverrides[it.key];
        return moved && moved !== it.category ? { ...it, category: moved } : it;
      }),
    [aiItems, addedItems, categoryOverrides],
  );

  // Reset transient UI + clear added codes whenever the modal opens. Stays
  // in [open] only — we don't want to wipe user decisions if the items
  // array changes mid-session (which now happens when the user adds a code).
  useEffect(() => {
    if (!open) return;
    setSelectedIdx(0);
    setEditing(false);
    setSubmitError(null);
    setConfirmOpen(false);
    setAddedItems([]);
    setCategoryOverrides({});
    setAddCodeOpen(false);
    setAddRuleOpen(false);
    setActiveDocId(docs[0]?.id ?? null);
    setTopTab(docs.length > 0 ? 'documents' : 'ai-summary');
  }, [open, docs]);

  // Merge state for items: seed any new keys with a 'pending' default, drop
  // entries for items that no longer exist (e.g. an added code was removed).
  // This preserves prior decisions across items-array changes — critical
  // so adding a code doesn't blow away in-progress reviews on AI codes.
  useEffect(() => {
    if (!open) return;
    setState((prev) => {
      const next: Record<string, CodeState> = {};
      for (const it of items) {
        next[it.key] = prev[it.key] ?? {
          decision: 'pending',
          editedCode: it.code,
          editedDescription: it.description,
          rejectReason: '',
          reasonDropdown: '',
        };
      }
      return next;
    });
  }, [open, items]);

  // Configurable reason lists for this chart's (client, location). Loaded
  // once when the modal opens; the SelectedCard filters by codeType + action.
  const reasonsQ = useQuery({
    queryKey: ['code-review-reasons', clientId, locationId],
    queryFn: () => getCodeReviewReasons({ clientId: clientId!, locationId: locationId! }),
    enabled: open && !!clientId && !!locationId,
  });
  const reasonRows: CodeReviewReasonRow[] = reasonsQ.data?.items ?? [];

  // Pull whatever decisions were previously submitted for this chart. Loaded
  // in BOTH modes: QA read-only needs it to show the coder's verdicts, and
  // editable mode needs it so the board reflects the same edited/rejected/
  // added state the sidebar's AI ICD card shows (instead of silently
  // diverging by displaying the raw orchestrator prediction).
  const decisionsQ = useQuery({
    queryKey: ['chart-code-decisions', chartId],
    queryFn: () => listCodeDecisions(chartId),
    enabled: open && !!chartId,
  });
  // Pre-seed the board from previously-submitted decisions so the modal shows
  // the same codes the sidebar does. On reopen after a prior submit, the coder
  // (or a QA viewer) sees their verdicts, edited values and added codes —
  // keeping the modal and the "AI ICD Prediction" card consistent.
  useEffect(() => {
    if (!open) return;
    const rows = decisionsQ.data?.items;
    if (!rows?.length) return;

    // Codes the coder ADDED aren't part of the AI prediction, so inject them
    // as synthetic items so they show up in their category section.
    const seededAdds: CodeItem[] = rows
      .filter((r) => r.decision === 'ADDED')
      .map((r, i): CodeItem | null => {
        const cat = codeTypeToCategory(r.codeType);
        if (!cat) return null;
        const code = r.editedCode ?? r.codeValue;
        return {
          key: `added-${cat}-${i}-${code}`,
          category: cat,
          code,
          description: r.editedDescription ?? r.originalDescription ?? '',
          predictedCodeId: r.predictedCodeId,
        };
      })
      .filter((v): v is CodeItem => v !== null);

    setState((prev) => {
      const next = { ...prev };
      // AI-predicted items: match by (codeType, codeValue) and stamp the verdict.
      for (const it of aiItems) {
        const codeType = categoryToCodeType(it.category);
        if (!codeType) continue;
        const match = rows.find(
          (r) => r.decision !== 'ADDED' && r.codeType === codeType && r.codeValue === it.code,
        );
        if (!match) continue;
        next[it.key] = {
          decision: verdictToDecision(match.decision),
          editedCode: match.editedCode ?? it.code,
          editedDescription: match.editedDescription ?? it.description,
          rejectReason: match.reasonText ?? '',
          reasonDropdown: match.reasonDropdown ?? '',
        };
      }
      // Added items: seed their 'added' state. The items-merge effect keys off
      // prev[item.key], so setting state here before appending preserves it.
      for (const it of seededAdds) {
        if (next[it.key]) continue;
        const match = rows.find(
          (r) => r.decision === 'ADDED' && codeTypeToCategory(r.codeType) === it.category && (r.editedCode ?? r.codeValue) === it.code,
        );
        next[it.key] = {
          decision: 'added',
          editedCode: it.code,
          editedDescription: it.description,
          rejectReason: match?.reasonText ?? '',
          reasonDropdown: match?.reasonDropdown ?? '',
        };
      }
      return next;
    });
    setAddedItems((prev) => (prev.length > 0 ? prev : seededAdds));
  }, [open, decisionsQ.data, aiItems]);

  /* ── Draft persistence ─────────────────────────────────────────────────
   * The board's in-progress state autosaves to the server (per chart, per
   * user) so a refresh / crash / device switch doesn't lose unsubmitted
   * work. Entries are identified by (category, code) — the same identity
   * the board dedupes on — NOT by the index-based React keys, so a draft
   * re-attaches correctly even if the predictions come back reordered.
   * Read-only (QA) mode never reads or writes drafts. */

  const qc = useQueryClient();

  const draftQ = useQuery({
    queryKey: ['chart-code-decision-draft', chartId],
    queryFn: () => getCodeDecisionDraft(chartId),
    enabled: open && !!chartId && !readOnly,
    // No background refetches while the modal is open: the server copy is
    // ours alone (per-user) and mid-session refetches could stamp a stale
    // blob over live edits. Fresh fetch per open is handled by the cache
    // removal on close below.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  /** Restore pass has settled — autosave may engage. Gated so the freshly
   * seeded (all-pending) board can never overwrite a real server draft. */
  const draftHydratedRef = useRef(false);
  /** Serialization of the last draft known to be on the server. */
  const lastSavedDraftRef = useRef<string | null>(null);
  /** Debounce-pending payload, flushed on close / page unload. */
  const pendingDraftRef = useRef<CodeDecisionDraftPayload | null>(null);
  /** Inputs the restore pass last ran against (draft, decisions, aiItems). */
  const appliedDraftRef = useRef<unknown[] | null>(null);
  /** True while the final submit is in flight/settled-successful — blocks a
   * late debounce timer from re-creating the draft the submit just deleted. */
  const submitInFlightRef = useRef(false);
  /** Render-fresh mirror of addedItems for effects that must read it without
   * re-running when it changes. */
  const addedItemsRef = useRef(addedItems);
  useEffect(() => {
    addedItemsRef.current = addedItems;
  }, [addedItems]);

  useEffect(() => {
    if (open) {
      draftHydratedRef.current = false;
      lastSavedDraftRef.current = null;
      pendingDraftRef.current = null;
      appliedDraftRef.current = null;
      submitInFlightRef.current = false;
    } else {
      // Drop the cached draft on close: autosaves don't update the
      // react-query cache, so the next open must re-fetch the server copy.
      qc.removeQueries({ queryKey: ['chart-code-decision-draft', chartId] });
    }
  }, [open, qc, chartId]);

  // All three sources settled (success or error) — the board is in its final
  // shape, so restoring/saving against it is safe.
  const boardReady =
    open &&
    (predictedCodesQ.isSuccess || predictedCodesQ.isError) &&
    (decisionsQ.isSuccess || decisionsQ.isError) &&
    (readOnly || draftQ.isSuccess || draftQ.isError);

  /** Serializes the board's reviewable working state. ADMIT CODE rows (UI
   * mirror of PRIMARY) and untouched 'pending' rows are dropped — a restore
   * only stamps what the user actually decided. */
  const buildDraftPayload = useCallback((): CodeDecisionDraftPayload => {
    const decisions: CodeDecisionDraftEntry[] = [];
    for (const it of items) {
      if (!categoryToCodeType(it.category)) continue;
      const st = state[it.key];
      if (!st || st.decision === 'pending') continue;
      decisions.push({
        category: it.category as CodeDraftCategory,
        code: it.code,
        decision: st.decision,
        editedCode: st.editedCode,
        editedDescription: st.editedDescription,
        rejectReason: st.rejectReason,
        reasonDropdown: st.reasonDropdown,
      });
    }
    return {
      version: 1,
      decisions,
      addedItems: addedItems
        // Reflect in-place category moves so a moved added code is recreated in
        // its new category on restore (its decision is keyed by that category).
        .map((it) => ({ ...it, category: categoryOverrides[it.key] ?? it.category }))
        .filter((it) => categoryToCodeType(it.category))
        .map((it) => ({
          category: it.category as CodeDraftCategory,
          code: it.code,
          description: it.description,
        })),
    };
  }, [items, state, addedItems, categoryOverrides]);

  // Restore: stamp the draft over whatever the submitted-decisions hydration
  // seeded (the draft is newer working state, so it wins — codes absent from
  // the draft keep their hydrated/submitted verdicts). Runs once per change
  // of its actual inputs; react-query's structural sharing keeps the data
  // references stable across no-op refetches, and user edits never re-trigger
  // it. Declared AFTER the decisions hydration effect on purpose: same-commit
  // runs execute in order, so the draft lands on top.
  useEffect(() => {
    if (!open || readOnly || !boardReady || draftQ.isError) return;
    const inputs = [draftQ.data, decisionsQ.data, aiItems];
    const prev = appliedDraftRef.current;
    if (prev && inputs.every((v, i) => v === prev[i])) return;
    appliedDraftRef.current = inputs;
    draftHydratedRef.current = true;

    const payload = draftQ.data?.draft?.payload;
    // Version gate + shape guard: an incompatible or corrupted blob is
    // silently discarded (the next autosave overwrites it) — never crash the
    // modal over a draft.
    if (
      !payload ||
      payload.version !== 1 ||
      !Array.isArray(payload.decisions) ||
      !Array.isArray(payload.addedItems)
    ) {
      return;
    }
    lastSavedDraftRef.current = JSON.stringify(payload);

    // Recreate codes added in the drafted session that exist nowhere on the
    // current board (not AI-predicted, not previously submitted as ADDED).
    const current = [...aiItems, ...addedItemsRef.current];
    const have = new Set(current.map((it) => `${it.category}|${it.code}`));
    const draftAdds: CodeItem[] = payload.addedItems
      .filter((a) => !have.has(`${a.category}|${a.code}`))
      .map((a, i) => ({
        key: `draft-added-${a.category}-${i}-${a.code}`,
        category: a.category,
        code: a.code,
        description: a.description,
      }));

    const boardItems = [...current, ...draftAdds];
    const byIdentity = new Map(payload.decisions.map((d) => [`${d.category}|${d.code}`, d]));

    // Re-apply in-place category moves. A drafted decision whose (category|code)
    // matches nothing on the board, yet whose code exists under a DIFFERENT
    // category, was a moved code — recreate the move so it (and its decision)
    // survive a refresh. (Added-code moves round-trip via draftAdds already.)
    const exactKeys = new Set(boardItems.map((it) => `${it.category}|${it.code}`));
    const movedDecisionByKey: Record<string, CodeDecisionDraftEntry> = {};
    const moveOverrides: Record<string, Category> = {};
    for (const d of payload.decisions) {
      if (exactKeys.has(`${d.category}|${d.code}`)) continue;
      const target = boardItems.find(
        (it) => normalizeCode(it.code) === normalizeCode(d.code) && !movedDecisionByKey[it.key],
      );
      if (!target) continue;
      movedDecisionByKey[target.key] = d;
      moveOverrides[target.key] = d.category as Category;
    }

    setState((prevState) => {
      const next = { ...prevState };
      for (const it of boardItems) {
        const d = movedDecisionByKey[it.key] ?? byIdentity.get(`${it.category}|${it.code}`);
        if (!d) continue;
        next[it.key] = {
          decision: d.decision,
          editedCode: d.editedCode || it.code,
          editedDescription: d.editedDescription || it.description,
          rejectReason: d.rejectReason,
          reasonDropdown: d.reasonDropdown,
        };
      }
      return next;
    });
    if (Object.keys(moveOverrides).length > 0) {
      setCategoryOverrides((prev) => ({ ...prev, ...moveOverrides }));
    }
    if (draftAdds.length > 0) {
      // Functional dedupe (not just `have`): the submitted-ADDED seeding can
      // land in this same commit, and addedItemsRef is one commit behind it.
      setAddedItems((prevAdds) => {
        const present = new Set(prevAdds.map((it) => `${it.category}|${it.code}`));
        return [...prevAdds, ...draftAdds.filter((it) => !present.has(`${it.category}|${it.code}`))];
      });
    }
  }, [open, readOnly, boardReady, draftQ.data, draftQ.isError, decisionsQ.data, aiItems]);

  const draftSaveMut = useMutation({
    mutationFn: (payload: CodeDecisionDraftPayload) => saveCodeDecisionDraft(chartId, payload),
  });
  const { mutate: saveDraftMutate } = draftSaveMut;

  /** Fire a save for `payload`, tracking server-known content on success and
   * re-queueing the payload for the close/unload flush on failure. */
  const sendDraft = useCallback(
    (payload: CodeDecisionDraftPayload) => {
      // A submit supersedes the draft (and deletes it server-side) — never
      // race a stale autosave against it.
      if (submitInFlightRef.current) return;
      const serialized = JSON.stringify(payload);
      saveDraftMutate(payload, {
        onSuccess: () => {
          lastSavedDraftRef.current = serialized;
        },
        onError: () => {
          // Keep it pending so the next change, the close flush, or the
          // beforeunload flush retries it.
          pendingDraftRef.current = payload;
        },
      });
    },
    [saveDraftMutate],
  );

  // Debounced autosave. Guards, in order: QA view never writes; the board
  // must be fully loaded AND the restore pass done (else the freshly-seeded
  // empty board would overwrite a real server draft); a failed draft GET
  // disables writing for the session (we couldn't read the server copy, so
  // writing could destroy it); no-op when content matches the last save;
  // and don't create empty draft rows for charts the user only looked at.
  useEffect(() => {
    if (!open || readOnly || !boardReady || draftQ.isError || !draftHydratedRef.current) return;
    const payload = buildDraftPayload();
    const serialized = JSON.stringify(payload);
    if (serialized === lastSavedDraftRef.current) return;
    const isEmpty = payload.decisions.length === 0 && payload.addedItems.length === 0;
    if (isEmpty && lastSavedDraftRef.current === null) return;
    pendingDraftRef.current = payload;
    const t = setTimeout(() => {
      pendingDraftRef.current = null;
      sendDraft(payload);
    }, 800);
    return () => clearTimeout(t);
  }, [open, readOnly, boardReady, draftQ.isError, buildDraftPayload, sendDraft]);

  // Closing the modal flushes a debounce-pending draft immediately (the
  // autosave effect's cleanup has already cleared its timer by the time this
  // runs, but pendingDraftRef survives it).
  useEffect(() => {
    if (open) return;
    const pending = pendingDraftRef.current;
    if (!pending) return;
    pendingDraftRef.current = null;
    sendDraft(pending);
  }, [open, sendDraft]);

  // Page refresh / tab close: axios calls get torn down with the page, so
  // flush via fetch+keepalive (sendBeacon can't carry the bearer header).
  useEffect(() => {
    if (!open || readOnly) return;
    const onBeforeUnload = () => {
      const pending = pendingDraftRef.current;
      if (!pending) return;
      pendingDraftRef.current = null;
      const token = useAuth.getState().accessToken;
      void fetch(`${import.meta.env.VITE_API_BASE}/charts/${chartId}/code-decisions/draft`, {
        method: 'PUT',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ payload: pending }),
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [open, readOnly, chartId]);

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
      if (e.key !== 'Escape') return;
      // Esc closes the confirm dialog first, then the main modal.
      if (confirmOpen) {
        setConfirmOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, confirmOpen]);

  const submitMut = useMutation({
    mutationFn: (decisions: CodeDecisionInput[]) => submitCodeDecisions(chartId, decisions),
  });

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

  // Move a code to a different category in place. Reason dropdowns are
  // code-type-specific, so a stale dropdown reason may not belong to the new
  // category's list — clear it so the coder re-picks (the free-text note stays).
  const setItemCategory = (key: string, category: Category) => {
    setCategoryOverrides((prev) => ({ ...prev, [key]: category }));
    setState((prev) =>
      prev[key]?.reasonDropdown
        ? { ...prev, [key]: { ...prev[key], reasonDropdown: '' } }
        : prev,
    );
  };

  // Build the API payload, dropping ADMIT CODE rows (UI mirror of the
  // first PRIMARY) and rows still pending.
  const buildPayload = (): CodeDecisionInput[] => {
    const out: CodeDecisionInput[] = [];
    for (const it of items) {
      const codeType = categoryToCodeType(it.category);
      if (!codeType) continue;
      const st = state[it.key];
      if (!st || st.decision === 'pending') continue;
      const verdict =
        st.decision === 'accepted' ? 'ACCEPTED' :
        st.decision === 'rejected' ? 'REJECTED' :
        st.decision === 'edited' ? 'EDITED' :
        'ADDED';
      const requiresDropdown = verdict === 'REJECTED' || verdict === 'EDITED';
      const requiresReasonText = requiresDropdown || verdict === 'ADDED';
      out.push({
        codeType,
        codeValue: it.code,
        predictedCodeId: it.predictedCodeId,
        originalDescription: it.description,
        decision: verdict,
        editedCode: verdict === 'EDITED' || verdict === 'ADDED' ? st.editedCode : undefined,
        editedDescription:
          verdict === 'EDITED' || verdict === 'ADDED' ? st.editedDescription : undefined,
        reasonDropdown: requiresDropdown ? st.reasonDropdown.trim() : undefined,
        reasonText: requiresReasonText ? st.rejectReason.trim() : undefined,
      });
    }
    return out;
  };

  const invalidReasons = items
    .map((it) => {
      const st = state[it.key];
      if (!st) return null;
      const isReject = st.decision === 'rejected';
      const isEdit = st.decision === 'edited';
      const isAdd = st.decision === 'added';
      if (!isReject && !isEdit && !isAdd) return null;
      if (!categoryToCodeType(it.category)) return null;
      const dropdownOk = (isReject || isEdit) ? st.reasonDropdown.trim().length > 0 : true;
      const textOk = st.rejectReason.trim().length >= REASON_MIN_CHARS;
      if (dropdownOk && textOk) return null;
      return it.code;
    })
    .filter((v): v is string => v !== null);

  const payloadCount = buildPayload().length;
  const submitDisabled =
    submitMut.isPending ||
    payloadCount === 0 ||
    invalidReasons.length > 0 ||
    !clientId ||
    !locationId;

  // Header button no longer submits — it opens the confirmation dialog,
  // which renders the summary and only then fires the API on user
  // confirmation.
  const openConfirm = () => {
    setSubmitError(null);
    if (buildPayload().length === 0) return;
    setConfirmOpen(true);
  };

  const onConfirmSubmit = async () => {
    setSubmitError(null);
    const payload = buildPayload();
    if (payload.length === 0) {
      setConfirmOpen(false);
      return;
    }
    submitInFlightRef.current = true;
    try {
      await submitMut.mutateAsync(payload);
      // The submit superseded (and server-side deleted) the autosaved draft —
      // drop any debounce-pending save so the close flush can't resurrect it.
      pendingDraftRef.current = null;
      lastSavedDraftRef.current = null;
      // Refresh both the orchestrator codes and the local audit so the
      // chart detail page (AI ICD card) and the next modal-open both see
      // the post-submit state — edited code-values, removed deletes, the
      // new ADD rows, etc.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['chart-predicted-codes', chartId] }),
        qc.invalidateQueries({ queryKey: ['chart-code-decisions', chartId] }),
        qc.invalidateQueries({ queryKey: ['chart-code-decision-draft', chartId] }),
      ]);
      onSubmitted?.();
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      // Failed submit: the draft is still the source of recovery — re-enable
      // autosave so continued edits keep persisting.
      submitInFlightRef.current = false;
      const msg =
        (err as any)?.response?.data?.error?.message ??
        (err as any)?.message ??
        'Failed to submit decisions.';
      setSubmitError(msg);
    }
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
              {readOnly ? "Coder's Decisions · Read-only" : 'Review & Edit'}
            </span>
            {readOnly ? (
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-info/15 border border-info/30 text-info text-xs font-mono">
                QA View
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/10 text-warn text-xs font-mono">
                <Clock className="w-3.5 h-3.5" />
                {fmtTimer(elapsed)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Autosave status — quiet reassurance that in-progress work
                survives a refresh. Errors retry on the next change/close. */}
            {!readOnly && (draftSaveMut.isPending || draftSaveMut.isSuccess || draftSaveMut.isError) && (
              <span
                className={cn(
                  'hidden md:inline text-[11px]',
                  draftSaveMut.isError ? 'text-warn' : 'text-white/50',
                )}
              >
                {draftSaveMut.isPending
                  ? 'Saving draft…'
                  : draftSaveMut.isError
                    ? 'Draft not saved — retrying on next change'
                    : 'Draft saved'}
              </span>
            )}
            {!readOnly && submitError && (
              <span className="hidden md:inline text-xs text-danger bg-danger-soft/30 border border-danger/30 px-2 py-1 rounded">
                {submitError}
              </span>
            )}
            {!readOnly && invalidReasons.length > 0 && (
              <span
                className="hidden md:inline text-[11px] text-warn"
                title={`Missing reason on: ${invalidReasons.join(', ')}`}
              >
                {invalidReasons.length} code(s) need a reason ({REASON_MIN_CHARS}+ chars &amp; dropdown)
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={openConfirm}
                disabled={submitDisabled}
                title={
                  !clientId || !locationId
                    ? 'Chart is missing client/location'
                    : invalidReasons.length > 0
                      ? 'Provide reason text (≥20 chars) and dropdown for every Reject/Edit'
                      : payloadCount === 0
                        ? 'Mark at least one code as Accept / Reject / Edit'
                        : 'Open submission summary'
                }
                className="inline-flex items-center gap-2 h-9 px-4 rounded-pill bg-success text-white text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-3.5 h-3.5" />
                {submitMut.isPending ? 'Submitting…' : 'Review & Submit'}
              </button>
            )}
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
        <div
          ref={bodyRef}
          className="relative flex-1 grid grid-cols-1 lg:grid-cols-[1fr_var(--codes-w)] min-h-0"
          style={{ '--codes-w': `${codesW}px` } as CSSProperties}
        >
          <DocumentPane
            docs={docs}
            topTab={topTab}
            setTopTab={setTopTab}
            activeDocId={activeDocId}
            setActiveDocId={setActiveDocId}
            prediction={prediction}
          />
          {/* Drag handle — desktop only. Drag to resize, double-click to reset. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize document and codes panes"
            onMouseDown={(e) => {
              e.preventDefault();
              setResizing(true);
            }}
            onDoubleClick={() => setCodesW(SPLIT_DEFAULT)}
            title="Drag to resize · double-click to reset"
            className="hidden lg:flex absolute top-0 bottom-0 z-30 w-5 cursor-col-resize items-center justify-center group"
            style={{ right: `calc(var(--codes-w) - 10px)` }}
          >
            {/* Full-height divider line that brightens on hover/drag */}
            <span
              className={cn(
                'absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 transition-colors',
                resizing ? 'bg-primary' : 'bg-line-strong group-hover:bg-primary/60',
              )}
            />
            {/* Grip pill — sits on the divider so it's obviously draggable */}
            <span
              className={cn(
                'relative flex items-center justify-center h-16 w-5 rounded-full border shadow-card transition-colors',
                resizing
                  ? 'bg-primary border-primary text-white'
                  : 'bg-surface border-line-strong text-ink-muted group-hover:border-primary group-hover:text-primary',
              )}
            >
              <GripVertical className="w-3.5 h-3.5" />
            </span>
          </div>
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
            reasonRows={reasonRows}
            readOnly={readOnly}
            onAddCode={() => setAddCodeOpen(true)}
            onAddRule={() => setAddRuleOpen(true)}
            onChangeCategory={setItemCategory}
            onRemoveItem={(key) => {
              setAddedItems((prev) => prev.filter((it) => it.key !== key));
              setCategoryOverrides((prev) => {
                if (!(key in prev)) return prev;
                const rest = { ...prev };
                delete rest[key];
                return rest;
              });
              setSelectedIdx(0);
            }}
          />
        </div>

        {/* While dragging, this overlay captures mouse events so the PDF iframe
            doesn't swallow them and the resize stays smooth. */}
        {resizing && <div className="fixed inset-0 z-[60] cursor-col-resize" />}
      </div>

      {confirmOpen && (
        <ConfirmSubmitModal
          payload={buildPayload()}
          submitting={submitMut.isPending}
          error={submitError}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={onConfirmSubmit}
        />
      )}

      {addCodeOpen && (
        <AddCodeModal
          onClose={() => setAddCodeOpen(false)}
          // Every code currently on the board, normalized (dots/case stripped),
          // so the modal can reject a duplicate before it's added.
          existingCodes={new Set(items.map((it) => normalizeCode(state[it.key]?.editedCode || it.code)))}
          onAdd={(item, reason) => {
            // Seed state for the new item BEFORE appending it, so the
            // items-merge effect sees prev[item.key] already set and
            // preserves our decision='added' + reason instead of
            // defaulting to 'pending'.
            setState((prev) => ({
              ...prev,
              [item.key]: {
                decision: 'added',
                editedCode: item.code,
                editedDescription: item.description,
                rejectReason: reason,
                reasonDropdown: '',
              },
            }));
            setAddedItems((prev) => [...prev, item]);
            setAddCodeOpen(false);
            // Jump selection to the freshly-added item so the user sees it.
            setTimeout(() => setSelectedIdx(items.length), 0);
          }}
        />
      )}
      {addRuleOpen && (
        <AddRuleModal onClose={() => setAddRuleOpen(false)} />
      )}
    </div>
  );
}

/* ── Confirm submission modal ───────────────────────────── */

const VERDICT_META: Record<
  CodeDecisionInput['decision'],
  { label: string; chip: string; dot: string }
> = {
  ACCEPTED: {
    label: 'Accepted',
    chip: 'bg-success-soft/60 text-success border-success/30',
    dot: 'bg-success',
  },
  REJECTED: {
    label: 'Rejected',
    chip: 'bg-danger-soft/60 text-danger border-danger/30',
    dot: 'bg-danger',
  },
  EDITED: {
    label: 'Edited',
    chip: 'bg-info-soft/60 text-info border-info/30',
    dot: 'bg-info',
  },
  ADDED: {
    label: 'Added',
    chip: 'bg-violet-100/60 text-violet-700 border-violet-300/40 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
};

const CODE_TYPE_LABEL: Record<CodeDecisionType, string> = {
  PRIMARY: 'Primary Diagnosis',
  SECONDARY: 'Secondary Diagnosis',
  PROCEDURE: 'CPT / Procedure',
  EM_LEVEL: 'ED/EM Level',
  MODIFIER: 'Modifier',
};

function ConfirmSubmitModal({
  payload,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  payload: CodeDecisionInput[];
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Tally + group for the summary panes.
  const counts: Record<CodeDecisionInput['decision'], number> = {
    ACCEPTED: 0, REJECTED: 0, EDITED: 0, ADDED: 0,
  };
  for (const d of payload) counts[d.decision]++;

  const grouped = new Map<CodeDecisionType, CodeDecisionInput[]>();
  for (const d of payload) {
    const list = grouped.get(d.codeType) ?? [];
    list.push(d);
    grouped.set(d.codeType, list);
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-stretch p-3 sm:p-6"
      onClick={() => {
        if (!submitting) onCancel();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="m-auto bg-surface rounded-xl shadow-2xl w-[min(720px,96vw)] max-h-[90vh] flex flex-col overflow-hidden border border-line"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-line bg-surface-sunken/40">
          <div>
            <h3 className="text-sm font-bold text-ink">Confirm submission</h3>
            <p className="text-[11px] text-ink-muted mt-0.5">
              Review {payload.length} decision{payload.length === 1 ? '' : 's'} before sending. This cannot be undone for these codes.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            aria-label="Close"
            className="w-8 h-8 rounded-md hover:bg-surface-2 flex items-center justify-center text-ink-muted disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {!IS_PRODUCTION_DEPLOYMENT && (
          <div className="px-4 py-3 border-b border-warn/30 bg-warn/10 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-warn mt-0.5 shrink-0" />
            <div className="text-[12px] leading-relaxed text-ink">
              <div className="font-semibold text-warn mb-0.5">
                {DEPLOYMENT.toUpperCase()} environment — corrections will NOT be sent to the AI
              </div>
              <p className="text-ink-muted">
                Because this is a non-production deployment, your accepted, edited,
                rejected and added codes will be saved locally but{' '}
                <strong>will not be forwarded to the AI training system</strong>.
                This protects the golden dataset from being polluted by test data.
              </p>
            </div>
          </div>
        )}

        {/* Tallies */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 border-b border-line">
          {(['ACCEPTED', 'REJECTED', 'EDITED', 'ADDED'] as const).map((v) => {
            const meta = VERDICT_META[v];
            return (
              <div
                key={v}
                className="rounded-lg border border-line bg-surface-sunken/40 px-3 py-2 flex items-center justify-between"
              >
                <span className="inline-flex items-center gap-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
                  <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                    {meta.label}
                  </span>
                </span>
                <span className="text-lg font-bold font-mono text-ink">{counts[v]}</span>
              </div>
            );
          })}
        </div>

        {/* Decision list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {payload.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-6">
              Nothing to submit yet.
            </p>
          ) : (
            Array.from(grouped.entries()).map(([codeType, list]) => (
              <section key={codeType}>
                <h4 className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-2">
                  {CODE_TYPE_LABEL[codeType]} ({list.length})
                </h4>
                <ul className="space-y-1.5">
                  {list.map((d, i) => {
                    const meta = VERDICT_META[d.decision];
                    return (
                      <li
                        key={`${codeType}-${d.codeValue}-${i}`}
                        className="rounded-lg border border-line bg-surface px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border',
                              meta.chip,
                            )}
                          >
                            {meta.label}
                          </span>
                          <span className="font-mono font-semibold text-sm text-ink">
                            {d.decision === 'EDITED' && d.editedCode && d.editedCode !== d.codeValue ? (
                              <>
                                <span className="text-ink-muted line-through mr-1">{d.codeValue}</span>
                                <span>{d.editedCode}</span>
                              </>
                            ) : (
                              d.codeValue
                            )}
                          </span>
                          {d.originalDescription && (
                            <span className="text-xs text-ink-muted truncate flex-1 min-w-0" title={d.originalDescription}>
                              · {d.originalDescription}
                            </span>
                          )}
                        </div>
                        {d.decision === 'EDITED' && d.editedDescription &&
                          d.editedDescription !== d.originalDescription && (
                          <div className="mt-1.5 ml-1 text-[11px] text-info">
                            New description: <span className="text-ink">{d.editedDescription}</span>
                          </div>
                        )}
                        {(d.reasonDropdown || d.reasonText) && (
                          <div className="mt-1.5 ml-1 text-[11px] text-ink-muted space-y-0.5">
                            {d.reasonDropdown && (
                              <div>
                                <span className="font-semibold">Reason:</span>{' '}
                                <span className="text-ink">{d.reasonDropdown}</span>
                              </div>
                            )}
                            {d.reasonText && (
                              <div className="line-clamp-2">
                                <span className="font-semibold">Notes:</span>{' '}
                                <span className="text-ink">{d.reasonText}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        {error && (
          <div className="px-4 py-2 border-t border-line text-xs text-danger bg-danger-soft/30">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line bg-surface-sunken/40">
          <span className="text-[11px] text-ink-muted">
            Submitting will lock these decisions to the chart.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="h-9 px-4 rounded-pill border border-line text-sm font-semibold text-ink hover:bg-surface-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting || payload.length === 0}
              className="inline-flex items-center gap-2 h-9 px-5 rounded-pill bg-success text-white text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" />
              {submitting ? 'Submitting…' : 'Confirm & Submit'}
            </button>
          </div>
        </footer>
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
    <div className="flex flex-col min-h-0 min-w-0 border-r border-line">
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
  reasonRows,
  readOnly,
  onAddCode,
  onAddRule,
  onChangeCategory,
  onRemoveItem,
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
  reasonRows: CodeReviewReasonRow[];
  readOnly: boolean;
  onAddCode: () => void;
  onAddRule: () => void;
  onChangeCategory: (key: string, category: Category) => void;
  onRemoveItem: (key: string) => void;
}) {
  const groups = CATEGORY_ORDER
    .map((cat) => ({ cat, list: items.filter((it) => it.category === cat) }))
    .filter((g) => g.list.length > 0);

  return (
    <div className="flex flex-col min-h-0 min-w-0 bg-surface">
      {/* Header row */}
      <div className="px-5 py-4 border-b border-line">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">ICD &amp; CPT Codes</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {items.length} code{items.length === 1 ? '' : 's'} · {reviewedCount} reviewed
            </p>
          </div>
          {!readOnly && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onAddCode}
                className="inline-flex items-center gap-1 px-3 h-8 rounded-md border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition"
              >
                <Plus className="w-3.5 h-3.5" /> Add Code
              </button>
              <button
                type="button"
                onClick={onAddRule}
                className="inline-flex items-center gap-1 px-3 h-8 rounded-md border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition"
              >
                <Plus className="w-3.5 h-3.5" /> Add Rule
              </button>
            </div>
          )}
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
            reasonRows={reasonRows}
            readOnly={readOnly}
            onChangeCategory={(cat) => onChangeCategory(selected.key, cat)}
            onRemove={() => onRemoveItem(selected.key)}
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
  reasonRows,
  readOnly,
  onChangeCategory,
  onRemove,
}: {
  item: CodeItem;
  st: CodeState;
  update: (patch: Partial<CodeState>) => void;
  setDecision: (d: Decision) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  reasonRows: CodeReviewReasonRow[];
  readOnly: boolean;
  onChangeCategory: (category: Category) => void;
  onRemove: () => void;
}) {
  const codeType = categoryToCodeType(item.category);
  // Reason form shows under any non-pending decision that needs a reason.
  // ADDED uses the same form (text field only — no dropdown for ADD since
  // we haven't seeded ADD reason lists yet).
  const isAdded = st.decision === 'added';
  const showReasonForm = !editing && (st.decision === 'rejected' || st.decision === 'edited' || isAdded);
  const action = st.decision === 'rejected' ? 'REJECT' : 'EDIT';
  const filteredReasons =
    codeType !== null
      ? reasonRows
          .filter((r) => r.codeType === codeType && r.action === action && r.isActive)
          .sort((a, b) => a.displayOrder - b.displayOrder || a.text.localeCompare(b.text))
      : [];
  const reasonChars = st.rejectReason.trim().length;
  const dropdownMissing = showReasonForm && !isAdded && !st.reasonDropdown.trim();
  const textShort = showReasonForm && reasonChars < REASON_MIN_CHARS;

  return (
    <div className="rounded-xl border border-line bg-surface-sunken/30 p-4">
      {readOnly ? (
        <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
          {item.category}
        </p>
      ) : (
        // Change a code's category in place — the supported alternative to
        // removing + re-adding it under another section.
        <div className="mb-3">
          <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
            Category
          </label>
          <FancySelect
            value={CATEGORY_ORDER.includes(item.category) ? item.category : 'PRIMARY'}
            onChange={(v) => onChangeCategory(v as Category)}
            options={CATEGORY_ORDER.map((c) => ({
              value: c,
              label: ADD_CODE_CATEGORY_LABEL[c as AddCodeCategory],
            }))}
          />
        </div>
      )}
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

      {showReasonForm && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-3 space-y-3">
          {/* Dropdown row only renders for REJECT/EDIT — ADD has no
              dropdown reason list configured today. */}
          {!isAdded && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    st.decision === 'rejected' ? 'bg-danger' : 'bg-info',
                  )}
                />
                Reason {st.decision === 'rejected' ? '(reject)' : '(edit)'}
                {!readOnly && <span className="text-danger normal-case">*</span>}
              </label>
              {!readOnly && (
                <span className="text-[10px] text-ink-muted/70 font-mono">
                  {filteredReasons.length} option{filteredReasons.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {readOnly ? (
              <div className="text-sm text-ink px-3 py-2 rounded-lg border border-line bg-surface-sunken/40">
                {st.reasonDropdown || <span className="text-ink-muted">— No reason recorded —</span>}
              </div>
            ) : filteredReasons.length === 0 ? (
              <div className="text-xs px-3 py-2 rounded-lg border border-warn/30 bg-warn-soft/30 text-warn">
                No reasons configured for this code type. Ask a Team Lead to add some in
                Configurations → Review Reasons.
              </div>
            ) : (
              <FancySelect
                value={st.reasonDropdown}
                onChange={(v) => update({ reasonDropdown: v })}
                options={filteredReasons.map((r) => ({ value: r.text, label: r.text }))}
                placeholder="Select a reason…"
                className={cn(dropdownMissing && '[&>button]:border-danger/60')}
              />
            )}
            {!readOnly && dropdownMissing && filteredReasons.length > 0 && (
              <p className="mt-1 text-[11px] text-danger">Reason is required.</p>
            )}
          </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
              Notes {!readOnly && <span className="text-danger normal-case">*</span>}
            </label>
            {readOnly ? (
              <div className="text-sm text-ink px-3 py-2 rounded-lg border border-line bg-surface-sunken/40 whitespace-pre-wrap leading-relaxed">
                {st.rejectReason || <span className="text-ink-muted">— No notes recorded —</span>}
              </div>
            ) : (
              <>
                <Textarea
                  placeholder={`Describe the ${st.decision === 'rejected' ? 'rejection' : st.decision === 'edited' ? 'edit' : 'addition'} (min ${REASON_MIN_CHARS} characters)…`}
                  value={st.rejectReason}
                  onChange={(e) => update({ rejectReason: e.target.value })}
                  rows={3}
                  error={textShort ? `Minimum ${REASON_MIN_CHARS} characters.` : undefined}
                />
                <div className="flex items-center justify-between mt-1">
                  <div className="flex-1 h-1 bg-surface-sunken rounded-full overflow-hidden mr-3">
                    <div
                      className={cn(
                        'h-full transition-all',
                        textShort ? 'bg-danger/70' : 'bg-success',
                      )}
                      style={{ width: `${Math.min(100, (reasonChars / REASON_MIN_CHARS) * 100)}%` }}
                    />
                  </div>
                  <span className={cn(
                    'text-[11px] font-mono shrink-0',
                    textShort ? 'text-danger' : 'text-success',
                  )}>
                    {reasonChars} / {REASON_MIN_CHARS}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {readOnly ? (
        <ReadOnlyVerdictRow decision={st.decision} />
      ) : isAdded ? (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-violet-300/40 bg-violet-50/40 dark:bg-violet-500/10 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            <Plus className="w-3 h-3" />
            Added by you
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 px-3 h-7 rounded-md border border-line text-xs font-semibold text-ink-muted hover:bg-danger-soft/40 hover:text-danger hover:border-danger/30 transition"
          >
            <X className="w-3 h-3" /> Remove
          </button>
        </div>
      ) : (
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
      )}
    </div>
  );
}

function ReadOnlyVerdictRow({ decision }: { decision: Decision }) {
  const tone =
    decision === 'accepted'
      ? { label: 'Accepted by coder', cls: 'bg-success-soft/60 text-success border-success/30', icon: <Check className="w-3.5 h-3.5" /> }
      : decision === 'rejected'
        ? { label: 'Rejected by coder', cls: 'bg-danger-soft/60 text-danger border-danger/30', icon: <X className="w-3.5 h-3.5" /> }
        : decision === 'edited'
          ? { label: 'Edited by coder', cls: 'bg-info-soft/60 text-info border-info/30', icon: <Pencil className="w-3.5 h-3.5" /> }
          : { label: 'Pending — coder did not act on this code', cls: 'bg-surface-sunken text-ink-muted border-line', icon: null };
  return (
    <div className={cn(
      'mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill border text-xs font-semibold',
      tone.cls,
    )}>
      {tone.icon}
      {tone.label}
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

/* ── Add Code modal ──────────────────────────────────────── */

type AddCodeCategory = 'PRIMARY' | 'SECONDARY' | 'PROCEDURE';
const ADD_CODE_CATEGORY_LABEL: Record<AddCodeCategory, string> = {
  PRIMARY: 'Primary Diagnosis',
  SECONDARY: 'Secondary Diagnosis',
  PROCEDURE: 'CPT / Procedure',
};

/** Chars typed before the ICD-10-CM autocomplete starts suggesting. */
const ICD_SUGGEST_MIN_CHARS = 2;

/**
 * Code <Input> with an ICD-10-CM prefix-search dropdown. Once the user has
 * typed {@link ICD_SUGGEST_MIN_CHARS}+ characters, it queries the reference DB
 * (debounced) and shows matching codes; picking one fills the code AND its
 * description. Keyboard: ↑/↓ to move, Enter to pick, Esc to dismiss.
 *
 * `enabled` is false for CPT/Procedure rows — those codes don't live in the
 * ICD-10-CM reference DB, so suggesting from it would only ever be empty.
 */
function IcdCodeAutocomplete({
  value,
  onChange,
  onPick,
  onExactMatch,
  enabled,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onPick: (code: string, description: string) => void;
  /** Fired whenever the fully-typed value exactly matches a reference code —
   * even without opening the dropdown — so the form can auto-fill the
   * description. */
  onExactMatch?: (code: string, description: string) => void;
  enabled: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = value.trim();
  const canSuggest = enabled && trimmed.length >= ICD_SUGGEST_MIN_CHARS;

  // Debounce the typed value so we hit the API ~once per pause, not per keypress.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), 180);
    return () => clearTimeout(t);
  }, [trimmed]);

  const q = useQuery({
    queryKey: ['icd-code-search', debounced],
    queryFn: () => searchIcdCodes(debounced, 10),
    // Not gated on `open`: the lookup must also run when the dropdown is
    // closed so a fully-typed code can still auto-fill its description.
    enabled: enabled && debounced.length >= ICD_SUGGEST_MIN_CHARS,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev, // keep prior hits visible while the next loads
  });
  const hits: IcdCodeHit[] = q.data?.codes ?? [];
  const showDropdown = open && canSuggest;

  // Auto-fill the description when the typed value is an exact code (matched
  // with or without the decimal point). The exact code always sorts first in
  // the prefix results, so it's reliably present here.
  useEffect(() => {
    if (!onExactMatch || !enabled) return;
    const typed = trimmed.toUpperCase();
    if (typed.length < ICD_SUGGEST_MIN_CHARS) return;
    const typedDotless = typed.replace(/\./g, '');
    const exact = hits.find(
      (h) =>
        h.code.toUpperCase() === typed ||
        h.code.replace(/\./g, '').toUpperCase() === typedDotless,
    );
    if (exact) onExactMatch(exact.code, exact.description);
  }, [hits, trimmed, enabled, onExactMatch]);

  // Close when focus/click leaves the widget.
  useEffect(() => {
    if (!showDropdown) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showDropdown]);

  // Clamp the highlight whenever the result set changes.
  useEffect(() => {
    setHighlight((h) => (h >= hits.length ? hits.length - 1 : h));
  }, [hits.length]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const pick = (hit: IcdCodeHit) => {
    onPick(hit.code, hit.description);
    setOpen(false);
    setHighlight(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || hits.length === 0) {
      // Let Esc dismiss even if the list is mid-fetch.
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlight((h) => (h + 1) % hits.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight((h) => (h <= 0 ? hits.length - 1 : h - 1));
        break;
      case 'Enter':
        if (highlight >= 0 && highlight < hits.length) {
          e.preventDefault();
          pick(hits[highlight]);
        }
        break;
      case 'Escape':
        // Stop the modal's window-level Esc handler from closing the whole
        // modal — first Esc just closes the suggestions.
        e.stopPropagation();
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => {
          if (canSuggest) setOpen(true);
        }}
        onBlur={() => {
          // Delay so a mousedown on an option still registers before close.
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="font-mono"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        autoComplete="off"
      />

      {showDropdown && (
        <div className="absolute z-[70] left-0 right-0 mt-1 rounded-lg border border-line bg-surface shadow-2xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {q.isFetching && hits.length === 0 ? (
              <div className="px-3 py-3 text-xs text-ink-muted inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Searching ICD-10-CM…
              </div>
            ) : hits.length === 0 ? (
              <div className="px-3 py-3 text-xs text-ink-muted inline-flex items-center gap-2">
                <Search className="w-3.5 h-3.5" />
                No ICD-10-CM codes start with “{trimmed}”.
              </div>
            ) : (
              hits.map((hit, i) => (
                <button
                  type="button"
                  key={hit.code}
                  // onMouseDown (not onClick) so the pick lands before the
                  // input's onBlur close-timer fires.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(hit);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 flex items-center gap-2.5 transition',
                    i === highlight ? 'bg-info-soft/50' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="font-mono text-xs font-semibold text-ink shrink-0 w-16">
                    {hit.code}
                  </span>
                  <span className="text-xs text-ink-muted truncate flex-1 min-w-0">
                    {hit.description}
                  </span>
                  {hit.isBillable ? (
                    <span
                      className="shrink-0 text-[9px] uppercase tracking-wide font-semibold text-success bg-success-soft/50 border border-success/30 rounded px-1 py-0.5"
                      title="Billable / specific code"
                    >
                      Billable
                    </span>
                  ) : (
                    <span
                      className="shrink-0 text-[9px] uppercase tracking-wide font-semibold text-ink-subtle border border-line rounded px-1 py-0.5"
                      title="Header / non-billable — has more specific children"
                    >
                      Header
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddCodeModal({
  onClose,
  onAdd,
  existingCodes,
}: {
  onClose: () => void;
  onAdd: (item: CodeItem, reason: string) => void;
  /** Normalized codes already on the board (any category). Adding a duplicate
   * is blocked — the coder moves the existing code's category instead. */
  existingCodes: Set<string>;
}) {
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<AddCodeCategory>('PRIMARY');
  const [reason, setReason] = useState('');

  // Tracks whether the description currently shown was machine-filled (from a
  // picked suggestion or an exact-code match) rather than typed by the coder.
  // Once the coder edits it by hand, auto-fill backs off so it never clobbers
  // their wording. descRef mirrors the latest value for the stable callback.
  const descAutoFilledRef = useRef(true);
  const descRef = useRef(description);
  useEffect(() => {
    descRef.current = description;
  }, [description]);

  // Stable identity (empty deps) so the autocomplete's exact-match effect
  // isn't re-subscribed every render. Signature matches onExactMatch.
  const applyAutoDescription = useCallback((_code: string, desc: string) => {
    if (!desc) return;
    if (descRef.current.trim() === '' || descAutoFilledRef.current) {
      setDescription(desc);
      descAutoFilledRef.current = true;
    }
  }, []);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmedCode = code.trim();
  const trimmedDesc = description.trim();
  const trimmedReason = reason.trim();
  const codeMissing = trimmedCode.length === 0;
  const descMissing = trimmedDesc.length === 0;
  const reasonShort = trimmedReason.length < REASON_MIN_CHARS;
  // Duplicate guard: a code already on the board (in ANY category) can't be
  // added again. Dot- and case-insensitive, so K64.9 and K649 are the same.
  const isDuplicate = !codeMissing && existingCodes.has(normalizeCode(trimmedCode));
  const canSubmit = !codeMissing && !descMissing && !reasonShort && !isDuplicate;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const item: CodeItem = {
      key: `ADDED-${category}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${trimmedCode}`,
      category,
      code: trimmedCode,
      description: trimmedDesc,
    };
    onAdd(item, trimmedReason);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-stretch p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="m-auto bg-surface rounded-xl shadow-2xl w-[min(560px,96vw)] max-h-[90vh] flex flex-col overflow-hidden border border-line"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-line bg-surface-sunken/40">
          <div>
            <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-violet-500" />
              Add a code
            </h3>
            <p className="text-[11px] text-ink-muted mt-0.5">
              Add a code the AI didn't suggest. It'll be sent to the golden dataset
              as an ADD action so the AI can learn from it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-md hover:bg-surface-2 flex items-center justify-center text-ink-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
                Category <span className="text-danger normal-case">*</span>
              </label>
              <FancySelect
                value={category}
                onChange={(v) => setCategory(v as AddCodeCategory)}
                options={(['PRIMARY', 'SECONDARY', 'PROCEDURE'] as AddCodeCategory[]).map((c) => ({
                  value: c,
                  label: ADD_CODE_CATEGORY_LABEL[c],
                }))}
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
                Code <span className="text-danger normal-case">*</span>
              </label>
              <IcdCodeAutocomplete
                value={code}
                onChange={setCode}
                onPick={(picked, desc) => {
                  setCode(picked);
                  // Auto-fill the description from the reference data; the
                  // coder can still edit it before adding.
                  setDescription(desc);
                  descAutoFilledRef.current = true;
                }}
                // Auto-fill the description as soon as a full, valid code is
                // typed — not only when picked from the dropdown.
                onExactMatch={applyAutoDescription}
                // CPT/Procedure codes aren't in the ICD-10-CM reference DB.
                enabled={category !== 'PROCEDURE'}
                placeholder={category === 'PROCEDURE' ? 'e.g. 99213' : 'e.g. E11.9'}
                autoFocus
              />
              {isDuplicate ? (
                <p className="mt-1 text-[11px] text-danger">
                  <strong className="font-semibold font-mono">{trimmedCode}</strong> is
                  already on the board — duplicate codes aren't allowed (K64.9 and K649
                  count as the same). To move it, open that code and change its category.
                </p>
              ) : (
                category !== 'PROCEDURE' && (
                  <p className="mt-1 text-[10px] text-ink-subtle">
                    Type {ICD_SUGGEST_MIN_CHARS}+ characters to search ICD-10-CM codes — the
                    description fills in automatically.
                  </p>
                )
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
              Description <span className="text-danger normal-case">*</span>
            </label>
            <Input
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                // The coder is writing their own wording — stop auto-filling.
                descAutoFilledRef.current = false;
              }}
              placeholder="Type 2 diabetes mellitus without complications"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
              Why are you adding this? <span className="text-danger normal-case">*</span>
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Explain why this code is supported by the documentation (min ${REASON_MIN_CHARS} characters)…`}
              rows={3}
              error={reasonShort && trimmedReason.length > 0 ? `Minimum ${REASON_MIN_CHARS} characters.` : undefined}
            />
            <div className="flex items-center justify-between mt-1">
              <div className="flex-1 h-1 bg-surface-sunken rounded-full overflow-hidden mr-3">
                <div
                  className={cn(
                    'h-full transition-all',
                    reasonShort ? 'bg-danger/70' : 'bg-success',
                  )}
                  style={{ width: `${Math.min(100, (trimmedReason.length / REASON_MIN_CHARS) * 100)}%` }}
                />
              </div>
              <span className={cn(
                'text-[11px] font-mono shrink-0',
                reasonShort ? 'text-danger' : 'text-success',
              )}>
                {trimmedReason.length} / {REASON_MIN_CHARS}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-violet-300/40 bg-violet-50/40 dark:bg-violet-500/10 px-3 py-2 text-[11px] text-violet-700 dark:text-violet-300">
            This code will appear in the {ADD_CODE_CATEGORY_LABEL[category]} section as a
            user-added item (purple chip). On Submit it ships as an{' '}
            <strong className="font-semibold">ADD</strong> action — no orchestrator
            <code className="font-mono mx-0.5">predicted_code_id</code> needed.
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line bg-surface-sunken/40">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-pill border border-line text-sm font-semibold text-ink hover:bg-surface-2 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 h-9 px-5 rounded-pill bg-violet-500 text-white text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            Add code
          </button>
        </footer>
      </div>
    </div>
  );
}

