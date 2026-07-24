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
  ThumbsDown,
  ThumbsUp,
  Undo2,
  X,
} from 'lucide-react';
import { IS_PRODUCTION_DEPLOYMENT, DEPLOYMENT } from '@/config/deployment';
import {
  getActiveTimer,
  getCodeDecisionDraft,
  listCodeAudits,
  listCodeDecisions,
  saveCodeDecisionDraft,
  submitCodeAudits,
  submitCodeDecisions,
  type CodeAuditDraftEntry,
  type CodeAuditInput,
  type CodeAuditRecord,
  type CodeDecisionDraftEntry,
  type CodeDecisionDraftPayload,
  type CodeDecisionInput,
  type CodeDecisionType,
  type CodeDecisionVerdict,
  type CodeDraftCategory,
} from '@/api/charts';
import { useAuth } from '@/auth/store';
import {
  getCodeReviewReasons,
  getFeedbackCategories,
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
  /** Whether the parent's shared predicted-codes query has settled (or wasn't
   * needed). The modal builds its board from the `prediction` prop now — the
   * SAME unified source the sidebar uses — so it gates draft restore/autosave
   * on this to avoid stamping decisions onto a board that's about to swap from
   * snapshot codes to live ones. Defaults to true so the modal still works if
   * rendered without the parent hook. */
  aiCodesSettled?: boolean;
  docs?: UploadedDocument[];
  chartId: string;
  clientId?: number;
  locationId?: number;
  onSubmitted?: () => void;
  /** QA / Team Lead viewer. Loads previously-submitted decisions, hydrates
   * the on-screen state from them, and locks every control — no submit, no
   * decision buttons, no edits. */
  readOnly?: boolean;
  /** QA Live: when set (read-only only), the board hydrates from THIS coder's
   * in-progress draft so QA can watch their unsubmitted accept/reject/edit
   * work. Without it, read-only shows only previously-submitted decisions. */
  liveDraftUserId?: number;
  /** Auditor mode: the chart has already been coded, so the coder's decisions
   * are shown locked (like read-only) and the auditor layers an Agree/Disagree
   * judgment + feedback on each one. Distinct from `readOnly` — audit mode is
   * editable (of the audit layer) and submits audits, not code decisions. */
  audit?: boolean;
}

type Decision = 'pending' | 'accepted' | 'rejected' | 'edited' | 'added' | 'moved';
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
  /** Set only while `category` has been changed via the dropdown — the
   * category this item started in (AI-predicted or originally added under).
   * Lets buildPayload know what to reject the code out of. */
  originalCategory?: Category;
}

interface CodeState {
  decision: Decision;
  editedCode: string;
  editedDescription: string;
  /** Free-text reason; required (≥20 chars) on Reject/Edit, and on the
   * "remove from old category" half of a Recategorize (decision='moved'). */
  rejectReason: string;
  /** Dropdown reason; required on Reject/Edit, and on the "remove from old
   * category" half of a Recategorize. Picked from Settings. */
  reasonDropdown: string;
  /** Free-text reason for the "add to new category" half of a Recategorize
   * (decision='moved'); required (≥20 chars). Unused otherwise. */
  moveReasonText: string;
}

/** Auditor's per-code judgment of a coder decision (audit mode only). */
type AuditVerdict = 'pending' | 'agree' | 'disagree';
interface AuditState {
  verdict: AuditVerdict;
  /** Feedback category; required on Disagree. Picked from the code's audit area. */
  feedbackCategory: string;
  /** Free-text note; required (≥20 chars) on Disagree. */
  feedbackText: string;
}
const AUDIT_FEEDBACK_MIN_CHARS = 20;

/** Maps a board Category onto the configured feedback audit-area name so the
 * Disagree dropdown shows that area's reasons (matches the default built-in
 * audit-area labels). */
const CATEGORY_TO_AUDIT_AREA: Record<Category, string> = {
  'ADMIT CODE': 'Primary Diagnosis',
  PRIMARY: 'Primary Diagnosis',
  SECONDARY: 'Secondary Diagnosis',
  PROCEDURE: 'Procedures',
};

