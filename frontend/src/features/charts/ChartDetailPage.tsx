import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  PanelRightClose,
  PanelRightOpen,
  Save,
  UserPlus,
} from 'lucide-react';
import {
  getChart,
  getChartNeighbors,
  listCodeAudits,
  listCodeDecisions,
  getCodeDecisionDraft,
  selfAllocateCharts,
  updateChart,
  getActiveTimer,
  type UpdateChartDto,
} from '@/api/charts';
import type { AiPredictedCode } from '@/api/types';
import { getWorklist } from '@/api/worklists';
import { listUsers } from '@/api/users';
import { getFeedbackCategories } from '@/api/configurations';
import type { AuditAreaRow } from './chart-detail/shared';
import type { AiEncounterResult, ApiErrorShape, Chart, ChartStatus, Priority, UploadedDocument } from '@/api/types';
import { useAuth } from '@/auth/store';
import { can } from '@/permissions';
import { useChartsView } from './chartsViewStore';
import { Button } from '@/components/ui/Button';
import { ConfirmModal, Toast } from '@/components/ui/Primitives';
import { IcdBotWidget } from '@/components/IcdBotWidget';
import { HeaderCard } from './chart-detail/HeaderCard';
import { UploadSection } from './chart-detail/UploadSection';
import { ChartInfoSection } from './chart-detail/ChartInfoSection';
import { ProcessingInfoSection } from './chart-detail/ProcessingInfoSection';
import { AuditInfoSection } from './chart-detail/AuditInfoSection';
import { DocumentViewerModal } from './chart-detail/DocumentViewerModal';
import { ReviewEditModal } from './chart-detail/ReviewEditModal';
import { ChartLiveDecisionToasts } from '../qa/live/ChartLiveDecisionToasts';
import { useFormDraft, useAuditDraft, useCustomFieldValues, EMPTY_FORM_DRAFT, type FormDraft, type AuditCell } from './chart-detail/formState';
import { useChartAiCodes } from './chart-detail/useChartAiCodes';
import { useFieldConfig, STANDARD_FIELD_MAP, isFieldDisabledByStatus } from './chart-detail/useFieldConfig';
import { ChartDetailSkeleton } from './chart-detail/ChartDetailSkeleton';
import { UsersPanel } from './chart-detail/sidebar/UsersPanel';
import { ConversationLog } from './chart-detail/sidebar/ConversationLog';
import { TimeTracker } from './chart-detail/sidebar/TimeTracker';
import { AiIcdPrediction, type AnnotatedCode, type AnnotatedPrediction } from './chart-detail/sidebar/AiIcdPrediction';
import { DocumentationGaps } from './chart-detail/sidebar/DocumentationGaps';
import { PhysicianQueries } from './chart-detail/sidebar/PhysicianQueries';
import { CodingFeedback } from './chart-detail/sidebar/CodingFeedback';

/**
 * customFields keys the chart-edit form must never hold or write back. The AI
 * pipeline owns the first four — echoing a stale snapshot of them on Save can
 * resurrect a cleared error / pending run or clobber the document list (see
 * docs/handoff.md) — and _formDraft is rebuilt fresh on every save.
 */
const NON_FORM_CUSTOM_FIELD_KEYS = new Set([
  'aiPrediction',
  'aiPredictionError',
  'pendingPrediction',
  'uploadedDocs',
  '_formDraft',
]);

export function ChartDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: chart, isPending } = useQuery({
    queryKey: ['chart', id],
    queryFn: () => getChart(id!),
    enabled: !!id,
    // While the AI pipeline is in flight on the server (pendingPrediction set
    // but aiPrediction not yet written), poll the chart so the UI picks up the
    // result the moment the backend watcher finalizes it. Stops polling once
    // the prediction lands or the pending row is cleared.
    refetchInterval: (query) => {
      const cf = (query.state.data as Chart | undefined)?.customFields as
        | { pendingPrediction?: unknown; aiPrediction?: unknown }
        | undefined;
      return cf?.pendingPrediction && !cf?.aiPrediction ? 5000 : false;
    },
  });

  // Previous/Next walk the SAME ordered list the Charts grid is showing. We
  // replay the grid's persisted filters, search, sort and priority tab (from
  // useChartsView) so "next" is the row below this chart and "previous" the row
  // above — exactly as they appear in the table, spanning page boundaries. If
  // this chart isn't in that filtered set, both ends come back null and the
  // buttons disable. (page/pageSize are intentionally omitted — neighbors walk
  // the whole result set, not a single page.)
  const chartFilters = useChartsView((s) => s.filters);
  const chartTab = useChartsView((s) => s.tab);
  const chartSort = useChartsView((s) => s.sort);
  const neighborParams = useMemo(
    () => ({
      ...chartFilters,
      ...(chartTab !== 'ALL' ? { priority: chartTab } : {}),
      sortBy: chartSort.sortBy,
      sortDir: chartSort.sortDir,
    }),
    [chartFilters, chartTab, chartSort.sortBy, chartSort.sortDir],
  );
  const neighbors = useQuery({
    queryKey: ['chart-neighbors', id, neighborParams],
    queryFn: () => getChartNeighbors(id!, neighborParams),
    enabled: !!id,
  });
  const prevId = neighbors.data?.prevId ?? null;
  const nextId = neighbors.data?.nextId ?? null;

  if (!isPending && !chart) return <div className="p-8 text-ink-muted">Not found.</div>;

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <Link
        to="/charts"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to charts
      </Link>

      <div className="flex items-center justify-between">
        <Button
          variant="primary"
          leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
          disabled={!prevId}
          onClick={() => prevId && navigate(`/charts/${prevId}`)}
        >
          Previous Chart
        </Button>
        <Button
          variant="primary"
          rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
          disabled={!nextId}
          onClick={() => nextId && navigate(`/charts/${nextId}`)}
        >
          Next Chart
        </Button>
      </div>

      {chart ? <ChartDetailBody chart={chart} /> : <ChartDetailSkeleton />}
    </div>
  );
}

/* ── Local draft persistence (refresh-safe unsaved edits) ──────
 * The Chart/Processing/Audit form draft lives only in React state until the
 * user clicks Save. To survive a refresh, mirror it to localStorage (per chart
 * + user) as the user types, restore it on mount, and clear it once saved. */
const LOCAL_DRAFT_PREFIX = 'chart-draft:v1';
interface LocalDraft {
  draft?: Partial<FormDraft>;
  customValues?: Record<string, unknown>;
  audit?: Record<string, AuditCell>;
}
function localDraftKey(chartId: string, userId: string): string {
  return `${LOCAL_DRAFT_PREFIX}:${chartId}:${userId}`;
}
function loadLocalDraft(chartId: string, userId: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(localDraftKey(chartId, userId));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}
function saveLocalDraft(chartId: string, userId: string, payload: LocalDraft): void {
  try {
    localStorage.setItem(localDraftKey(chartId, userId), JSON.stringify(payload));
  } catch {
    /* ignore quota / disabled storage */
  }
}
function clearLocalDraft(chartId: string, userId: string): void {
  try {
    localStorage.removeItem(localDraftKey(chartId, userId));
  } catch {
    /* ignore */
  }
}

/* ── Body — owns shared form state ───────────────────────── */

function ChartDetailBody({ chart }: { chart: Chart }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isAuditor = user?.role === 'AUDITOR';
  // An auditor reviews a chart only once coding is finished — at that point the
  // Review & Edit modal switches to audit mode (coder decisions shown locked,
  // auditor layers Agree/Disagree on top). Mirrors HeaderCard's codingFinished.
  const isAuditMode =
    isAuditor &&
    ['CODING_DONE', 'READY_TO_AUDIT', 'AUDIT_IN_PROGRESS', 'AUDIT_DONE', 'CLOSED'].includes(
      chart.milestone,
    );
  // The chart is in the audit stage — the only context where the Audit-section
  // "Allocate to Coder" (auditAllocateCoder) reallocation applies. Gating the
  // auto-default and the save-fold on this keeps a coder's rework save (or a
  // team-lead/manager coding) from picking up that field: were it folded into
  // allocatedCoderId there, `allocatingSomeone` would flip true and the chart
  // would never advance to CODING_DONE.
  const isAuditStageChart = ['READY_TO_AUDIT', 'AUDIT_IN_PROGRESS', 'AUDIT_DONE'].includes(
    chart.milestone,
  );

  // Frontend-only draft for the source's wide form. Seed with everything the
  // server persists for this chart so the auditor opens with the coder's saved
  // edits already prefilled (admit/discharge dates, comments, DRG, allocations).
  // Fields that don't have dedicated entity columns (disposition, facility,
  // POA, LOS, sub-speciality, etc.) live under customFields._formDraft per the
  // backend DTO's escape-hatch comment.
  const formDraftStash = (chart.customFields as { _formDraft?: Partial<FormDraft> } | undefined)?._formDraft ?? {};
  // Unsaved edits this user left for this chart, restored from localStorage so a
  // refresh doesn't lose them. Read once on mount; overlaid on the server seed.
  const [restoredLocal] = useState(() => loadLocalDraft(String(chart.id), user?.id ?? ''));
  // Seed helpers for the multi-value fields (DRG, PCS). For DRG, fall back to the
  // legacy single value (_formDraft.drgValue string, or the numeric drg_value
  // column) so charts saved before DRG went multi still load their value.
  type CodeDesc = { code: string; description: string };
  // Normalize a stored list into {code, description}[]. Tolerates the brief
  // string[]-only shape (codes without descriptions) and drops empty rows.
  const seedCodeDescArray = (v: unknown): CodeDesc[] =>
    Array.isArray(v)
      ? v
          .map((x) =>
            typeof x === 'string'
              ? { code: x, description: '' }
              : {
                  code: String((x as { code?: unknown })?.code ?? ''),
                  description: String((x as { description?: unknown })?.description ?? ''),
                },
          )
          .filter((x) => x.code || x.description)
      : [];
  const seedDrgValues = (stash: Record<string, unknown>): CodeDesc[] => {
    if (Array.isArray(stash.drgValues)) return seedCodeDescArray(stash.drgValues);
    if (typeof stash.drgValue === 'string' && stash.drgValue) return [{ code: stash.drgValue, description: '' }];
    if (chart.drgValue != null && String(chart.drgValue) !== '') return [{ code: String(chart.drgValue), description: '' }];
    return [];
  };
  const { draft, update: rawUpdate, setDraft } = useFormDraft({
    chartNo: chart.chartNo ?? '',
    mrNo: chart.mrNumber ?? '',
    dateOfService: chart.dateOfService ?? '',
    admitDate: chart.admitDate ?? '',
    dischargeDate: chart.dischargeDate ?? '',
    primaryDiagnosis: chart.primaryDiagnosis ?? '',
    primaryDiagnosisDescription:
      typeof formDraftStash.primaryDiagnosisDescription === 'string'
        ? formDraftStash.primaryDiagnosisDescription
        : '',
    em: chart.emLevel ?? '',
    // DRG is multi-value now; seedDrgValues handles the legacy single-value
    // fallback (_formDraft.drgValue string, or the numeric drg_value column).
    drgValues: seedDrgValues(formDraftStash as Record<string, unknown>),
    coderComments: chart.coderCommentsToClient ?? '',
    rejectionComments: chart.rejectionDenialComments ?? '',
    deficiencyComments: chart.deficiencyComments ?? '',
    // "Allocate to coder/auditor" are explicit *handoff* fields — they start
    // empty rather than pre-loaded with the current allocation. The backend
    // treats an allocation id in a save as a handoff and pins the chart in
    // CODING_IN_PROGRESS / AUDIT_IN_PROGRESS; re-sending the current coder's own
    // id therefore meant a coder's own save never advanced to CODING_DONE.
    // Empty lets the save advance the milestone — the allocation FK is untouched
    // (an omitted id is dropped from the payload, not cleared).
    allocateCoder: '',
    allocateAuditor: '',
    priority: chart.priority,
    // Map persisted enum back to the form's display label. OPEN is treated as
    // a "no choice yet" state — represented by an empty string so the select
    // shows the "Open" placeholder.
    chartStatus:
      chart.chartStatus === 'COMPLETE' ? 'Complete' :
      chart.chartStatus === 'INCOMPLETE' ? 'Incomplete' : '',
    // Form-only fields (no entity columns) — round-tripped via customFields.
    disposition: typeof formDraftStash.disposition === 'string' ? formDraftStash.disposition : '',
    primaryHealth: typeof formDraftStash.primaryHealth === 'string' ? formDraftStash.primaryHealth : '',
    facility: typeof formDraftStash.facility === 'string' ? formDraftStash.facility : '',
    subSpecialty: typeof formDraftStash.subSpecialty === 'string' ? formDraftStash.subSpecialty : '',
    poa: typeof formDraftStash.poa === 'string' ? formDraftStash.poa : '',
    los: typeof formDraftStash.los === 'string' ? formDraftStash.los : '',
    procedureCode: typeof formDraftStash.procedureCode === 'string' ? formDraftStash.procedureCode : '',
    pcsCodes: seedCodeDescArray(formDraftStash.pcsCodes),
    responsibleParty: Array.isArray(formDraftStash.responsibleParty) ? formDraftStash.responsibleParty : [],
    holdReason: Array.isArray(formDraftStash.holdReason) ? formDraftStash.holdReason : [],
    auditOption: Array.isArray(formDraftStash.auditOption) ? formDraftStash.auditOption : [],
    qcStatus: typeof formDraftStash.qcStatus === 'string' ? formDraftStash.qcStatus : '',
    auditorQcStatus: typeof formDraftStash.auditorQcStatus === 'string' ? formDraftStash.auditorQcStatus : '',
    // Overlay refresh-restored unsaved edits (localStorage) on the server seed.
    ...(restoredLocal?.draft ?? {}),
  });
  // Baseline the Priority select was seeded to *this session*, so a save can
  // tell a real user edit from computed drift. `chart.priority` is the COMPUTED
  // bucket (viewer-dependent) and legitimately changes under the form — e.g.
  // starting the timer clears a manual pin and recomputes LOW→MEDIUM. Comparing
  // the select to the live `chart.priority` therefore misfired and re-sent the
  // stale value as a fresh manual override, silently re-pinning the chart (§7.3).
  // Compare against this seeded baseline instead: only a value the user actually
  // moved the select to differs from it. Refreshed wherever the draft reseeds.
  const seededPriorityRef = useRef(chart.priority);
  // Seed the Audit Information table from the persisted _formDraft.audit blob,
  // then overlay any unsaved localStorage edits — mirroring how `draft` seeds
  // from the server then overlays restoredLocal. Previously this seeded from
  // localStorage only, so saved audit rows vanished on refresh and were never
  // visible to other users.
  const auditStash = (formDraftStash as { audit?: Record<string, AuditCell> }).audit ?? {};
  const { audit, updateAudit: rawUpdateAudit, setAudit } = useAuditDraft({
    ...auditStash,
    ...(restoredLocal?.audit ?? {}),
  });
  // User Manual §6.2.2: the auditor picks a Feedback Category on an Audit
  // Information row only when a discrepancy exists. True when any row carries one.
  const hasAuditFeedback = useMemo(
    () =>
      Object.values(audit).some((c) =>
        Array.isArray(c.feedbackCategory)
          ? c.feedbackCategory.length > 0
          : typeof c.feedbackCategory === 'string' && c.feedbackCategory.trim() !== '',
      ),
    [audit],
  );
  const { values: customValues, updateValue: rawUpdateCustomValue } = useCustomFieldValues({
    ...Object.fromEntries(
      Object.entries((chart.customFields ?? {}) as Record<string, unknown>).filter(
        ([k]) => !NON_FORM_CUSTOM_FIELD_KEYS.has(k),
      ),
    ),
    ...(restoredLocal?.customValues ?? {}),
  });

  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  // QA mode: opened from the Team Lead's QA dashboard via `?qa=1`. Renders
  // every section in read-only — no save, no review-submit, no field edits.
  const [searchParams, setSearchParams] = useSearchParams();
  const qaReadOnly = searchParams.get('qa') === '1';
  // QA Live: `?liveUserId=<coderId>` means QA followed a live card here to
  // watch that coder's in-progress draft — surface it by auto-opening the
  // Review & Edit modal seeded from their draft.
  const liveDraftRaw = qaReadOnly ? searchParams.get('liveUserId') : null;
  const liveDraftUserId =
    liveDraftRaw && Number.isFinite(Number(liveDraftRaw)) ? Number(liveDraftRaw) : undefined;
  // Coder/auditor name carried over from the Live tab for the decision toasts.
  const liveName = searchParams.get('liveName') || 'Coder';
  const [reviewOpen, setReviewOpen] = useState(() => liveDraftUserId != null);

  // Single source of truth for AI artifacts: the chart's customFields. Keeping
  // these as derived values (not local state) guarantees the sidebar always
  // reflects the latest server payload — whether it landed via the in-tab
  // upload flow, a React Query refetch, or a fresh page reload after the
  // backend watcher finalized an orphaned encounter.
  const persisted = chart.customFields as
    | { aiPrediction?: AiEncounterResult; uploadedDocs?: UploadedDocument[] }
    | undefined;
  const aiPrediction: AiEncounterResult | null = persisted?.aiPrediction ?? null;
  const uploadedDocs: UploadedDocument[] = persisted?.uploadedDocs ?? [];

  // Single source of truth for the AI codes: one shared query (deduped with the
  // Review & Edit modal) that prefers the LIVE gateway codes — carrying each
  // code's predictedCodeId — and falls back to the persisted snapshot when the
  // gateway is unreachable. Both the sidebar AI ICD card and the modal derive
  // from `aiCodes`, so the two surfaces can never disagree.
  // See docs/AI_CODES_SINGLE_SOURCE_FIX.md.
  const unifiedAi = useChartAiCodes(String(chart.id), aiPrediction);
  const aiCodes = unifiedAi.prediction;

  // Apply the chart's persisted decisions on top of the AI's original
  // prediction so the sidebar AI ICD card reflects what the coder actually
  // submitted (edited codes show new values, rejected codes disappear,
  // added codes appear). We use chart_code_decisions — our local audit
  // table — as the source of truth rather than the orchestrator's /codes
  // endpoint, because that endpoint returns the ORIGINAL predictions
  // unchanged with only a status field, not the corrected code values.
  const decisionsQ = useQuery({
    queryKey: ['chart-code-decisions', String(chart.id)],
    queryFn: () => listCodeDecisions(String(chart.id)),
    enabled: !!chart.id,
  });
  // The coder's in-progress (not-yet-submitted) decisions — the draft is
  // deleted server-side on submit, so its presence means "unsubmitted". Shares
  // the review modal's query key so a submit/edit there refreshes the sidebar.
  const draftQ = useQuery({
    queryKey: ['chart-code-decision-draft', String(chart.id)],
    queryFn: () => getCodeDecisionDraft(String(chart.id)),
    enabled: !!chart.id,
  });
  const liveAiPrediction: AnnotatedPrediction | null = useMemo(() => {
    // Annotate the UNIFIED base (live gateway codes when available, snapshot
    // otherwise) — the exact same data the modal builds its board from.
    if (!aiCodes) return null;
    const decisions = decisionsQ.data?.items ?? [];
    const draft = draftQ.data?.draft?.payload;
    const draftDecisions = draft?.decisions ?? [];
    const draftAdded = draft?.addedItems ?? [];
    if (decisions.length === 0 && draftDecisions.length === 0 && draftAdded.length === 0) {
      return aiCodes; // nothing reviewed yet — show the raw prediction
    }
    const norm = (s: string) => s.replace(/\./g, '').trim().toUpperCase();
    // Effective NON-added decisions, keyed by the EXACT `${category}|${code}`
    // identity the board uses. The submitted record is the baseline; a draft
    // (unsubmitted) entry for the same key is the coder's newer intent and wins.
    // Keeping the category in the key is essential: the AI can place the SAME
    // code in two categories (e.g. a diagnosis that's both primary and
    // secondary), and those are two distinct decisions that must not collapse.
    type Eff = {
      code: string;
      category: string;
      decision: 'accepted' | 'rejected' | 'edited';
      editedCode?: string;
      editedDescription?: string;
      notSubmitted: boolean;
    };
    const effByKey = new Map<string, Eff>();
    for (const d of decisions) {
      if (d.decision === 'ADDED') continue;
      effByKey.set(`${d.codeType}|${d.codeValue}`, {
        code: d.codeValue,
        category: d.codeType,
        decision: d.decision === 'REJECTED' ? 'rejected' : d.decision === 'EDITED' ? 'edited' : 'accepted',
        editedCode: d.editedCode ?? undefined,
        editedDescription: d.editedDescription ?? undefined,
        notSubmitted: false,
      });
    }
    for (const d of draftDecisions) {
      if (d.decision === 'added') continue;
      effByKey.set(`${d.category}|${d.code}`, {
        code: d.code,
        category: d.category,
        decision: d.decision,
        editedCode: d.editedCode || undefined,
        editedDescription: d.editedDescription || undefined,
        notSubmitted: true,
      });
    }
    const dedup = (arr: AnnotatedCode[]) => {
      const seen = new Set<string>();
      return arr.filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)));
    };
    // Annotate an AI code with an effective decision (or null → untouched).
    const annotateWith = (c: AiPredictedCode, eff: Eff | null): AnnotatedCode => {
      if (!eff) return { ...c, decisionState: 'untouched' };
      const flag = eff.notSubmitted ? { notSubmitted: true as const } : {};
      if (eff.decision === 'rejected') return { ...c, decisionState: 'rejected', ...flag };
      if (eff.decision === 'edited')
        return {
          ...c,
          code: eff.editedCode || c.code,
          description: eff.editedDescription || c.description,
          decisionState: 'edited',
          originalCode: c.code,
          originalDescription: c.description,
          ...flag,
        };
      return { ...c, decisionState: 'accepted', ...flag };
    };
    const buckets: Record<string, AnnotatedCode[]> = { PRIMARY: [], SECONDARY: [], PROCEDURE: [] };
    const aiAll = [
      ...aiCodes.primary.map((c) => ({ c, orig: 'PRIMARY' })),
      ...aiCodes.secondary.map((c) => ({ c, orig: 'SECONDARY' })),
      ...aiCodes.procedures.map((c) => ({ c, orig: 'PROCEDURE' })),
    ];
    // Pass 1 — exact (category|code): codes that stayed in their AI category
    // (a dual-category code matches in BOTH its buckets). Mark each consumed.
    const consumed = new Set<string>();
    const pending: { c: AiPredictedCode; orig: string }[] = [];
    for (const { c, orig } of aiAll) {
      const key = `${orig}|${c.code}`;
      const eff = effByKey.get(key);
      if (eff) {
        consumed.add(key);
        buckets[orig].push(annotateWith(c, eff));
      } else {
        pending.push({ c, orig });
      }
    }
    // Leftover decisions (no exact AI match) are in-place MOVES: the same code,
    // decided under a different category. Index them by code so an AI code with
    // no decision in its own bucket can follow its move into the new one.
    const movedByCode = new Map<string, Eff>();
    for (const [key, eff] of effByKey) {
      if (!consumed.has(key)) movedByCode.set(norm(eff.code), eff);
    }
    // Pass 2 — place the AI codes that had no exact decision: follow a move if
    // one references this code under a real bucket, else show as untouched.
    for (const { c, orig } of pending) {
      const moved = movedByCode.get(norm(c.code));
      if (moved && moved.category !== orig && buckets[moved.category]) {
        buckets[moved.category].push(annotateWith(c, moved));
        movedByCode.delete(norm(c.code));
      } else {
        buckets[orig].push(annotateWith(c, null));
      }
    }
    // Coder-added codes (not in the AI prediction): draft-added (not submitted)
    // first, then submitted-added that a draft hasn't superseded.
    const addedFor = (codeType: string): AnnotatedCode[] => {
      const out: AnnotatedCode[] = [];
      const seen = new Set<string>();
      for (const a of draftAdded) {
        if (a.category !== codeType) continue;
        out.push({ code: a.code, description: a.description, decisionState: 'added', notSubmitted: true });
        seen.add(norm(a.code));
      }
      for (const d of decisions) {
        if (d.decision !== 'ADDED' || d.codeType !== codeType) continue;
        const code = d.editedCode ?? d.codeValue;
        if (seen.has(norm(code))) continue;
        out.push({ code, description: d.editedDescription ?? '', decisionState: 'added' });
      }
      return out;
    };
    const primary = dedup([...buckets.PRIMARY, ...addedFor('PRIMARY')]);
    const secondary = dedup([...buckets.SECONDARY, ...addedFor('SECONDARY')]);
    const procedures = dedup([...buckets.PROCEDURE, ...addedFor('PROCEDURE')]);
    return {
      ...aiCodes,
      primary,
      secondary,
      procedures,
      codes: [...primary, ...secondary, ...procedures],
    };
  }, [aiCodes, decisionsQ.data, draftQ.data]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [saveToastOpen, setSaveToastOpen] = useState(false);
  // Surfaces a server-side save failure (e.g. validation errors) to the user —
  // without it the Save button would just stop spinning with no feedback.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Track unsaved edits so we can block "Stop timer" until the user saves.
  // Start "dirty" when we restored unsaved edits, so the server-reseed effect
  // below doesn't overwrite them.
  const [isDirty, setIsDirty] = useState(!!restoredLocal);

  // Wrap each updater so any user edit flips the draft to "dirty"; cleared on save success.
  const update: typeof rawUpdate = (k, v) => {
    setIsDirty(true);
    rawUpdate(k, v);
  };
  const updateAudit: typeof rawUpdateAudit = (rowKey, field, value) => {
    setIsDirty(true);
    rawUpdateAudit(rowKey, field, value);
  };
  const updateCustomValue: typeof rawUpdateCustomValue = (id, v) => {
    setIsDirty(true);
    rawUpdateCustomValue(id, v);
  };

  // Mirror the in-progress draft (Chart/Processing/Audit) to localStorage so a
  // refresh doesn't lose unsaved edits. Debounced; only while there are edits.
  // `_aiFields` is a Set (non-serialisable) so it's stripped before persisting.
  useEffect(() => {
    if (!isDirty) return;
    const t = setTimeout(() => {
      const draftToSave = { ...draft };
      delete (draftToSave as { _aiFields?: unknown })._aiFields;
      saveLocalDraft(String(chart.id), user?.id ?? '', {
        draft: draftToSave,
        customValues,
        audit,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [draft, customValues, audit, isDirty, chart.id, user?.id]);

  // Real timer state — only true when this user has an active timer ticking
  // on this specific chart. Milestone alone is unreliable (it stays at
  // CODING_IN_PROGRESS after Stop, so we can't infer "is the timer running"
  // from it). Shares the cache key used by HeaderCard's TimerPanel.
  const isTeamLead = user?.role === 'TEAMLEAD';
  // Managers have full team-lead parity — they can self-allocate, time, code and audit.
  const isManager = user?.role === 'MANAGER';
  const canTime = user?.role === 'CODER' || user?.role === 'AUDITOR' || isTeamLead || isManager;
  const activeTimer = useQuery({
    queryKey: ['active-timer'],
    queryFn: getActiveTimer,
    enabled: canTime,
  });
  // A paused chart is reported by active-timer (so the Charts page can show it)
  // but it is NOT running — exclude paused so editing stays locked.
  const timerRunning = activeTimer.data?.chartId === chart.id && !activeTimer.data?.paused;
  const timerStopped = !timerRunning;
  // Paused break (set via the timer's Pause): the timer is frozen and editing,
  // Save, and the Review & Edit modal are all locked until the user resumes.
  const pausedMarker = (chart.customFields as { timerPaused?: { userId?: number | string } } | undefined)
    ?.timerPaused;
  const isPaused = !!pausedMarker && String(pausedMarker.userId ?? '') === (user?.id ?? '');

  // Submitted per-code audits — surfaced on the sidebar card so a coder
  // opening an audited chart immediately sees that auditor feedback exists.
  // Shares the modal's cache key (invalidated when the modal closes).
  const codeAuditsQ = useQuery({
    queryKey: ['chart-code-audits', String(chart.id)],
    queryFn: () => listCodeAudits(String(chart.id)),
  });
  const auditSummary = useMemo(() => {
    const rows = codeAuditsQ.data?.items ?? [];
    if (rows.length === 0) return null;
    return {
      agreed: rows.filter((r) => r.verdict === 'AGREE').length,
      disagreed: rows.filter((r) => r.verdict === 'DISAGREE').length,
    };
  }, [codeAuditsQ.data]);

  // QA takeover: a viewer with self-allocate rights (Auditor / Team-Lead)
  // looking at a chart in read-only QA view that isn't theirs can self-allocate
  // to take it over. Doing so assigns it to them, drops ?qa=1 so the page leaves
  // read-only QA and reopens in editing mode. Coders can no longer self-allocate,
  // so the takeover button never shows for them (see permissions.ts).
  const canSelfAllocate = can(user, 'chart.selfAllocate');
  const allocatedToMe =
    !!user &&
    (String(chart.allocatedCoderId ?? '') === user.id ||
      String(chart.allocatedAuditorId ?? '') === user.id);
  const canTakeOver = qaReadOnly && canTime && !allocatedToMe && canSelfAllocate;
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [takeoverError, setTakeoverError] = useState<string | null>(null);
  const takeoverMut = useMutation({
    mutationFn: () => selfAllocateCharts([Number(chart.id)]),
    onSuccess: (res) => {
      setTakeoverOpen(false);
      if (res.allocated > 0) {
        setTakeoverError(null);
        // Leave QA view: drop ?qa=1 so the page reopens in normal editable mode,
        // now that the chart is allocated to this user.
        const next = new URLSearchParams(searchParams);
        next.delete('qa');
        setSearchParams(next, { replace: true });
        // Refetch so allocation (and any milestone change) reflect the takeover.
        qc.invalidateQueries({ queryKey: ['chart', String(chart.id)] });
        qc.invalidateQueries({ queryKey: ['charts'] });
        qc.invalidateQueries({ queryKey: ['active-timer'] });
      } else {
        // Skipped — e.g. someone else is already actively working on it.
        setTakeoverError(res.skipped?.[0]?.reason ?? 'Could not allocate this chart.');
      }
    },
    onError: (err) => {
      setTakeoverOpen(false);
      setTakeoverError((err as { message?: string })?.message ?? 'Could not allocate this chart.');
    },
  });
  // Takeover reassigns the chart AWAY from its current assignees: a Team-Lead /
  // Manager grabs BOTH slots (coder + auditor), an auditor grabs the auditor
  // slot. Spell out who gets displaced so it's never a silent surprise.
  const takeoverTakesBoth = user?.role === 'TEAMLEAD' || user?.role === 'MANAGER';
  const takeoverDisplaced = (takeoverTakesBoth
    ? [
        chart.allocatedCoderName ? `${chart.allocatedCoderName} (coder)` : null,
        chart.allocatedAuditorName ? `${chart.allocatedAuditorName} (auditor)` : null,
      ]
    : [chart.allocatedAuditorName ? `${chart.allocatedAuditorName} (auditor)` : null]
  ).filter(Boolean).join(' and ');
  const takeoverMessage =
    `Self-allocating assigns ${takeoverTakesBoth ? 'both the coder and auditor slots' : 'the auditor slot'} to you` +
    (takeoverDisplaced ? `, reassigning this chart away from ${takeoverDisplaced}` : '') +
    `. It closes the read-only QA view and reopens the chart in editing mode so you can start the timer.`;
  // Team leads can audit in addition to coding; only block the audit section
  // when the viewer is neither role and the timer is off.
  const auditDisabled = !(isAuditor || isTeamLead || isManager) || !timerRunning || isPaused;

  // While the timer is running, treat the chart as needing a save before the
  // user can stop. Without this, a coder/auditor who starts the timer and
  // clicks Stop without ever editing or saving would slip past the canStop
  // check (since isDirty only flips on user edits). Saving clears isDirty,
  // unblocking Stop; further edits flip it back.
  useEffect(() => {
    if (timerRunning) setIsDirty(true);
  }, [timerRunning]);

  // Re-seed the form when the underlying chart record changes (refetch after
  // save, or stale-cache hydrate-then-update). Only runs while the form is
  // pristine — once the user starts editing we let their typing win until
  // they save. Triggered off chart.updatedAt so a fresh GET reliably reseeds.
  useEffect(() => {
    if (isDirty) return;
    const stash = (chart.customFields as { _formDraft?: Partial<FormDraft> } | undefined)?._formDraft ?? {};
    setDraft({
      ...EMPTY_FORM_DRAFT,
      chartNo: chart.chartNo ?? '',
      mrNo: chart.mrNumber ?? '',
      dateOfService: chart.dateOfService ?? '',
      admitDate: chart.admitDate ?? '',
      dischargeDate: chart.dischargeDate ?? '',
      primaryDiagnosis: chart.primaryDiagnosis ?? '',
      primaryDiagnosisDescription:
        typeof stash.primaryDiagnosisDescription === 'string' ? stash.primaryDiagnosisDescription : '',
      em: chart.emLevel ?? '',
      drgValues: seedDrgValues(stash as Record<string, unknown>),
      coderComments: chart.coderCommentsToClient ?? '',
      rejectionComments: chart.rejectionDenialComments ?? '',
      deficiencyComments: chart.deficiencyComments ?? '',
      // Handoff fields start empty — see the initial draft builder above.
      allocateCoder: '',
      allocateAuditor: '',
      priority: chart.priority,
      chartStatus:
        chart.chartStatus === 'COMPLETE' ? 'Complete' :
        chart.chartStatus === 'INCOMPLETE' ? 'Incomplete' : '',
      disposition: typeof stash.disposition === 'string' ? stash.disposition : '',
      primaryHealth: typeof stash.primaryHealth === 'string' ? stash.primaryHealth : '',
      facility: typeof stash.facility === 'string' ? stash.facility : '',
      subSpecialty: typeof stash.subSpecialty === 'string' ? stash.subSpecialty : '',
      poa: typeof stash.poa === 'string' ? stash.poa : '',
      los: typeof stash.los === 'string' ? stash.los : '',
      procedureCode: typeof stash.procedureCode === 'string' ? stash.procedureCode : '',
      pcsCodes: seedCodeDescArray(stash.pcsCodes),
      responsibleParty: Array.isArray(stash.responsibleParty) ? stash.responsibleParty : [],
      holdReason: Array.isArray(stash.holdReason) ? stash.holdReason : [],
      auditOption: Array.isArray(stash.auditOption) ? stash.auditOption : [],
      qcStatus: typeof stash.qcStatus === 'string' ? stash.qcStatus : '',
      // Must be reseeded too: the coder-QC gate and the Auditor QC display both
      // read it, so dropping it on a refetch would blank the auditor's verdict.
      auditorQcStatus: typeof stash.auditorQcStatus === 'string' ? stash.auditorQcStatus : '',
    });
    // Reseed the Audit Information table from the same persisted stash so a
    // refetch (post-save / stale-cache hydrate) reflects the saved audit rows.
    setAudit((stash as { audit?: Record<string, AuditCell> }).audit ?? {});
    // Move the manual-override baseline in lockstep with the reseeded select, so
    // the recomputed priority becomes the new "unchanged" value (see the ref).
    seededPriorityRef.current = chart.priority;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.id, chart.updatedAt]);

  // User Manual §6.2.2: "'Feedback Provided' will automatically be selected if
  // any of the feedback categories were selected." One-directional on purpose —
  // picking a category auto-selects Feedback Provided, but clearing categories
  // does NOT force it back (that would wipe the QC of legacy charts that carry a
  // persisted 'Feedback Provided' with no stored feedback rows). When categories
  // are cleared the field simply unlocks (see qcAutoProvided) so the auditor can
  // change it. setDraft (not update) so seeding never marks the form dirty.
  useEffect(() => {
    if (!hasAuditFeedback) return;
    setDraft((d) =>
      d.auditorQcStatus === 'Feedback Provided' ? d : { ...d, auditorQcStatus: 'Feedback Provided' },
    );
  }, [hasAuditFeedback, setDraft]);

  // When the auditor flags QC "Feedback Provided" the chart is going back to the
  // coder for rework — default the Audit-section "Allocate to Coder" to the coder
  // who ACTUALLY worked it: the chart's current allocated coder (the coder slot
  // isn't cleared when an auditor is assigned, so it still holds whoever finished
  // coding). Fall back to the first-ever coder (`originalCoderId`) only if the
  // slot is somehow empty. Preferring the current coder avoids silently yanking a
  // chart that was reassigned mid-stream back to the first-ever coder. Fill only
  // when the field is empty so a deliberate pick is never clobbered, and use
  // setDraft (not update) so seeding the default never marks the form dirty on
  // its own — the auditor's QC change already did.
  useEffect(() => {
    if (!isAuditStageChart || draft.auditorQcStatus !== 'Feedback Provided') return;
    const reworkCoder = chart.allocatedCoderId ?? chart.originalCoderId;
    if (!reworkCoder) return;
    setDraft((d) =>
      d.auditAllocateCoder ? d : { ...d, auditAllocateCoder: String(reworkCoder) },
    );
  }, [isAuditStageChart, draft.auditorQcStatus, chart.allocatedCoderId, chart.originalCoderId, setDraft]);

  const cfg = useFieldConfig(chart);

  // Fetch the parent worklist so we can clamp the chart's Date of Service to
  // the service-date range chosen at worklist creation, and pre-fill the
  // field from the range start when the chart has none yet.
  const worklistQ = useQuery({
    queryKey: ['worklist', chart.worklistId],
    queryFn: () => getWorklist(chart.worklistId),
    enabled: !!chart.worklistId,
  });
  const dosMin = worklistQ.data?.dateOfService ?? undefined;
  const dosMax = worklistQ.data?.dateOfServiceTo ?? worklistQ.data?.dateOfService ?? undefined;

  // Audit Information dropdowns — feedback categories are configured per
  // client + location in /configurations and surfaced here for the auditor.
  const feedbackClientId = worklistQ.data?.clientId;
  const feedbackLocationId = worklistQ.data?.locationId;
  const feedbackCategoriesQ = useQuery({
    queryKey: ['feedback-categories', feedbackClientId, feedbackLocationId],
    queryFn: () => getFeedbackCategories({ clientId: feedbackClientId!, locationId: feedbackLocationId! }),
    enabled: !!feedbackClientId && !!feedbackLocationId,
  });
  // Audit Information rows are driven by the audit areas configured for this
  // chart's client + location — one active row per area, in the configured
  // order, each carrying its own reasons as Feedback Category options.
  // Deactivated areas (Configurations → Feedback Categories) are hidden.
  const auditAreaRows: AuditAreaRow[] = (feedbackCategoriesQ.data?.areas ?? [])
    .filter((a) => a.isActive)
    .map((a) => ({
      key: String(a.id),
      label: a.name,
      options: a.reasons.map((r) => r.name).filter(Boolean),
    }));

  // Seed the Date of Service draft from the worklist's range start once the
  // worklist data lands — but only if the chart had no DoS persisted and the
  // user hasn't typed anything yet. Run at most once per chart.
  const dosSeededRef = useRef(false);
  useEffect(() => {
    if (dosSeededRef.current) return;
    if (chart.dateOfService) return;
    if (!worklistQ.data?.dateOfService) return;
    if (draft.dateOfService) return;
    rawUpdate('dateOfService', worklistQ.data.dateOfService);
    dosSeededRef.current = true;
  }, [chart.dateOfService, worklistQ.data?.dateOfService, draft.dateOfService, rawUpdate]);

  // Allocation pickers in the Processing Info section need the full active
  // roster. Endpoint is open to every signed-in role.
  const codersQ = useQuery({
    queryKey: ['users', 'coders'],
    queryFn: () => listUsers({ role: 'CODER', pageSize: 500, status: 'ACTIVE' }),
  });
  const auditorsQ = useQuery({
    queryKey: ['users', 'auditors'],
    queryFn: () => listUsers({ role: 'AUDITOR', pageSize: 500, status: 'ACTIVE' }),
  });
  // Hide the currently-logged-in viewer from both pickers so a manager /
  // team-lead reviewing the chart can't accidentally allocate it to
  // themselves.
  const coderOpts = (codersQ.data?.items ?? [])
    .filter((u) => String(u.id) !== String(user?.id))
    .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }));
  const auditorOpts = (auditorsQ.data?.items ?? [])
    .filter((u) => String(u.id) !== String(user?.id))
    .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }));

  /**
   * Check every field marked MANDATORY in the per-combo config and collect
   * any whose draft slot is empty. Includes custom fields. Returns labels.
   */
  function collectMissingMandatory(): string[] {
    const missing: string[] = [];
    for (const f of STANDARD_FIELD_MAP) {
      if (cfg.getValidation(f.key) !== 'MANDATORY') continue;
      // Status-gated fields are non-mandatory whenever the UI has disabled
      // them — see isFieldDisabledByStatus for the per-field rule.
      if (isFieldDisabledByStatus(f.key, draft.chartStatus)) continue;
      const v = (draft as unknown as Record<string, unknown>)[f.draftKey];
      const isEmpty = f.isArray
        ? !Array.isArray(v) || v.length === 0
        : v === undefined || v === null || v === '';
      if (isEmpty) missing.push(f.label);
    }
    for (const cf of cfg.customFields) {
      if (cf.validation !== 'MANDATORY') continue;
      const v = customValues[String(cf.id)];
      const isEmpty =
        cf.type === 'dropdown' && cf.isMultiSelect
          ? !Array.isArray(v) || v.length === 0
          : v === undefined || v === null || v === '';
      if (isEmpty) missing.push(cf.name);
    }
    return missing;
  }

  // Map the draft's display label back to the ChartStatus enum the API expects.
  // Empty (placeholder) and the legacy 'Open' literal both serialise as OPEN.
  const chartStatusForApi: ChartStatus | undefined =
    draft.chartStatus === 'Complete'
      ? 'COMPLETE'
      : draft.chartStatus === 'Incomplete'
      ? 'INCOMPLETE'
      : 'OPEN';

  const saveMut = useMutation({
    mutationFn: () => {
      // Stash form-only fields into customFields under a reserved key. The
      // backend merges customFields shallowly, so spreading existing values
      // first preserves user-defined custom fields while overwriting our
      // reserved blob with the latest draft.
      // Persist only the audit rows the auditor actually filled — mirrors the
      // empty-row filtering on DRG/PCS below so we don't store blank areas.
      const auditFilled = Object.fromEntries(
        Object.entries(audit).filter(([, cell]) => {
          const total = (cell.totalCodes ?? '').trim();
          const correct = typeof cell.correctCodes === 'string' ? cell.correctCodes.trim() : '';
          const fc = Array.isArray(cell.feedbackCategory)
            ? cell.feedbackCategory.length > 0
            : (cell.feedbackCategory ?? '') !== '';
          return total !== '' || correct !== '' || fc;
        }),
      );
      const formDraftBlob: Partial<FormDraft> & { audit?: Record<string, AuditCell> } = {
        primaryDiagnosisDescription: draft.primaryDiagnosisDescription,
        disposition: draft.disposition,
        primaryHealth: draft.primaryHealth,
        facility: draft.facility,
        subSpecialty: draft.subSpecialty,
        poa: draft.poa,
        los: draft.los,
        // Round-trip the full multi-value DRG and PCS lists. The numeric
        // `drgValue` column below still gets the first DRG value parsed, keeping
        // reports/queries that read the column happy.
        drgValues: draft.drgValues.filter((r) => r.code.trim() || r.description.trim()),
        procedureCode: draft.procedureCode,
        pcsCodes: draft.pcsCodes.filter((r) => r.code.trim() || r.description.trim()),
        responsibleParty: draft.responsibleParty,
        holdReason: draft.holdReason,
        auditOption: draft.auditOption,
        qcStatus: draft.qcStatus,
        // Auditor QC status also drives the auditor priority buckets, so it must
        // be persisted (it was previously dropped from this blob).
        auditorQcStatus: draft.auditorQcStatus,
        // Feedback Type — the required dropdown under the Audit Information
        // table. It was collected into the draft but never written to this blob,
        // so every auditor's choice was silently discarded on save and the
        // Reports "Feedback Type" column was blank for every chart.
        feedbackType: draft.feedbackType,
        // Audit Information table — per-area Total Codes / Correct Codes /
        // Feedback Category. Persisted here so it survives save + refresh, is
        // visible to other users, and is exported in Reports (Audit Total Codes,
        // Audit Correct Codes, Feedback Category). Previously dropped entirely.
        audit: auditFilled,
      };
      // Send only the values of configured custom fields (keyed by field id)
      // plus the _formDraft blob — never the chart's full customFields. The
      // backend strips the pipeline-owned keys too; not sending them at all
      // keeps a stale tab's snapshot from overwriting newer pipeline state
      // even against an older backend.
      const customFieldValues: Record<string, unknown> = {};
      for (const cf of cfg.customFields) {
        const key = String(cf.id);
        if (key in customValues) customFieldValues[key] = customValues[key];
      }
      // First non-empty DRG code, for the numeric drg_value column below.
      const firstDrgCode = draft.drgValues.map((r) => r.code.trim()).find(Boolean);
      const payload: UpdateChartDto = {
        chartNo: draft.chartNo || undefined,
        mrNumber: draft.mrNo || undefined,
        // Priority is computed per viewer; only send it when the user actually
        // changed the select, in which case the backend records it as a manual
        // override (§7.3) that reverts once they touch the chart. Compare against
        // the seeded baseline, NOT the live computed `chart.priority`: the latter
        // shifts under the form (e.g. starting the timer clears the pin and
        // recomputes LOW→MEDIUM), which made a plain save re-pin the chart.
        priority:
          draft.priority && draft.priority !== seededPriorityRef.current
            ? (draft.priority as Priority)
            : undefined,
        chartStatus: chartStatusForApi,
        primaryDiagnosis: draft.primaryDiagnosis || undefined,
        emLevel: draft.em || undefined,
        // Send the raw string (including '') so clearing a comment actually
        // sticks. `|| undefined` drops the key from the JSON payload, and the
        // backend's partial-update merge (Object.assign) then keeps the old
        // value — which made a cleared comment reappear after save.
        coderCommentsToClient: draft.coderComments,
        rejectionDenialComments: draft.rejectionComments,
        deficiencyComments: draft.deficiencyComments,
        admitDate: draft.admitDate || undefined,
        dischargeDate: draft.dischargeDate || undefined,
        dos: draft.dateOfService || undefined,
        // First non-empty DRG code populates the numeric column for backward-
        // compat; the full list (code + description) lives in _formDraft.drgValues.
        drgValue: firstDrgCode ? parseFloat(firstDrgCode) || undefined : undefined,
        // Drives the milestone state machine: backend keeps the chart in
        // CODING_IN_PROGRESS / AUDIT_IN_PROGRESS when these are set, otherwise
        // advances to CODING_DONE / AUDIT_DONE.
        //
        // Two surfaces feed the coder allocation: the Processing-Info picker
        // (`allocateCoder`, coder/manager path) and the Audit-section picker
        // (`auditAllocateCoder`, the auditor sending the chart back on "Feedback
        // Provided"). The audit picker only applies when QC is "Feedback
        // Provided" — an "Agree" save must not resend a stale coder — so gate it
        // on that. Whichever surface the user actually used wins.
        allocatedCoderId: (() => {
          const auditReallocate =
            isAuditStageChart && draft.auditorQcStatus === 'Feedback Provided'
              ? draft.auditAllocateCoder
              : '';
          const coder = draft.allocateCoder || auditReallocate;
          return coder ? Number(coder) : undefined;
        })(),
        allocatedAuditorId: draft.allocateAuditor ? Number(draft.allocateAuditor) : undefined,
        customFields: { ...customFieldValues, _formDraft: formDraftBlob },
      };
      return updateChart(chart.id, payload);
    },
    onSuccess: () => {
      setIsDirty(false);
      // The draft is now persisted server-side — drop the local refresh copy.
      clearLocalDraft(String(chart.id), user?.id ?? '');
      setSaveError(null);
      setSaveToastOpen(true);
      qc.invalidateQueries({ queryKey: ['chart', chart.id] });
      qc.invalidateQueries({ queryKey: ['charts'] });
      qc.invalidateQueries({ queryKey: ['active-timer'] });
    },
    // Surface the server's error message (validation, conflicts, etc.) instead
    // of swallowing it — the client interceptor normalises every failure to an
    // ApiErrorShape with a human-readable `message`.
    onError: (err) => {
      setSaveError((err as unknown as ApiErrorShape)?.message ?? 'Failed to save chart. Please try again.');
    },
  });

  function onSaveClick() {
    // Mandatory checks gate the coder profile only — auditors can't edit
    // Chart Info / Processing Info, so blocking their save on missing values
    // there would trap them on a chart that the coder hasn't yet completed.
    if (isAuditor) {
      setMissingFields([]);
      saveMut.mutate();
      return;
    }
    const missing = collectMissingMandatory();
    setMissingFields(missing);
    if (missing.length === 0) saveMut.mutate();
  }

  return (
    <div
      className={`grid grid-cols-1 ${
        sidebarOpen ? 'lg:grid-cols-[1fr_340px]' : 'lg:grid-cols-1'
      } gap-5 items-start relative`}
    >
      {/* Sidebar toggle — pinned to the right edge */}
      <button
        type="button"
        onClick={() => setSidebarOpen((v) => !v)}
        className="absolute top-0 right-0 z-10 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-ink bg-surface border border-line rounded-pill px-3 py-1.5 shadow-card hover:bg-surface-2 transition"
        title={sidebarOpen ? 'Collapse sidebar' : 'Show sidebar'}
      >
        {sidebarOpen ? (
          <>
            <PanelRightClose className="w-3.5 h-3.5" />
            Hide panel
          </>
        ) : (
          <>
            <PanelRightOpen className="w-3.5 h-3.5" />
            Show panel
          </>
        )}
      </button>

      {/* LEFT — main content */}
      <div className="space-y-5 min-w-0">
        <HeaderCard chart={chart} canStop={!isDirty} qaReadOnly={qaReadOnly} />

        {/* QA takeover: this chart isn't yours and you're viewing it read-only.
            Self-allocate to assign it to yourself, leave QA view and edit it. */}
        {canTakeOver && (
          <div className="rounded-lg border border-warn/40 bg-warn-soft/40 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <Eye className="w-4 h-4 text-warn mt-0.5 shrink-0" />
              <p className="text-xs text-ink-muted leading-snug">
                You're viewing this chart in read-only QA mode. Self-allocate to assign it to
                yourself, exit QA view, and start working on it.
              </p>
            </div>
            <Button
              size="sm"
              leftIcon={<UserPlus className="w-3.5 h-3.5" />}
              loading={takeoverMut.isPending}
              onClick={() => {
                setTakeoverError(null);
                setTakeoverOpen(true);
              }}
              className="shrink-0"
            >
              Self-allocate to work on this
            </Button>
          </div>
        )}
        {qaReadOnly && takeoverError && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-xs text-danger">
            {takeoverError}
          </div>
        )}

        <UploadSection
          chartId={chart.id}
          /* Service Line feature commented out */
          /* serviceLineId={chart.serviceLineId} */
          uploadedDocs={uploadedDocs}
          customFields={chart.customFields}
          onView={(docId) => {
            setActiveDocId(docId);
            setViewerOpen(true);
          }}
          onProcessed={(result) => {
            // Write through to the React Query cache so the sidebar updates
            // synchronously without waiting for a refetch round-trip.
            qc.setQueryData<Chart>(['chart', String(chart.id)], (prev) =>
              prev
                ? {
                    ...prev,
                    customFields: {
                      ...(prev.customFields ?? {}),
                      aiPrediction: result,
                      uploadedDocs: result.uploadedDocs,
                    },
                  }
                : prev,
            );
            // Refetch so other consumers (e.g. the milestone state) see it.
            qc.invalidateQueries({ queryKey: ['chart', String(chart.id)] });
          }}
          onDocsChanged={(docs) => {
            // Add/remove only touches the document list — patch uploadedDocs in
            // place without disturbing the existing aiPrediction.
            qc.setQueryData<Chart>(['chart', String(chart.id)], (prev) =>
              prev
                ? {
                    ...prev,
                    customFields: {
                      ...(prev.customFields ?? {}),
                      uploadedDocs: docs,
                    },
                  }
                : prev,
            );
            qc.invalidateQueries({ queryKey: ['chart', String(chart.id)] });
          }}
          onRefetch={() => qc.invalidateQueries({ queryKey: ['chart', String(chart.id)] })}
        />

        <ChartInfoSection
          draft={draft}
          update={update}
          readOnly={timerStopped || qaReadOnly || isPaused}
          isAuditor={isAuditor}
          cfg={cfg}
          customValues={customValues}
          updateCustomValue={updateCustomValue}
          dosMin={dosMin}
          dosMax={dosMax}
        />
        <ProcessingInfoSection
          draft={draft}
          update={update}
          readOnly={timerStopped || qaReadOnly || isPaused}
          isAuditor={isAuditor}
          cfg={cfg}
          customValues={customValues}
          updateCustomValue={updateCustomValue}
          coders={coderOpts}
          auditors={auditorOpts}
          codersLoading={codersQ.isFetching}
          auditorsLoading={auditorsQ.isFetching}
        />
        <AuditInfoSection
          draft={draft}
          update={update}
          audit={audit}
          updateAudit={updateAudit}
          disabled={auditDisabled || qaReadOnly}
          isAuditor={isAuditor}
          qcAutoProvided={hasAuditFeedback}
          feedbackTypes={cfg.options.feedbackTypes}
          auditAreas={auditAreaRows}
          areasLoading={feedbackCategoriesQ.isLoading}
          coders={coderOpts}
          codersLoading={codersQ.isFetching}
        />

        {missingFields.length > 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3">
            <p className="text-sm font-semibold text-danger mb-1">
              Please fill the following required field{missingFields.length > 1 ? 's' : ''}:
            </p>
            <ul className="text-xs text-danger list-disc list-inside">
              {missingFields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {qaReadOnly ? (
          <div className="rounded-lg border border-info/30 bg-info-soft/30 px-4 py-2 text-xs text-info">
            Read-only QA view — editing and submission are disabled.
          </div>
        ) : (
          <div className="flex justify-end">
            <Button
              variant="danger"
              leftIcon={<Save className="w-3.5 h-3.5" />}
              loading={saveMut.isPending}
              onClick={onSaveClick}
              disabled={isPaused}
              title={isPaused ? 'Resume the timer to save' : undefined}
            >
              Save
            </Button>
          </div>
        )}
      </div>

      {/* RIGHT — sidebar */}
      {sidebarOpen && (
        <aside className="space-y-4 lg:sticky lg:top-4">
          <UsersPanel chart={chart} />
          <ConversationLog chart={chart} timerRunning={timerRunning} />
          <TimeTracker chartId={chart.id} />
          <AiIcdPrediction
            prediction={liveAiPrediction}
            hasUploadedDocs={uploadedDocs.length > 0 || !!aiPrediction}
            timerRunning={timerRunning}
            onReview={() => setReviewOpen(true)}
            // No running timer → the modal opens as a read-only view (see
            // ReviewEditModal props below), so the button switches to its view
            // affordance instead of disabling. Lets a coder read the auditor's
            // per-code feedback without re-allocating and starting a timer.
            readOnly={qaReadOnly || !timerRunning}
            auditSummary={auditSummary}
          />
          <DocumentationGaps prediction={aiPrediction} />
          <PhysicianQueries prediction={aiPrediction} />
          <CodingFeedback prediction={aiPrediction} />
        </aside>
      )}

      <DocumentViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        docs={uploadedDocs}
        activeId={activeDocId}
        onSelect={setActiveDocId}
        prediction={aiPrediction}
      />

      <ReviewEditModal
        open={reviewOpen}
        onClose={() => {
          setReviewOpen(false);
          // Reflect any draft edits / submission the modal made in the sidebar.
          qc.invalidateQueries({ queryKey: ['chart-code-decision-draft', String(chart.id)] });
          qc.invalidateQueries({ queryKey: ['chart-code-decisions', String(chart.id)] });
          qc.invalidateQueries({ queryKey: ['chart-code-audits', String(chart.id)] });
        }}
        prediction={aiCodes}
        aiCodesSettled={unifiedAi.isSettled}
        docs={uploadedDocs}
        chartId={String(chart.id)}
        clientId={worklistQ.data?.clientId}
        locationId={worklistQ.data?.locationId}
        // Editing (coder board or audit layer) always requires a running
        // timer; without one the modal is a read-only view. This is what lets
        // a coder open an audited chart and see the auditor's feedback.
        readOnly={qaReadOnly || !timerRunning}
        liveDraftUserId={liveDraftUserId}
        audit={isAuditMode && timerRunning}
        onSubmitted={() => setSaveToastOpen(true)}
      />

      {/* QA Live: while watching a coder's chart, pop a toast for each new
          decision they make on THIS chart. */}
      {qaReadOnly && liveDraftUserId != null && (
        <ChartLiveDecisionToasts
          chartId={String(chart.id)}
          coderUserId={liveDraftUserId}
          coderName={liveName}
          onSeeMore={() => setReviewOpen(true)}
        />
      )}

      <ConfirmModal
        open={takeoverOpen}
        onClose={() => setTakeoverOpen(false)}
        onConfirm={() => takeoverMut.mutate()}
        message={takeoverMessage}
        confirmLabel="Self-allocate & open"
        cancelLabel="Cancel"
        variant="primary"
        loading={takeoverMut.isPending}
      />

      <Toast
        open={saveToastOpen}
        message="Successfully saved"
        variant="success"
        onClose={() => setSaveToastOpen(false)}
      />

      <Toast
        open={!!saveError}
        message={saveError ?? ''}
        variant="danger"
        onClose={() => setSaveError(null)}
      />

      <IcdBotWidget />
    </div>
  );
}