/** Maps a persisted audit verdict onto the modal's local AuditVerdict. */
function auditVerdictToLocal(v: 'AGREE' | 'DISAGREE'): AuditVerdict {
  return v === 'AGREE' ? 'agree' : 'disagree';
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
  { d: 'moved', label: 'Recategorizing', cls: 'bg-warn' },
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
    // Carried through from the unified source so submit can forward it. Present
    // on live gateway codes; undefined on the snapshot fallback (gateway down),
    // where submit is already impossible.
    predictedCodeId: c.predictedCodeId,
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
  aiCodesSettled = true,
  docs = [],
  chartId,
  clientId,
  locationId,
  onSubmitted,
  readOnly = false,
  liveDraftUserId,
  audit = false,
}: Props) {
  // QA watching a coder's live draft (read-only). Drives the draft fetch +
  // hydration that's otherwise skipped in read-only mode.
  const watchingLiveDraft = readOnly && liveDraftUserId != null;
  // The coder's decision controls (Accept/Reject/Edit, Add Code, edits) are
  // locked both for QA read-only AND for an auditor — the auditor reviews the
  // coder's work, they don't re-code it. Audit mode then layers its own
  // editable Agree/Disagree controls on top (see `audit`).
  const coderControlsLocked = readOnly || audit;
  // Codes come straight from the `prediction` prop — the parent feeds us the
  // SAME unified source the sidebar's AI ICD card uses (live gateway codes
  // preferred, each carrying `predictedCodeId` for the submit forward; the
  // persisted snapshot as fallback when the gateway is down). Deriving both
  // surfaces from one query is what keeps them from ever diverging.
  // See docs/AI_CODES_SINGLE_SOURCE_FIX.md.
  const aiItems = useMemo(() => buildItems(prediction), [prediction]);
  const [state, setState] = useState<Record<string, CodeState>>({});
  // Auditor's per-code verdicts (audit mode only), keyed by item.key. Parallel
  // to `state` — `state` holds the coder's (locked) decision, this holds the
  // auditor's judgment of it.
  const [auditState, setAuditState] = useState<Record<string, AuditState>>({});
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Two-level left pane: top picks Documents vs AI Summary, sub picks
  // which uploaded document is in view.
  const [topTab, setTopTab] = useState<TopTab>('documents');
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
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
        return moved && moved !== it.category
          ? { ...it, category: moved, originalCategory: it.category }
          : it;
      }),
    [aiItems, addedItems, categoryOverrides],
  );

  // Reset transient UI + clear added codes whenever the modal opens. Stays
  // in [open] only — we don't want to wipe user decisions if the items
  // array changes mid-session (which now happens when the user adds a code).
  useEffect(() => {
    if (!open) return;
    setSelectedIdx(0);
    setSubmitError(null);
    setConfirmOpen(false);
    setAddedItems([]);
    setCategoryOverrides({});
    setAuditState({});
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
          moveReasonText: '',
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

  // Audit mode only — configured feedback categories (per client/location),
  // used to populate the Disagree dropdown. Scoped per code category to the
  // matching audit area, mirroring AuditInfoSection.
  const feedbackAreasQ = useQuery({
    queryKey: ['feedback-categories', clientId, locationId],
    queryFn: () => getFeedbackCategories({ clientId: clientId!, locationId: locationId! }),
    enabled: open && audit && !!clientId && !!locationId,
  });
  const auditFeedbackOptionsFor = useCallback(
    (category: Category): string[] => {
      const areas = feedbackAreasQ.data?.areas ?? [];
      const norm = (s: string) => s.trim().toLowerCase();
      const match = areas.find((a) => norm(a.name) === norm(CATEGORY_TO_AUDIT_AREA[category]));
      if (match) return match.reasons.map((r) => r.name).filter(Boolean);
      // Fallback: no area name matched the category — offer every reason so the
      // auditor is never blocked by a config-naming mismatch.
      return areas.flatMap((a) => a.reasons.map((r) => r.name)).filter(Boolean);
    },
    [feedbackAreasQ.data],
  );

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

    // Attach each previously-submitted decision to an AI item. The persisted
    // decisions are the source of truth for a code's category, so the board must
    // reconstruct category MOVES from them — not just verdicts. A code the coder
    // moved to another category was saved under its NEW codeType, so a match on
    // the AI item's ORIGINAL category would miss it and the move would be lost on
    // reopen (the draft that used to carry it is deleted on submit). So: match
    // exact (category, code) FIRST — a code that stayed put, INCLUDING a code the
    // AI placed in two categories (two distinct decisions that must stay
    // separate) — then re-attach any leftover decision to the same code under a
    // different category as an in-place move, recording the override. Mirrors the
    // draft-restore move logic below so submitted and drafted decisions resolve a
    // code's category identically.
    const byIdentity = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (r.decision === 'ADDED') continue;
      const cat = codeTypeToCategory(r.codeType);
      if (cat) byIdentity.set(`${cat}|${r.codeValue}`, r);
    }
    const aiKeys = new Set(aiItems.map((it) => `${it.category}|${it.code}`));
    const decisionByKey = new Map<string, (typeof rows)[number]>();
    const moveOverrides: Record<string, Category> = {};
    const claimed = new Set<string>();
    // Pass 1 — exact (category, code).
    for (const it of aiItems) {
      const r = byIdentity.get(`${it.category}|${it.code}`);
      if (r && !claimed.has(it.key)) {
        decisionByKey.set(it.key, r);
        claimed.add(it.key);
      }
    }
    // Pass 2 — leftover decisions whose (category, code) is no AI item: an
    // in-place move of the same code from a different category.
    for (const [key, r] of byIdentity) {
      if (aiKeys.has(key)) continue;
      const cat = codeTypeToCategory(r.codeType);
      if (!cat) continue;
      const target = aiItems.find(
        (it) => normalizeCode(it.code) === normalizeCode(r.codeValue) && !claimed.has(it.key),
      );
      if (!target) continue;
      claimed.add(target.key);
      decisionByKey.set(target.key, r);
      moveOverrides[target.key] = cat;
    }

    setState((prev) => {
      const next = { ...prev };
      // AI-predicted items: stamp the verdict from the decision attached above.
      for (const it of aiItems) {
        const match = decisionByKey.get(it.key);
        if (!match) continue;
        next[it.key] = {
          decision: verdictToDecision(match.decision),
          editedCode: match.editedCode ?? it.code,
          editedDescription: match.editedDescription ?? it.description,
          rejectReason: match.reasonText ?? '',
          reasonDropdown: match.reasonDropdown ?? '',
          moveReasonText: '',
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
          moveReasonText: '',
        };
      }
      return next;
    });
    // Re-apply category moves reconstructed above. Merged (not replaced) so a
    // move the user makes between this hydration and the commit isn't clobbered.
    if (Object.keys(moveOverrides).length > 0) {
      setCategoryOverrides((prev) => ({ ...prev, ...moveOverrides }));
    }
    setAddedItems((prev) => (prev.length > 0 ? prev : seededAdds));
  }, [open, decisionsQ.data, aiItems]);

  /* ── Audit layer ───────────────────────────────────────────────────────
   * The auditor's Agree/Disagree judgments are kept in `auditState`, parallel
   * to the coder's (locked) `state`. Seeded from previously-submitted audits,
   * then overlaid by the auditor's own in-progress draft (see draft restore).
   * Fetched in EVERY mode (not just audit): outside audit mode the submitted
   * audits render read-only, so the coder sees the auditor's feedback. */
  const auditsQ = useQuery({
    queryKey: ['chart-code-audits', chartId],
    queryFn: () => listCodeAudits(chartId),
    enabled: open && !!chartId,
  });
  // Seed auditState from previously-submitted audits. Matched to board items by
  // (codeType, code) — the AI/board code, the SAME key chart_code_decisions uses
  // (and that submit/draft use here), so no dependence on coder `state`. Only
  // fills items still 'pending' so it never clobbers the auditor's drafted
  // verdicts (overlaid by the draft restore below) or in-session edits, even if
  // it re-runs as the board settles.
  useEffect(() => {
    if (!open || !audit) return;
    const rows = auditsQ.data?.items;
    if (!rows?.length) return;
    const byKey = new Map(rows.map((r) => [`${r.codeType}|${normalizeCode(r.codeValue)}`, r]));
    setAuditState((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const codeType = categoryToCodeType(it.category);
        if (!codeType) continue;
        const cur = next[it.key];
        if (cur && cur.verdict !== 'pending') continue;
        const r = byKey.get(`${codeType}|${normalizeCode(it.code)}`);
        if (!r) continue;
        next[it.key] = {
          verdict: auditVerdictToLocal(r.verdict),
          feedbackCategory: r.feedbackCategory ?? '',
          feedbackText: r.feedbackText ?? '',
        };
      }
      return next;
    });
  }, [open, audit, auditsQ.data, items]);

  // Seed any board item that has no audit yet with a 'pending' default, and
  // drop entries for items that no longer exist. Keeps auditState in lockstep
  // with the board the same way the coder state-merge effect does.
  useEffect(() => {
    if (!open || !audit) return;
    setAuditState((prev) => {
      const next: Record<string, AuditState> = {};
      for (const it of items) {
        next[it.key] = prev[it.key] ?? { verdict: 'pending', feedbackCategory: '', feedbackText: '' };
      }
      return next;
    });
  }, [open, audit, items]);

  // Submitted audits keyed by board-item key. Used OUTSIDE audit mode to show
  // the auditor's verdict + feedback to the coder/QA viewer (read-only).
  // Matched by (codeType, code) — the same identity the audit rows are stored
  // under — mirroring the auditState seeding above.
  const submittedAuditByKey = useMemo(() => {
    const map = new Map<string, CodeAuditRecord>();
    const rows = auditsQ.data?.items;
    if (!rows?.length) return map;
    const byKey = new Map(rows.map((r) => [`${r.codeType}|${normalizeCode(r.codeValue)}`, r]));
    for (const it of items) {
      const codeType = categoryToCodeType(it.category);
      if (!codeType) continue;
      const r = byKey.get(`${codeType}|${normalizeCode(it.code)}`);
      if (r) map.set(it.key, r);
    }
    return map;
  }, [auditsQ.data, items]);

  /* ── Draft persistence ─────────────────────────────────────────────────
   * The board's in-progress state autosaves to the server (per chart, per
   * user) so a refresh / crash / device switch doesn't lose unsubmitted
   * work. Entries are identified by (category, code) — the same identity
   * the board dedupes on — NOT by the index-based React keys, so a draft
   * re-attaches correctly even if the predictions come back reordered.
   * Read-only (QA) mode never reads or writes drafts. */

  const qc = useQueryClient();

  const draftQ = useQuery({
    queryKey: ['chart-code-decision-draft', chartId, liveDraftUserId ?? 'self'],
    queryFn: () => getCodeDecisionDraft(chartId, liveDraftUserId),
    // Editable mode loads the caller's own draft; read-only normally skips it,
    // except in QA Live where we fetch the watched coder's draft instead.
    enabled: open && !!chartId && (!readOnly || watchingLiveDraft),
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

  // All sources settled — the board is in its final shape, so restoring/saving
  // against it is safe. The predicted-codes query is now owned by the parent
  // hook (deduped, shared with the sidebar); `aiCodesSettled` reports when it
  // has resolved so we don't restore a draft onto snapshot codes that are about
  // to be replaced by live ones.
  const boardReady =
    open &&
    aiCodesSettled &&
    (decisionsQ.isSuccess || decisionsQ.isError) &&
    (!audit || auditsQ.isSuccess || auditsQ.isError) &&
    (readOnly || draftQ.isSuccess || draftQ.isError);

  /** Serializes the board's reviewable working state. ADMIT CODE rows (UI
   * mirror of PRIMARY) and untouched 'pending' rows are dropped — a restore
   * only stamps what the user actually decided. In audit mode the coder's
   * decisions/addedItems are already persisted (and read-only here), so the
   * auditor's draft carries only the audit layer. */
  const buildDraftPayload = useCallback((): CodeDecisionDraftPayload => {
    if (audit) {
      const audits: CodeAuditDraftEntry[] = [];
      for (const it of items) {
        if (!categoryToCodeType(it.category)) continue;
        const a = auditState[it.key];
        if (!a || a.verdict === 'pending') continue;
        audits.push({
          category: it.category as CodeDraftCategory,
          // Keyed by the board/AI code (NOT the coder's edited value) so the
          // draft re-attaches in restore without depending on coder `state`.
          code: it.code,
          verdict: a.verdict,
          feedbackCategory: a.feedbackCategory,
          feedbackText: a.feedbackText,
        });
      }
      return { version: 1, decisions: [], addedItems: [], audits };
    }
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
        moveReasonText: st.moveReasonText,
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
  }, [audit, items, state, auditState, addedItems, categoryOverrides]);

  // Restore: stamp the draft over whatever the submitted-decisions hydration
  // seeded (the draft is newer working state, so it wins — codes absent from
  // the draft keep their hydrated/submitted verdicts). Runs once per change
  // of its actual inputs; react-query's structural sharing keeps the data
  // references stable across no-op refetches, and user edits never re-trigger
  // it. Declared AFTER the decisions hydration effect on purpose: same-commit
  // runs execute in order, so the draft lands on top.
  useEffect(() => {
    // Normally skipped in read-only — but QA Live deliberately hydrates the
    // board from the watched coder's draft (still no autosave: that effect
    // guards on readOnly).
    if (!open || (readOnly && !watchingLiveDraft) || !boardReady || draftQ.isError) return;
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
          moveReasonText: d.moveReasonText ?? '',
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

    // Audit mode: overlay the auditor's drafted verdicts on top of whatever the
    // submitted-audit seeding stamped (draft is newer working state, so it wins).
    // Audit entries are keyed by (category, coder's final code) — the same
    // identity the autosave wrote — so they re-attach across a refresh.
    if (audit && Array.isArray(payload.audits) && payload.audits.length > 0) {
      const auditByKey = new Map(
        payload.audits.map((a) => [`${a.category}|${normalizeCode(a.code)}`, a]),
      );
      setAuditState((prevAudit) => {
        const next = { ...prevAudit };
        for (const it of boardItems) {
          if (!categoryToCodeType(it.category)) continue;
          const a = auditByKey.get(`${it.category}|${normalizeCode(it.code)}`);
          if (!a) continue;
          next[it.key] = {
            verdict: a.verdict,
            feedbackCategory: a.feedbackCategory,
            feedbackText: a.feedbackText,
          };
        }
        return next;
      });
    }
  }, [open, audit, readOnly, watchingLiveDraft, boardReady, draftQ.data, draftQ.isError, decisionsQ.data, aiItems]);

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
    const isEmpty =
      payload.decisions.length === 0 &&
      payload.addedItems.length === 0 &&
      (payload.audits?.length ?? 0) === 0;
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
  const submitAuditMut = useMutation({
    mutationFn: (audits: CodeAuditInput[]) => submitCodeAudits(chartId, audits),
  });

  if (!open) return null;

  const reviewedCount = items.filter((it) => state[it.key]?.decision !== 'pending').length;
  // Audit mode progress: how many auditable codes have a verdict.
  const auditedCount = items.filter(
    (it) => categoryToCodeType(it.category) && auditState[it.key] && auditState[it.key].verdict !== 'pending',
  ).length;
  const selected = items[selectedIdx];
  const selectedSt = selected ? state[selected.key] : undefined;
  const selectedAuditSt = selected ? auditState[selected.key] : undefined;

  const update = (key: string, patch: Partial<CodeState>) =>
    setState((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  const updateAudit = (key: string, patch: Partial<AuditState>) =>
    setAuditState((p) => ({
      ...p,
      [key]: { ...(p[key] ?? { verdict: 'pending', feedbackCategory: '', feedbackText: '' }), ...patch },
    }));

  // After a code is decided, jump to the next one that still needs review so
  // the coder is walked straight through the worklist. Wraps around to catch
  // earlier skipped codes; if every code is reviewed, steps forward (or stays
  // on the last). Drives the SelectedCard's "Save & Next".
  const goToNextAfterSave = () => {
    const n = items.length;
    if (n === 0) return;
    for (let off = 1; off <= n; off++) {
      const i = (selectedIdx + off) % n;
      if (i === selectedIdx) continue;
      if ((state[items[i].key]?.decision ?? 'pending') === 'pending') {
        setSelectedIdx(i);
        return;
      }
    }
    setSelectedIdx(Math.min(selectedIdx + 1, n - 1));
  };

  // The single save-point of the guided per-code flow: commit the chosen
  // decision (plus any reason / edited values) and advance.
  const saveDecisionAndAdvance = (patch: Partial<CodeState> & { decision: Decision }) => {
    if (!selected) return;
    update(selected.key, patch);
    goToNextAfterSave();
  };

  // Move a code to a different category. This is no longer a silent in-place
  // move: the code is rejected out of its original category and re-added
  // fresh under the new one, so the audit trail shows both halves instead of
  // one row quietly disappearing and another appearing. The item's decision
  // flips to 'moved' and the card switches to RecategorizeCard, which
  // collects a reject reason (for AI-suggested codes — coder-added codes have
  // no predictedCodeId to reject, so only the add-side reason is required)
  // and an add reason before the item counts as reviewed. Moving back to the
  // code's original category cancels the recategorize and resets to pending.
  const setItemCategory = (key: string, category: Category) => {
    const base = [...aiItems, ...addedItems].find((it) => it.key === key);
    const original = base?.category;
    setCategoryOverrides((prev) => {
      if (category === original) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: category };
    });
    setState((prev) => {
      const st = prev[key];
      if (!st) return prev;
      if (category === original) {
        return {
          ...prev,
          [key]: { ...st, decision: 'pending', reasonDropdown: '', rejectReason: '', moveReasonText: '' },
        };
      }
      return {
        ...prev,
        [key]: { ...st, decision: 'moved', reasonDropdown: '', rejectReason: '', moveReasonText: '' },
      };
    });
  };

  // Build the API payload, dropping ADMIT CODE rows (UI mirror of the
  // first PRIMARY) and rows still pending. A 'moved' item emits up to two
  // entries: REJECTED in its original category (only when it has a
  // predictedCodeId — an AI suggestion to reject) and ADDED in its new one.
  const buildPayload = (): CodeDecisionInput[] => {
    const out: CodeDecisionInput[] = [];
    for (const it of items) {
      const st = state[it.key];
      if (!st || st.decision === 'pending') continue;

      if (st.decision === 'moved') {
        const toType = categoryToCodeType(it.category);
        if (!toType) continue;
        const fromCategory = it.originalCategory ?? it.category;
        const fromType = categoryToCodeType(fromCategory);
        if (fromType && it.predictedCodeId) {
          out.push({
            codeType: fromType,
            codeValue: it.code,
            predictedCodeId: it.predictedCodeId,
            originalDescription: it.description,
            decision: 'REJECTED',
            reasonDropdown: st.reasonDropdown.trim(),
            reasonText: st.rejectReason.trim(),
          });
        }
        out.push({
          codeType: toType,
          codeValue: it.code,
          originalDescription: it.description,
          decision: 'ADDED',
          editedCode: st.editedCode,
          editedDescription: st.editedDescription,
          reasonText: st.moveReasonText.trim(),
        });
        continue;
      }

      const codeType = categoryToCodeType(it.category);
      if (!codeType) continue;
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
      if (!categoryToCodeType(it.category)) return null;
      if (st.decision === 'moved') {
        const needsRejectReason = !!it.predictedCodeId;
        const dropdownOk = needsRejectReason ? st.reasonDropdown.trim().length > 0 : true;
        const rejectTextOk = needsRejectReason ? st.rejectReason.trim().length >= REASON_MIN_CHARS : true;
        const addTextOk = st.moveReasonText.trim().length >= REASON_MIN_CHARS;
        return dropdownOk && rejectTextOk && addTextOk ? null : it.code;
      }
      const isReject = st.decision === 'rejected';
      const isEdit = st.decision === 'edited';
      const isAdd = st.decision === 'added';
      if (!isReject && !isEdit && !isAdd) return null;
      const dropdownOk = (isReject || isEdit) ? st.reasonDropdown.trim().length > 0 : true;
      const textOk = st.rejectReason.trim().length >= REASON_MIN_CHARS;
      if (dropdownOk && textOk) return null;
      return it.code;
    })
    .filter((v): v is string => v !== null);

  // Every reviewable code must be touched before submit — a code still on
  // 'pending' is one the coder hasn't looked at. ADMIT-mirror rows (no
  // codeType) aren't submittable, so they don't count.
  const unreviewedCodes = items
    .filter((it) => categoryToCodeType(it.category))
    .filter((it) => (state[it.key]?.decision ?? 'pending') === 'pending')
    .map((it) => state[it.key]?.editedCode || it.code);

  const payloadCount = buildPayload().length;
  const submitDisabled =
    submitMut.isPending ||
    payloadCount === 0 ||
    unreviewedCodes.length > 0 ||
    invalidReasons.length > 0 ||
    !clientId ||
    !locationId;

  // Header button no longer submits — it opens the confirmation dialog,
  // which renders the summary and only then fires the API on user
  // confirmation.
  const openConfirm = () => {
    setSubmitError(null);
    // Don't open the summary while anything is still incomplete — the button is
    // already disabled in these cases, but guard here too for keyboard paths.
    if (buildPayload().length === 0 || unreviewedCodes.length > 0 || invalidReasons.length > 0) return;
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

  /* ── Audit submit (audit mode) ─────────────────────────────────────────── */

  // Every code the coder acted on is auditable — the auditor must Agree or
  // Disagree on each. (Codes the coder never touched have no decision to judge.)
  const auditableItems = items.filter(
    (it) => categoryToCodeType(it.category) && (state[it.key]?.decision ?? 'pending') !== 'pending',
  );
  const unauditedCodes = auditableItems
    .filter((it) => (auditState[it.key]?.verdict ?? 'pending') === 'pending')
    .map((it) => state[it.key]?.editedCode || it.code);
  // Disagree requires a feedback category + a ≥20-char note.
  const invalidAuditFeedback = auditableItems
    .map((it) => {
      const a = auditState[it.key];
      if (!a || a.verdict !== 'disagree') return null;
      const catOk = a.feedbackCategory.trim().length > 0;
      const textOk = a.feedbackText.trim().length >= AUDIT_FEEDBACK_MIN_CHARS;
      return catOk && textOk ? null : state[it.key]?.editedCode || it.code;
    })
    .filter((v): v is string => v !== null);

  const buildAuditPayload = (): CodeAuditInput[] => {
    const out: CodeAuditInput[] = [];
    for (const it of items) {
      const codeType = categoryToCodeType(it.category);
      if (!codeType) continue;
      if ((state[it.key]?.decision ?? 'pending') === 'pending') continue;
      const a = auditState[it.key];
      if (!a || a.verdict === 'pending') continue;
      const verdict = a.verdict === 'agree' ? 'AGREE' : 'DISAGREE';
      out.push({
        codeType,
        // Keyed by the AI/board code, exactly like chart_code_decisions.codeValue
        // (original code; the coder's edited value lives in editedCode there).
        // This aligns each audit with the coder decision it judges.
        codeValue: it.code,
        verdict,
        feedbackCategory: verdict === 'DISAGREE' ? a.feedbackCategory.trim() : undefined,
        feedbackText: verdict === 'DISAGREE' ? a.feedbackText.trim() : undefined,
      });
    }
    return out;
  };

  const auditSubmitDisabled =
    submitAuditMut.isPending ||
    auditableItems.length === 0 ||
    unauditedCodes.length > 0 ||
    invalidAuditFeedback.length > 0;

  const openAuditConfirm = () => {
    setSubmitError(null);
    if (auditableItems.length === 0 || unauditedCodes.length > 0 || invalidAuditFeedback.length > 0) return;
    setConfirmOpen(true);
  };

  const onConfirmAuditSubmit = async () => {
    setSubmitError(null);
    const payload = buildAuditPayload();
    if (payload.length === 0) {
      setConfirmOpen(false);
      return;
    }
    submitInFlightRef.current = true;
    try {
      await submitAuditMut.mutateAsync(payload);
      // The submit superseded (and server-side deleted) the auditor's draft.
      pendingDraftRef.current = null;
      lastSavedDraftRef.current = null;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['chart-code-audits', chartId] }),
        qc.invalidateQueries({ queryKey: ['chart-code-decision-draft', chartId] }),
      ]);
      onSubmitted?.();
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      submitInFlightRef.current = false;
      const msg =
        (err as any)?.response?.data?.error?.message ??
        (err as any)?.message ??
        'Failed to submit audit.';
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
              {audit ? 'Audit · Review Coder Decisions' : readOnly ? "Coder's Decisions · Read-only" : 'Review & Edit'}
            </span>
            {readOnly ? (
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-info/15 border border-info/30 text-info text-xs font-mono">
                View Only
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
            {/* ── Audit-mode warnings + submit ── */}
            {audit && unauditedCodes.length > 0 && (
              <span
                className="hidden md:inline text-[11px] text-warn"
                title={`Audit every code first — not yet judged: ${unauditedCodes.join(', ')}`}
              >
                {unauditedCodes.length} code(s) not audited yet
              </span>
            )}
            {audit && unauditedCodes.length === 0 && invalidAuditFeedback.length > 0 && (
              <span
                className="hidden md:inline text-[11px] text-warn"
                title={`Missing feedback on: ${invalidAuditFeedback.join(', ')}`}
              >
                {invalidAuditFeedback.length} disagree(s) need a category &amp; note ({AUDIT_FEEDBACK_MIN_CHARS}+ chars)
              </span>
            )}
            {audit && (
              <button
                type="button"
                onClick={openAuditConfirm}
                disabled={auditSubmitDisabled}
                title={
                  auditableItems.length === 0
                    ? 'No coder decisions to audit on this chart'
                    : unauditedCodes.length > 0
                      ? `Agree or Disagree on every code first — pending: ${unauditedCodes.join(', ')}`
                      : invalidAuditFeedback.length > 0
                        ? 'Provide a feedback category and note (≥20 chars) for every Disagree'
                        : 'Open audit summary'
                }
                className="inline-flex items-center gap-2 h-9 px-4 rounded-pill bg-success text-white text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-3.5 h-3.5" />
                {submitAuditMut.isPending ? 'Submitting…' : 'Review & Submit Audit'}
              </button>
            )}

            {/* ── Coder-mode warnings + submit ── */}
            {!readOnly && !audit && unreviewedCodes.length > 0 && (
              <span
                className="hidden md:inline text-[11px] text-warn"
                title={`Review every code first — still pending: ${unreviewedCodes.join(', ')}`}
              >
                {unreviewedCodes.length} code(s) not reviewed yet
              </span>
            )}
            {!readOnly && !audit && unreviewedCodes.length === 0 && invalidReasons.length > 0 && (
              <span
                className="hidden md:inline text-[11px] text-warn"
                title={`Missing reason on: ${invalidReasons.join(', ')}`}
              >
                {invalidReasons.length} code(s) need a reason ({REASON_MIN_CHARS}+ chars &amp; dropdown)
              </span>
            )}
            {!readOnly && !audit && (
              <button
                type="button"
                onClick={openConfirm}
                disabled={submitDisabled}
                title={
                  !clientId || !locationId
                    ? 'Chart is missing client/location'
                    : payloadCount === 0
                      ? 'Mark at least one code as Accept / Reject / Edit'
                      : unreviewedCodes.length > 0
                        ? `Review every code before submitting — still pending: ${unreviewedCodes.join(', ')}`
                        : invalidReasons.length > 0
                          ? 'Provide reason text (≥20 chars) and dropdown for every Reject/Edit'
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
            onSaveAndNext={saveDecisionAndAdvance}
            reviewedCount={audit ? auditedCount : reviewedCount}
            reasonRows={reasonRows}
            // Coder controls lock both for QA read-only and for an auditor.
            readOnly={coderControlsLocked}
            audit={audit}
            auditState={auditState}
            submittedAudits={submittedAuditByKey}
            selectedAuditSt={selectedAuditSt}
            updateAudit={updateAudit}
            auditFeedbackOptionsFor={auditFeedbackOptionsFor}
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

      {confirmOpen && audit && (
        <AuditConfirmSubmitModal
          payload={buildAuditPayload()}
          submitting={submitAuditMut.isPending}
          error={submitError}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={onConfirmAuditSubmit}
        />
      )}
      {confirmOpen && !audit && (
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
                moveReasonText: '',
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

/* ── Audit confirm submission ───────────────────────────── */

const AUDIT_VERDICT_META: Record<
  CodeAuditInput['verdict'],
  { label: string; chip: string; dot: string }
> = {
  AGREE: {
    label: 'Agree',
    chip: 'bg-success-soft/60 text-success border-success/30',
    dot: 'bg-success',
  },
  DISAGREE: {
    label: 'Disagree',
    chip: 'bg-danger-soft/60 text-danger border-danger/30',
    dot: 'bg-danger',
  },
};

function AuditConfirmSubmitModal({
  payload,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  payload: CodeAuditInput[];
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const counts: Record<CodeAuditInput['verdict'], number> = { AGREE: 0, DISAGREE: 0 };
  for (const a of payload) counts[a.verdict]++;

  const grouped = new Map<CodeDecisionType, CodeAuditInput[]>();
  for (const a of payload) {
    const list = grouped.get(a.codeType) ?? [];
    list.push(a);
    grouped.set(a.codeType, list);
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
            <h3 className="text-sm font-bold text-ink">Confirm audit</h3>
            <p className="text-[11px] text-ink-muted mt-0.5">
              Review {payload.length} audit{payload.length === 1 ? '' : 's'} before sending.
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

        {/* Tallies */}
        <div className="grid grid-cols-2 gap-2 p-4 border-b border-line">
          {(['AGREE', 'DISAGREE'] as const).map((v) => {
            const meta = AUDIT_VERDICT_META[v];
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

        {/* Audit list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {payload.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-6">Nothing to submit yet.</p>
          ) : (
            Array.from(grouped.entries()).map(([codeType, list]) => (
              <section key={codeType}>
                <h4 className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-2">
                  {CODE_TYPE_LABEL[codeType]} ({list.length})
                </h4>
                <ul className="space-y-1.5">
                  {list.map((a, i) => {
                    const meta = AUDIT_VERDICT_META[a.verdict];
                    return (
                      <li
                        key={`${codeType}-${a.codeValue}-${i}`}
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
                          <span className="font-mono font-semibold text-sm text-ink">{a.codeValue}</span>
                        </div>
                        {a.verdict === 'DISAGREE' && (a.feedbackCategory || a.feedbackText) && (
                          <div className="mt-1.5 ml-1 text-[11px] text-ink-muted space-y-0.5">
                            {a.feedbackCategory && (
                              <div>
                                <span className="font-semibold">Category:</span>{' '}
                                <span className="text-ink">{a.feedbackCategory}</span>
                              </div>
                            )}
                            {a.feedbackText && (
                              <div className="line-clamp-2">
                                <span className="font-semibold">Note:</span>{' '}
                                <span className="text-ink">{a.feedbackText}</span>
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
            Submitting records your audit against this chart.
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
              {submitting ? 'Submitting…' : 'Confirm & Submit Audit'}
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
  onSaveAndNext,
  reviewedCount,
  reasonRows,
  readOnly,
  audit,
  auditState,
  submittedAudits,
  selectedAuditSt,
  updateAudit,
  auditFeedbackOptionsFor,
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
  onSaveAndNext: (patch: Partial<CodeState> & { decision: Decision }) => void;
  reviewedCount: number;
  reasonRows: CodeReviewReasonRow[];
  readOnly: boolean;
  audit: boolean;
  auditState: Record<string, AuditState>;
  submittedAudits: Map<string, CodeAuditRecord>;
  selectedAuditSt: AuditState | undefined;
  updateAudit: (key: string, patch: Partial<AuditState>) => void;
  auditFeedbackOptionsFor: (category: Category) => string[];
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
              {items.length} code{items.length === 1 ? '' : 's'} · {reviewedCount} {audit ? 'audited' : 'reviewed'}
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

      {/* Auditor feedback summary — non-audit views only (in audit mode the
          auditor is editing that layer). Jump chips take the coder straight
          to each disagreed code so the feedback can't be missed. */}
      {!audit && submittedAudits.size > 0 && (
        <div className="px-5 py-3 border-b border-line bg-warn-soft/20">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-warn">
              Auditor Feedback
            </span>
            <span className="text-xs text-ink">
              {[...submittedAudits.values()].filter((r) => r.verdict === 'DISAGREE').length} disagreed
              {' · '}
              {[...submittedAudits.values()].filter((r) => r.verdict === 'AGREE').length} agreed
            </span>
            {items
              .map((it, idx) => ({ it, idx, rec: submittedAudits.get(it.key) }))
              .filter(({ rec }) => rec?.verdict === 'DISAGREE')
              .map(({ it, idx }) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => setSelectedIdx(idx)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-danger/40 bg-danger-soft/50 text-danger text-[11px] font-mono font-semibold hover:bg-danger-soft transition"
                >
                  <ThumbsDown className="w-3 h-3" />
                  {state[it.key]?.editedCode || it.code}
                </button>
              ))}
          </div>
        </div>
      )}

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
              audit={audit}
              auditState={auditState}
              submittedAudits={submittedAudits}
            />
          ))
        )}
        {groups.length > 0 && <Legend audit={audit || submittedAudits.size > 0} />}
      </div>

      {/* Selected detail card */}
      <div className="flex-1 overflow-auto p-5">
        {selected && selectedSt && (
          <SelectedCard
            key={selected.key}
            item={selected}
            st={selectedSt}
            position={selectedIdx + 1}
            total={items.length}
            update={(p) => update(selected.key, p)}
            onSaveAndNext={onSaveAndNext}
            reasonRows={reasonRows}
            readOnly={readOnly}
            audit={audit}
            auditSt={selectedAuditSt}
            submittedAudit={submittedAudits.get(selected.key)}
            onUpdateAudit={(p) => updateAudit(selected.key, p)}
            auditFeedbackOptions={auditFeedbackOptionsFor(selected.category)}
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
  audit,
  auditState,
  submittedAudits,
}: {
  category: Category;
  list: CodeItem[];
  allItems: CodeItem[];
  state: Record<string, CodeState>;
  selectedIdx: number;
  setSelectedIdx: (i: number) => void;
  audit: boolean;
  auditState: Record<string, AuditState>;
  submittedAudits: Map<string, CodeAuditRecord>;
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
          // Audit mode keeps the coder's verdict color on the chip and adds a
          // small dot for the auditor's progress (agree=green, disagree=red,
          // pending=hollow) so the auditor can see what's left at a glance.
          // Outside audit mode the dot shows the SUBMITTED audit verdict, so
          // the coder spots agreed/disagreed codes at a glance too.
          const submitted = submittedAudits.get(it.key);
          const av = audit
            ? (auditState[it.key]?.verdict ?? 'pending')
            : submitted
              ? auditVerdictToLocal(submitted.verdict)
              : null;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold border transition',
                isSelected
                  ? 'border-warn bg-warn-soft text-warn shadow-sm'
                  : decisionChip(dec),
              )}
            >
              {av && (
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full border',
                    av === 'agree'
                      ? 'bg-success border-success'
                      : av === 'disagree'
                        ? 'bg-danger border-danger'
                        : 'bg-transparent border-ink-subtle',
                  )}
                />
              )}
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
    case 'moved':
      return 'border-warn/40 bg-warn-soft/50 text-warn hover:bg-warn-soft';
    default:
      return 'border-line bg-surface text-ink hover:bg-surface-2';
  }
}

function Legend({ audit }: { audit?: boolean }) {
  return (
    <div className="space-y-1.5 pt-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {LEGEND.map((l) => (
          <span key={l.d} className="inline-flex items-center gap-1.5 text-[10px] text-ink-muted">
            <span className={cn('w-1.5 h-1.5 rounded-full', l.cls)} />
            {l.label}
          </span>
        ))}
      </div>
      {audit && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[10px] text-ink-muted font-semibold uppercase tracking-wide">Audit:</span>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-success border border-success" /> Agree
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-danger border border-danger" /> Disagree
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-transparent border border-ink-subtle" /> Not audited
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Selected code detail ────────────────────────────────────
   Guided, one-code-at-a-time review surface. Selecting a code shows either its
   verdict summary (already decided) or the action picker (Accept / Reject /
   Edit). Choosing an action opens a single focused panel; "Save & Next" commits
   it and advances to the next code that still needs review. The card is keyed by
   item.key in CodesPane, so it remounts — and resets its step — per code. */

interface SelectedCardProps {
  item: CodeItem;
  st: CodeState;
  position: number;
  total: number;
  update: (patch: Partial<CodeState>) => void;
  onSaveAndNext: (patch: Partial<CodeState> & { decision: Decision }) => void;
  reasonRows: CodeReviewReasonRow[];
  readOnly: boolean;
  audit: boolean;
  auditSt: AuditState | undefined;
  /** Submitted auditor verdict for this code — rendered read-only in every
   * non-audit mode so the coder sees the auditor's feedback. */
  submittedAudit: CodeAuditRecord | undefined;
  onUpdateAudit: (patch: Partial<AuditState>) => void;
  auditFeedbackOptions: string[];
  onChangeCategory: (category: Category) => void;
  onRemove: () => void;
}

function SelectedCard(props: SelectedCardProps) {
  // Audit mode wins over read-only: it shows the coder's decision locked (the
  // read-only display) AND the auditor's Agree/Disagree controls on top.
  if (props.audit) {
    return (
      <AuditCard
        item={props.item}
        st={props.st}
        auditSt={props.auditSt ?? { verdict: 'pending', feedbackCategory: '', feedbackText: '' }}
        onUpdate={props.onUpdateAudit}
        feedbackOptions={props.auditFeedbackOptions}
      />
    );
  }
  const auditFeedback = props.submittedAudit ? (
    <AuditFeedbackDisplay record={props.submittedAudit} />
  ) : null;
  if (props.readOnly) {
    return (
      <div className="space-y-4">
        <ReadOnlyCard item={props.item} st={props.st} />
        {auditFeedback}
      </div>
    );
  }
  if (props.st.decision === 'added') {
    return (
      <div className="space-y-4">
        <AddedCard
          item={props.item}
          st={props.st}
          update={props.update}
          onRemove={props.onRemove}
        />
        {auditFeedback}
      </div>
    );
  }
  if (props.st.decision === 'moved') {
    return (
      <div className="space-y-4">
        <RecategorizeCard
          item={props.item}
          st={props.st}
          update={props.update}
          onChangeCategory={props.onChangeCategory}
          reasonRows={props.reasonRows}
        />
        {auditFeedback}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <DecisionCard {...props} />
      {auditFeedback}
    </div>
  );
}

const CARD_SHELL = 'rounded-xl border border-line bg-surface-sunken/30 p-4';

/** Big code + description read display. */
function CodeDisplay({ st }: { st: CodeState }) {
  return (
    <>
      <p className="text-2xl font-bold font-mono text-ink mb-1.5">{st.editedCode}</p>
      <p className="text-sm text-ink leading-snug">{st.editedDescription}</p>
    </>
  );
}

/** "AI suggested X → coder changed it to Y" — shown wherever a decided code is
 * displayed (coder's own summary, read-only/QA view, auditor's view) so the
 * AI-vs-coder edit is visible everywhere, not just to the auditor. */
function CoderEditComparison({ item, st }: { item: CodeItem; st: CodeState }) {
  const coderEdited =
    st.decision === 'edited' && normalizeCode(item.code) !== normalizeCode(st.editedCode);
  if (!coderEdited) return null;
  return (
    <p className="mt-1.5 text-xs text-ink-muted">
      AI suggested <span className="font-mono font-semibold text-ink">{item.code}</span>
      {' → '}coder changed it to{' '}
      <span className="font-mono font-semibold text-info">{st.editedCode}</span>
    </p>
  );
}

/** AI justification + confidence — shown for context in every mode. */
function AiReasoning({ item }: { item: CodeItem }) {
  return (
    <>
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
    </>
  );
}

type CardMode = 'summary' | 'pick' | 'accept' | 'reject';

function DecisionCard({
  item,
  st,
  position,
  total,
  onSaveAndNext,
  reasonRows,
  onChangeCategory,
}: SelectedCardProps) {
  const codeType = categoryToCodeType(item.category);
  const decided = st.decision !== 'pending';
  // Step state for THIS code. Starts on the verdict summary when the code was
  // already decided (e.g. reopened after a prior submit), otherwise the picker.
  const [mode, setMode] = useState<CardMode>(decided ? 'summary' : 'pick');

  // Working copy. Edits live here and only land in committed state on Save, so
  // the code pill, reviewed-count and validation don't shift until the coder
  // commits. Seeded from committed state each time a panel is opened.
  const [draftDropdown, setDraftDropdown] = useState(st.reasonDropdown);
  const [draftNotes, setDraftNotes] = useState(st.rejectReason);

  const enter = (m: 'accept' | 'reject') => {
    setDraftDropdown(st.reasonDropdown);
    setDraftNotes(st.rejectReason);
    setMode(m);
  };

  const reasonOptions =
    codeType !== null
      ? reasonRows
          .filter((r) => r.codeType === codeType && r.action === 'REJECT' && r.isActive)
          .sort((a, b) => a.displayOrder - b.displayOrder || a.text.localeCompare(b.text))
      : [];

  const notesChars = draftNotes.trim().length;
  const notesOk = notesChars >= REASON_MIN_CHARS;
  const dropdownOk = draftDropdown.trim().length > 0;
  const canSaveReject = dropdownOk && notesOk;

  // Commit, then settle this card onto its verdict summary. When there's a next
  // pending code the parent advances and this card remounts (so the summary is
  // a no-op); when this was the last one, selection stays put and the summary is
  // what the coder should now see instead of the still-open action panel.
  // Both keep the AI's original code and carry their reason fields so the
  // committed state is internally consistent regardless of what the coder did
  // before. (The Edit action — replacing the AI's code with a different one —
  // was disabled 2026-07-21; only Accept/Reject/Add remain.)
  const saveAccept = () => {
    onSaveAndNext({
      decision: 'accepted',
      editedCode: item.code,
      editedDescription: item.description,
    });
    setMode('summary');
  };
  const saveReject = () => {
    onSaveAndNext({
      decision: 'rejected',
      editedCode: item.code,
      editedDescription: item.description,
      reasonDropdown: draftDropdown.trim(),
      rejectReason: draftNotes.trim(),
    });
    setMode('summary');
  };

  return (
    <div className={CARD_SHELL}>
      {/* Category (changeable in place) + position */}
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted">
          Category
        </label>
        <span className="text-[10px] font-mono text-ink-subtle">
          {position} / {total}
        </span>
      </div>
      <FancySelect
        value={CATEGORY_ORDER.includes(item.category) ? item.category : 'PRIMARY'}
        onChange={(v) => onChangeCategory(v as Category)}
        options={CATEGORY_ORDER.map((c) => ({
          value: c,
          label: ADD_CODE_CATEGORY_LABEL[c as AddCodeCategory],
        }))}
        disabled={mode !== 'pick' && mode !== 'summary'}
      />

      {/* Code: read-only display. Editing an AI code into a different one is
          disabled (2026-07-21) — Accept/Reject/Add are the only actions. */}
      <div className="mt-3">
        <CodeDisplay st={st} />
        <CoderEditComparison item={item} st={st} />
      </div>

      <AiReasoning item={item} />

      {/* ── Verdict summary (already decided) ── */}
      {mode === 'summary' && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <ReadOnlyVerdictRow decision={st.decision} className="mt-0" />
            <button
              type="button"
              onClick={() => setMode('pick')}
              className="inline-flex items-center gap-1 px-3 h-8 rounded-md border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition"
            >
              <RotateCw className="w-3.5 h-3.5" /> Change decision
            </button>
          </div>
          {(st.decision === 'rejected' || st.decision === 'edited') && (
            <RecordedReason dropdown={st.reasonDropdown} notes={st.rejectReason} />
          )}
        </div>
      )}

      {/* ── Action picker ── */}
      {mode === 'pick' && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-ink-muted mb-2.5">
            How do you want to handle this code?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ActionTile
              tone="success"
              icon={<Check className="w-4 h-4" />}
              label="Accept"
              hint="Use as-is"
              active={st.decision === 'accepted'}
              onClick={() => enter('accept')}
            />
            <ActionTile
              tone="danger"
              icon={<X className="w-4 h-4" />}
              label="Reject"
              hint="Doesn't apply"
              active={st.decision === 'rejected'}
              onClick={() => enter('reject')}
            />
          </div>
        </div>
      )}

      {/* ── Accept ── */}
      {mode === 'accept' && (
        <div className="mt-5">
          <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success-soft/40 p-3">
            <Check className="w-4 h-4 text-success mt-0.5 shrink-0" />
            <p className="text-xs text-ink leading-relaxed">
              Accept <span className="font-mono font-semibold">{st.editedCode}</span> exactly as
              predicted by the AI. No changes will be made.
            </p>
          </div>
          <SaveFooter tone="success" canSave onBack={() => setMode('pick')} onSave={saveAccept} />
        </div>
      )}

      {/* ── Reject ── */}
      {mode === 'reject' && (
        <div className="mt-5 space-y-3">
          <ReasonFields
            tone="danger"
            label="Reason for rejecting"
            options={reasonOptions}
            dropdown={draftDropdown}
            onDropdown={setDraftDropdown}
            notes={draftNotes}
            onNotes={setDraftNotes}
            notesPlaceholder="Describe why this code doesn't apply"
          />
          <SaveFooter
            tone="danger"
            canSave={canSaveReject}
            onBack={() => setMode('pick')}
            onSave={saveReject}
          />
        </div>
      )}

    </div>
  );
}

/** One of the two big choices in the action picker. `active` marks the code's
 * current committed decision so re-opening the picker shows what was chosen. */
function ActionTile({
  tone,
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  tone: 'success' | 'danger' | 'info';
  icon: ReactNode;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  const base = {
    success: 'border-success/30 hover:border-success/60 hover:bg-success-soft/40 text-success',
    danger: 'border-danger/30 hover:border-danger/60 hover:bg-danger-soft/40 text-danger',
    info: 'border-info/30 hover:border-info/60 hover:bg-info-soft/40 text-info',
  }[tone];
  const activeCls = {
    success: 'ring-success/40 bg-success-soft/40',
    danger: 'ring-danger/40 bg-danger-soft/40',
    info: 'ring-info/40 bg-info-soft/40',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-[76px] flex flex-col items-center justify-center gap-1 rounded-xl border bg-surface px-2 py-3 transition',
        base,
        active && 'ring-2 ring-offset-1 ring-offset-surface',
        active && activeCls,
      )}
    >
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface-sunken">
        {icon}
      </span>
      <span className="text-xs font-semibold text-ink">{label}</span>
      <span className="text-[10px] text-ink-muted leading-none">{hint}</span>
    </button>
  );
}

/** Sticky Back / Save & Next footer for every action panel. */
function SaveFooter({
  tone,
  canSave,
  onBack,
  onSave,
}: {
  tone: 'success' | 'danger' | 'info';
  canSave: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const toneCls = {
    success: 'bg-success hover:bg-success/90',
    danger: 'bg-danger hover:bg-danger/90',
    info: 'bg-info hover:bg-info/90',
  }[tone];
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 px-3 h-9 rounded-lg border border-line text-xs font-semibold text-ink-muted hover:bg-surface-2 transition"
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Back
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className={cn(
          'inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed',
          toneCls,
        )}
      >
        <Save className="w-3.5 h-3.5" /> Save &amp; Next
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Dropdown reason + free-text notes (with min-length meter) — shared by the
 * Reject and Edit panels. */
function ReasonFields({
  tone,
  label,
  options,
  dropdown,
  onDropdown,
  notes,
  onNotes,
  notesPlaceholder,
}: {
  tone: 'danger' | 'info';
  label: string;
  options: CodeReviewReasonRow[];
  dropdown: string;
  onDropdown: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
  notesPlaceholder: string;
}) {
  const dot = tone === 'danger' ? 'bg-danger' : 'bg-info';
  const chars = notes.trim().length;
  const short = chars < REASON_MIN_CHARS;
  const dropdownMissing = !dropdown.trim();
  return (
    <div className="rounded-xl border border-line bg-surface p-3 space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted inline-flex items-center gap-1.5">
            <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />
            {label}
            <span className="text-danger normal-case">*</span>
          </label>
          <span className="text-[10px] text-ink-muted/70 font-mono">
            {options.length} option{options.length === 1 ? '' : 's'}
          </span>
        </div>
        {options.length === 0 ? (
          <div className="text-xs px-3 py-2 rounded-lg border border-warn/30 bg-warn-soft/30 text-warn">
            No reasons configured for this code type. Ask a Team Lead to add some in
            Configurations → Review Reasons.
          </div>
        ) : (
          <FancySelect
            value={dropdown}
            onChange={onDropdown}
            options={options.map((r) => ({ value: r.text, label: r.text }))}
            placeholder="Select a reason…"
            className={cn(dropdownMissing && '[&>button]:border-danger/60')}
          />
        )}
        {dropdownMissing && options.length > 0 && (
          <p className="mt-1 text-[11px] text-danger">Reason is required.</p>
        )}
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
          Notes <span className="text-danger normal-case">*</span>
        </label>
        <Textarea
          placeholder={`${notesPlaceholder} (min ${REASON_MIN_CHARS} characters)…`}
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          rows={3}
          error={short ? `Minimum ${REASON_MIN_CHARS} characters.` : undefined}
        />
        <div className="flex items-center justify-between mt-1">
          <div className="flex-1 h-1 bg-surface-sunken rounded-full overflow-hidden mr-3">
            <div
              className={cn('h-full transition-all', short ? 'bg-danger/70' : 'bg-success')}
              style={{ width: `${Math.min(100, (chars / REASON_MIN_CHARS) * 100)}%` }}
            />
          </div>
          <span
            className={cn('text-[11px] font-mono shrink-0', short ? 'text-danger' : 'text-success')}
          >
            {chars} / {REASON_MIN_CHARS}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Read-only display of a recorded dropdown reason + notes (verdict summary,
 * QA view). */
function RecordedReason({
  dropdown,
  notes,
  hideDropdown,
}: {
  dropdown: string;
  notes: string;
  hideDropdown?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 space-y-2">
      {!hideDropdown && (
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
            Reason
          </p>
          <div className="text-sm text-ink px-3 py-2 rounded-lg border border-line bg-surface-sunken/40">
            {dropdown || <span className="text-ink-muted">— No reason recorded —</span>}
          </div>
        </div>
      )}
      <div>
        <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
          Notes
        </p>
        <div className="text-sm text-ink px-3 py-2 rounded-lg border border-line bg-surface-sunken/40 whitespace-pre-wrap leading-relaxed">
          {notes || <span className="text-ink-muted">— No notes recorded —</span>}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyVerdictRow({
  decision,
  className,
}: {
  decision: Decision;
  className?: string;
}) {
  const tone =
    decision === 'accepted'
      ? { label: 'Accepted by coder', cls: 'bg-success-soft/60 text-success border-success/30', icon: <Check className="w-3.5 h-3.5" /> }
      : decision === 'rejected'
        ? { label: 'Rejected by coder', cls: 'bg-danger-soft/60 text-danger border-danger/30', icon: <X className="w-3.5 h-3.5" /> }
        : decision === 'edited'
          ? { label: 'Edited by coder', cls: 'bg-info-soft/60 text-info border-info/30', icon: <Pencil className="w-3.5 h-3.5" /> }
          : decision === 'added'
            ? { label: 'Added by coder', cls: 'bg-violet-100/60 text-violet-700 border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-300', icon: <Plus className="w-3.5 h-3.5" /> }
            : { label: 'Pending — coder did not act on this code', cls: 'bg-surface-sunken text-ink-muted border-line', icon: null };
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill border text-xs font-semibold',
        className ?? 'mt-4',
        tone.cls,
      )}
    >
      {tone.icon}
      {tone.label}
    </div>
  );
}

/** QA / read-only view of a single code: code, AI reasoning, locked verdict and
 * the recorded reason/notes. */
function ReadOnlyCard({ item, st }: { item: CodeItem; st: CodeState }) {
  const hasReason =
    st.decision === 'rejected' || st.decision === 'edited' || st.decision === 'added';
  return (
    <div className={CARD_SHELL}>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
        {item.category}
      </p>
      <CodeDisplay st={st} />
      <CoderEditComparison item={item} st={st} />
      <AiReasoning item={item} />
      <ReadOnlyVerdictRow decision={st.decision} />
      {hasReason && (
        <div className="mt-3">
          <RecordedReason
            dropdown={st.reasonDropdown}
            notes={st.rejectReason}
            hideDropdown={st.decision === 'added'}
          />
        </div>
      )}
    </div>
  );
}

/** Read-only display of the auditor's SUBMITTED verdict + feedback for a code.
 * Rendered under the coder/QA cards (never in audit mode, where AuditCard owns
 * the editable audit layer) so the coder can see the auditor's feedback. */
function AuditFeedbackDisplay({ record }: { record: CodeAuditRecord }) {
  const agree = record.verdict === 'AGREE';
  return (
    <div className="rounded-xl border border-warn/30 bg-warn-soft/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-warn">
          Auditor Feedback
        </p>
        <span className="text-[10px] text-ink-muted">
          {new Date(record.auditedAt).toLocaleDateString()}
        </span>
      </div>
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill border text-xs font-semibold',
          agree
            ? 'bg-success-soft/60 text-success border-success/30'
            : 'bg-danger-soft/60 text-danger border-danger/30',
        )}
      >
        {agree ? <ThumbsUp className="w-3.5 h-3.5" /> : <ThumbsDown className="w-3.5 h-3.5" />}
        {agree ? 'Auditor agreed' : 'Auditor disagreed'}
      </div>
      {!agree && (
        <>
          {record.feedbackCategory && (
            <div>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
                Feedback Category
              </p>
              <div className="text-sm text-ink px-3 py-2 rounded-lg border border-line bg-surface-sunken/40">
                {record.feedbackCategory}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
              Feedback
            </p>
            <div className="text-sm text-ink px-3 py-2 rounded-lg border border-line bg-surface-sunken/40 whitespace-pre-wrap leading-relaxed">
              {record.feedbackText || <span className="text-ink-muted">— No note recorded —</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Auditor's per-code surface: shows the three layers — AI original, the
 * coder's (locked) decision + reason, and the auditor's editable Agree /
 * Disagree + feedback. Reuses the read-only display pieces so the AI and coder
 * layers render identically to the QA view. */
function AuditCard({
  item,
  st,
  auditSt,
  onUpdate,
  feedbackOptions,
}: {
  item: CodeItem;
  st: CodeState;
  auditSt: AuditState;
  onUpdate: (patch: Partial<AuditState>) => void;
  feedbackOptions: string[];
}) {
  const hasReason =
    st.decision === 'rejected' || st.decision === 'edited' || st.decision === 'added';
  const disagree = auditSt.verdict === 'disagree';
  const chars = auditSt.feedbackText.trim().length;
  const short = chars < AUDIT_FEEDBACK_MIN_CHARS;

  return (
    <div className={cn(CARD_SHELL, 'space-y-4')}>
      {/* ── Layers 1 + 2: AI original + coder decision ── */}
      <div>
        <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
          {item.category}
        </p>
        <CodeDisplay st={st} />
        <CoderEditComparison item={item} st={st} />
        <AiReasoning item={item} />
        <ReadOnlyVerdictRow decision={st.decision} />
        {hasReason && (
          <div className="mt-3">
            <RecordedReason
              dropdown={st.reasonDropdown}
              notes={st.rejectReason}
              hideDropdown={st.decision === 'added'}
            />
          </div>
        )}
      </div>

      {/* ── Layer 3: the auditor's judgment ── */}
      <div className="rounded-xl border border-warn/30 bg-warn-soft/20 p-3 space-y-3">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-warn">
          Your Audit
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            // Agreeing clears any feedback the auditor had typed under Disagree.
            onClick={() => onUpdate({ verdict: 'agree', feedbackCategory: '', feedbackText: '' })}
            className={cn(
              'inline-flex items-center justify-center gap-2 h-10 rounded-lg border text-sm font-semibold transition',
              auditSt.verdict === 'agree'
                ? 'border-success bg-success text-white shadow-sm'
                : 'border-line bg-surface text-ink hover:border-success/60 hover:bg-success-soft/40',
            )}
          >
            <ThumbsUp className="w-4 h-4" /> Agree
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ verdict: 'disagree' })}
            className={cn(
              'inline-flex items-center justify-center gap-2 h-10 rounded-lg border text-sm font-semibold transition',
              disagree
                ? 'border-danger bg-danger text-white shadow-sm'
                : 'border-line bg-surface text-ink hover:border-danger/60 hover:bg-danger-soft/40',
            )}
          >
            <ThumbsDown className="w-4 h-4" /> Disagree
          </button>
        </div>

        {disagree && (
          <div className="rounded-lg border border-line bg-surface p-3 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                  Feedback Category
                  <span className="text-danger normal-case">*</span>
                </label>
                <span className="text-[10px] text-ink-muted/70 font-mono">
                  {feedbackOptions.length} option{feedbackOptions.length === 1 ? '' : 's'}
                </span>
              </div>
              {feedbackOptions.length === 0 ? (
                <div className="text-xs px-3 py-2 rounded-lg border border-warn/30 bg-warn-soft/30 text-warn">
                  No feedback categories configured for this area. Ask a Team Lead to add some in
                  Configurations → Feedback Categories.
                </div>
              ) : (
                <FancySelect
                  value={auditSt.feedbackCategory}
                  onChange={(v) => onUpdate({ feedbackCategory: v })}
                  options={feedbackOptions.map((o) => ({ value: o, label: o }))}
                  placeholder="Select a feedback category…"
                  className={cn(!auditSt.feedbackCategory.trim() && '[&>button]:border-danger/60')}
                />
              )}
              {!auditSt.feedbackCategory.trim() && feedbackOptions.length > 0 && (
                <p className="mt-1 text-[11px] text-danger">Feedback category is required.</p>
              )}
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
                Note <span className="text-danger normal-case">*</span>
              </label>
              <Textarea
                placeholder={`Why do you disagree with the coder? (min ${AUDIT_FEEDBACK_MIN_CHARS} characters)…`}
                value={auditSt.feedbackText}
                onChange={(e) => onUpdate({ feedbackText: e.target.value })}
                rows={3}
                error={short ? `Minimum ${AUDIT_FEEDBACK_MIN_CHARS} characters.` : undefined}
              />
              <div className="flex items-center justify-between mt-1">
                <div className="flex-1 h-1 bg-surface-sunken rounded-full overflow-hidden mr-3">
                  <div
                    className={cn('h-full transition-all', short ? 'bg-danger/70' : 'bg-success')}
                    style={{ width: `${Math.min(100, (chars / AUDIT_FEEDBACK_MIN_CHARS) * 100)}%` }}
                  />
                </div>
                <span className={cn('text-[11px] font-mono shrink-0', short ? 'text-danger' : 'text-success')}>
                  {chars} / {AUDIT_FEEDBACK_MIN_CHARS}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A code the coder added that the AI didn't suggest. Already counts as
 * reviewed ('added'); the coder just supplies the required note, or removes it. */
function AddedCard({
  item,
  st,
  update,
  onRemove,
}: {
  item: CodeItem;
  st: CodeState;
  update: (patch: Partial<CodeState>) => void;
  onRemove: () => void;
}) {
  const chars = st.rejectReason.trim().length;
  const short = chars < REASON_MIN_CHARS;
  return (
    <div className={CARD_SHELL}>
      <div className="flex items-center justify-between mb-3">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-violet-700 dark:text-violet-300">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          {item.category} · Added by you
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 px-3 h-7 rounded-md border border-line text-xs font-semibold text-ink-muted hover:bg-danger-soft/40 hover:text-danger hover:border-danger/30 transition"
        >
          <X className="w-3 h-3" /> Remove
        </button>
      </div>
      <CodeDisplay st={st} />
      <div className="mt-4">
        <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
          Notes <span className="text-danger normal-case">*</span>
        </label>
        <Textarea
          placeholder={`Describe why you added this code (min ${REASON_MIN_CHARS} characters)…`}
          value={st.rejectReason}
          onChange={(e) => update({ rejectReason: e.target.value })}
          rows={3}
          error={short ? `Minimum ${REASON_MIN_CHARS} characters.` : undefined}
        />
        <div className="flex items-center justify-between mt-1">
          <div className="flex-1 h-1 bg-surface-sunken rounded-full overflow-hidden mr-3">
            <div
              className={cn('h-full transition-all', short ? 'bg-danger/70' : 'bg-success')}
              style={{ width: `${Math.min(100, (chars / REASON_MIN_CHARS) * 100)}%` }}
            />
          </div>
          <span
            className={cn('text-[11px] font-mono shrink-0', short ? 'text-danger' : 'text-success')}
          >
            {chars} / {REASON_MIN_CHARS}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Shown while a code's category has been changed via the dropdown
 * (decision='moved'). Recategorizing is recorded as two decisions on submit
 * — REJECTED in the old category and ADDED in the new one — rather than a
 * silent move, so both halves need their own justification here. The
 * "remove from" reason only applies to AI-suggested codes (they carry a
 * predictedCodeId to reject against); a coder-added code moving categories
 * only needs the "add to" reason. */
function RecategorizeCard({
  item,
  st,
  update,
  onChangeCategory,
  reasonRows,
}: {
  item: CodeItem;
  st: CodeState;
  update: (patch: Partial<CodeState>) => void;
  onChangeCategory: (category: Category) => void;
  reasonRows: CodeReviewReasonRow[];
}) {
  const fromCategory = item.originalCategory ?? item.category;
  const fromType = categoryToCodeType(fromCategory);
  const hasAiOrigin = !!item.predictedCodeId;

  const reasonOptions =
    hasAiOrigin && fromType
      ? reasonRows
          .filter((r) => r.codeType === fromType && r.action === 'REJECT' && r.isActive)
          .sort((a, b) => a.displayOrder - b.displayOrder || a.text.localeCompare(b.text))
      : [];

  const addChars = st.moveReasonText.trim().length;
  const addShort = addChars < REASON_MIN_CHARS;

  return (
    <div className={CARD_SHELL}>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted">
          Category
        </label>
      </div>
      <FancySelect
        value={CATEGORY_ORDER.includes(item.category) ? item.category : 'PRIMARY'}
        onChange={(v) => onChangeCategory(v as Category)}
        options={CATEGORY_ORDER.map((c) => ({
          value: c,
          label: ADD_CODE_CATEGORY_LABEL[c as AddCodeCategory],
        }))}
      />

      <div className="mt-3">
        <CodeDisplay st={st} />
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn-soft/40 p-3">
        <RotateCw className="w-4 h-4 text-warn mt-0.5 shrink-0" />
        <p className="text-xs text-ink leading-relaxed">
          Recategorizing from <span className="font-semibold">{fromCategory}</span> to{' '}
          <span className="font-semibold">{item.category}</span> rejects the code from{' '}
          {fromCategory} and adds it fresh under {item.category}. Both need a reason.
        </p>
      </div>

      {hasAiOrigin && (
        <div className="mt-4">
          <ReasonFields
            tone="danger"
            label={`Reason for removing from ${fromCategory}`}
            options={reasonOptions}
            dropdown={st.reasonDropdown}
            onDropdown={(v) => update({ reasonDropdown: v })}
            notes={st.rejectReason}
            onNotes={(v) => update({ rejectReason: v })}
            notesPlaceholder="Describe why this code no longer belongs here"
          />
        </div>
      )}

      <div className="mt-4">
        <label className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted block mb-1">
          Reason for adding to {item.category} <span className="text-danger normal-case">*</span>
        </label>
        <Textarea
          placeholder={`Describe why this code belongs here (min ${REASON_MIN_CHARS} characters)…`}
          value={st.moveReasonText}
          onChange={(e) => update({ moveReasonText: e.target.value })}
          rows={3}
          error={addShort ? `Minimum ${REASON_MIN_CHARS} characters.` : undefined}
        />
        <div className="flex items-center justify-between mt-1">
          <div className="flex-1 h-1 bg-surface-sunken rounded-full overflow-hidden mr-3">
            <div
              className={cn('h-full transition-all', addShort ? 'bg-danger/70' : 'bg-success')}
              style={{ width: `${Math.min(100, (addChars / REASON_MIN_CHARS) * 100)}%` }}
            />
          </div>
          <span className={cn('text-[11px] font-mono shrink-0', addShort ? 'text-danger' : 'text-success')}>
            {addChars} / {REASON_MIN_CHARS}
          </span>
        </div>
      </div>
    </div>
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

