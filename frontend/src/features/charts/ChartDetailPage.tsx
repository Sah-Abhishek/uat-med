import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  Save,
} from 'lucide-react';
import {
  getChart,
  listCodeDecisions,
  updateChart,
  getActiveTimer,
  type CodeDecisionRecord,
  type UpdateChartDto,
} from '@/api/charts';
import type { AiPredictedCode } from '@/api/types';
import { getWorklist } from '@/api/worklists';
import { listUsers } from '@/api/users';
import { getFeedbackCategories } from '@/api/configurations';
import { AUDIT_ROWS } from './chart-detail/shared';
import type { AiEncounterResult, Chart, ChartStatus, Priority, UploadedDocument } from '@/api/types';
import { useAuth } from '@/auth/store';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Primitives';
import { HeaderCard } from './chart-detail/HeaderCard';
import { UploadSection } from './chart-detail/UploadSection';
import { ChartInfoSection } from './chart-detail/ChartInfoSection';
import { ProcessingInfoSection } from './chart-detail/ProcessingInfoSection';
import { AuditInfoSection } from './chart-detail/AuditInfoSection';
import { DocumentViewerModal } from './chart-detail/DocumentViewerModal';
import { ReviewEditModal } from './chart-detail/ReviewEditModal';
import { useFormDraft, useAuditDraft, useCustomFieldValues, EMPTY_FORM_DRAFT, type FormDraft } from './chart-detail/formState';
import { useFieldConfig, STANDARD_FIELD_MAP, isFieldDisabledByStatus } from './chart-detail/useFieldConfig';
import { ChartDetailSkeleton } from './chart-detail/ChartDetailSkeleton';
import { UsersPanel } from './chart-detail/sidebar/UsersPanel';
import { ConversationLog } from './chart-detail/sidebar/ConversationLog';
import { TimeTracker } from './chart-detail/sidebar/TimeTracker';
import { AiIcdPrediction } from './chart-detail/sidebar/AiIcdPrediction';
import { DocumentationGaps } from './chart-detail/sidebar/DocumentationGaps';
import { PhysicianQueries } from './chart-detail/sidebar/PhysicianQueries';
import { CodingFeedback } from './chart-detail/sidebar/CodingFeedback';

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
        <Button variant="primary" leftIcon={<ChevronLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/charts')}>
          Previous Chart
        </Button>
        <Button variant="primary" rightIcon={<ChevronRight className="w-3.5 h-3.5" />} onClick={() => navigate('/charts')}>
          Next Chart
        </Button>
      </div>

      {chart ? <ChartDetailBody chart={chart} /> : <ChartDetailSkeleton />}
    </div>
  );
}

/* ── Body — owns shared form state ───────────────────────── */

function ChartDetailBody({ chart }: { chart: Chart }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isAuditor = user?.role === 'AUDITOR';

  // Frontend-only draft for the source's wide form. Seed with everything the
  // server persists for this chart so the auditor opens with the coder's saved
  // edits already prefilled (admit/discharge dates, comments, DRG, allocations).
  // Fields that don't have dedicated entity columns (disposition, facility,
  // POA, LOS, sub-speciality, etc.) live under customFields._formDraft per the
  // backend DTO's escape-hatch comment.
  const formDraftStash = (chart.customFields as { _formDraft?: Partial<FormDraft> } | undefined)?._formDraft ?? {};
  const { draft, update: rawUpdate, setDraft } = useFormDraft({
    chartNo: chart.chartNo ?? '',
    mrNo: chart.mrNumber ?? '',
    dateOfService: chart.dateOfService ?? '',
    admitDate: chart.admitDate ?? '',
    dischargeDate: chart.dischargeDate ?? '',
    primaryDiagnosis: chart.primaryDiagnosis ?? '',
    em: chart.emLevel ?? '',
    // Prefer the _formDraft string (preserves whatever the user typed, even
    // non-numeric) over the entity column. Falls back to the column for older
    // charts saved before drgValue was added to the formDraft blob.
    drgValue:
      typeof formDraftStash.drgValue === 'string'
        ? formDraftStash.drgValue
        : chart.drgValue != null
        ? String(chart.drgValue)
        : '',
    coderComments: chart.coderCommentsToClient ?? '',
    rejectionComments: chart.rejectionDenialComments ?? '',
    deficiencyComments: chart.deficiencyComments ?? '',
    allocateCoder: chart.allocatedCoderId ?? '',
    allocateAuditor: chart.allocatedAuditorId ?? '',
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
    responsibleParty: Array.isArray(formDraftStash.responsibleParty) ? formDraftStash.responsibleParty : [],
    holdReason: Array.isArray(formDraftStash.holdReason) ? formDraftStash.holdReason : [],
    auditOption: Array.isArray(formDraftStash.auditOption) ? formDraftStash.auditOption : [],
    qcStatus: typeof formDraftStash.qcStatus === 'string' ? formDraftStash.qcStatus : '',
  });
  const { audit, updateAudit: rawUpdateAudit } = useAuditDraft();
  const { values: customValues, updateValue: rawUpdateCustomValue } = useCustomFieldValues(
    (chart.customFields ?? {}) as Record<string, unknown>,
  );

  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // QA mode: opened from the Team Lead's QA dashboard via `?qa=1`. Renders
  // every section in read-only — no save, no review-submit, no field edits.
  const [searchParams] = useSearchParams();
  const qaReadOnly = searchParams.get('qa') === '1';

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
  const liveAiPrediction: AiEncounterResult | null = useMemo(() => {
    if (!aiPrediction) return null;
    const decisions = decisionsQ.data?.items ?? [];
    if (decisions.length === 0) return aiPrediction;
    const decisionByKey = new Map<string, CodeDecisionRecord>();
    for (const d of decisions) decisionByKey.set(`${d.codeType}|${d.codeValue}`, d);
    const dedup = (arr: AiPredictedCode[]) => {
      const seen = new Set<string>();
      return arr.filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)));
    };
    const apply = (codes: AiPredictedCode[], codeType: string): AiPredictedCode[] => {
      const out: AiPredictedCode[] = [];
      for (const c of codes) {
        const d = decisionByKey.get(`${codeType}|${c.code}`);
        if (!d) { out.push(c); continue; }
        if (d.decision === 'REJECTED') continue; // hide rejected
        if (d.decision === 'EDITED') {
          out.push({
            ...c,
            code: d.editedCode ?? c.code,
            description: d.editedDescription ?? c.description,
          });
          continue;
        }
        out.push(c); // ACCEPTED: show as-is
      }
      return out;
    };
    const addedFor = (codeType: string): AiPredictedCode[] =>
      decisions
        .filter((d) => d.decision === 'ADDED' && d.codeType === codeType)
        .map((d) => ({
          code: d.editedCode ?? d.codeValue,
          description: d.editedDescription ?? '',
        }));
    const primary = dedup([...apply(aiPrediction.primary, 'PRIMARY'), ...addedFor('PRIMARY')]);
    const secondary = dedup([...apply(aiPrediction.secondary, 'SECONDARY'), ...addedFor('SECONDARY')]);
    const procedures = dedup([
      ...apply(aiPrediction.procedures, 'PROCEDURE'),
      ...addedFor('PROCEDURE'),
    ]);
    return {
      ...aiPrediction,
      primary,
      secondary,
      procedures,
      codes: [...primary, ...secondary, ...procedures],
    };
  }, [aiPrediction, decisionsQ.data]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [saveToastOpen, setSaveToastOpen] = useState(false);
  // Track unsaved edits so we can block "Stop timer" until the user saves.
  const [isDirty, setIsDirty] = useState(false);

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

  // Real timer state — only true when this user has an active timer ticking
  // on this specific chart. Milestone alone is unreliable (it stays at
  // CODING_IN_PROGRESS after Stop, so we can't infer "is the timer running"
  // from it). Shares the cache key used by HeaderCard's TimerPanel.
  const isTeamLead = user?.role === 'TEAMLEAD';
  const canTime = user?.role === 'CODER' || user?.role === 'AUDITOR' || isTeamLead;
  const activeTimer = useQuery({
    queryKey: ['active-timer'],
    queryFn: getActiveTimer,
    enabled: canTime,
  });
  const timerRunning = activeTimer.data?.chartId === chart.id;
  const timerStopped = !timerRunning;
  // Team leads can audit in addition to coding; only block the audit section
  // when the viewer is neither role and the timer is off.
  const auditDisabled = !(isAuditor || isTeamLead) || !timerRunning;

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
      em: chart.emLevel ?? '',
      drgValue:
        typeof stash.drgValue === 'string'
          ? stash.drgValue
          : chart.drgValue != null
          ? String(chart.drgValue)
          : '',
      coderComments: chart.coderCommentsToClient ?? '',
      rejectionComments: chart.rejectionDenialComments ?? '',
      deficiencyComments: chart.deficiencyComments ?? '',
      allocateCoder: chart.allocatedCoderId ?? '',
      allocateAuditor: chart.allocatedAuditorId ?? '',
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
      responsibleParty: Array.isArray(stash.responsibleParty) ? stash.responsibleParty : [],
      holdReason: Array.isArray(stash.holdReason) ? stash.holdReason : [],
      auditOption: Array.isArray(stash.auditOption) ? stash.auditOption : [],
      qcStatus: typeof stash.qcStatus === 'string' ? stash.qcStatus : '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.id, chart.updatedAt]);

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
  const feedbackOptionsByRow = (() => {
    const map: Record<string, string[]> = {};
    const areas = feedbackCategoriesQ.data?.areas ?? [];
    const norm = (s: string) => s.trim().toLowerCase();
    for (const row of AUDIT_ROWS) {
      const match = areas.find((a) => norm(a.name) === norm(row.label));
      map[row.key] = match ? match.reasons.map((r) => r.name).filter(Boolean) : [];
    }
    return map;
  })();

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
    .map((u) => ({ id: u.id, fullName: u.fullName }));
  const auditorOpts = (auditorsQ.data?.items ?? [])
    .filter((u) => String(u.id) !== String(user?.id))
    .map((u) => ({ id: u.id, fullName: u.fullName }));

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
      const formDraftBlob: Partial<FormDraft> = {
        disposition: draft.disposition,
        primaryHealth: draft.primaryHealth,
        facility: draft.facility,
        subSpecialty: draft.subSpecialty,
        poa: draft.poa,
        los: draft.los,
        // Mirror the typed string so even non-numeric input round-trips.
        // The numeric `drgValue` column below still gets the parsed number
        // when valid, keeping reports/queries that read the column happy.
        drgValue: draft.drgValue,
        procedureCode: draft.procedureCode,
        responsibleParty: draft.responsibleParty,
        holdReason: draft.holdReason,
        auditOption: draft.auditOption,
        qcStatus: draft.qcStatus,
      };
      const payload: UpdateChartDto = {
        chartNo: draft.chartNo || undefined,
        mrNumber: draft.mrNo || undefined,
        priority: (draft.priority || chart.priority) as Priority,
        chartStatus: chartStatusForApi,
        primaryDiagnosis: draft.primaryDiagnosis || undefined,
        emLevel: draft.em || undefined,
        coderCommentsToClient: draft.coderComments || undefined,
        rejectionDenialComments: draft.rejectionComments || undefined,
        deficiencyComments: draft.deficiencyComments || undefined,
        admitDate: draft.admitDate || undefined,
        dischargeDate: draft.dischargeDate || undefined,
        dos: draft.dateOfService || undefined,
        drgValue: draft.drgValue ? parseFloat(draft.drgValue) || undefined : undefined,
        // Drives the milestone state machine: backend keeps the chart in
        // CODING_IN_PROGRESS / AUDIT_IN_PROGRESS when these are set, otherwise
        // advances to CODING_DONE / AUDIT_DONE.
        allocatedCoderId: draft.allocateCoder ? Number(draft.allocateCoder) : undefined,
        allocatedAuditorId: draft.allocateAuditor ? Number(draft.allocateAuditor) : undefined,
        customFields: { ...customValues, _formDraft: formDraftBlob },
      };
      return updateChart(chart.id, payload);
    },
    onSuccess: () => {
      setIsDirty(false);
      setSaveToastOpen(true);
      qc.invalidateQueries({ queryKey: ['chart', chart.id] });
      qc.invalidateQueries({ queryKey: ['charts'] });
      qc.invalidateQueries({ queryKey: ['active-timer'] });
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
        <HeaderCard chart={chart} canStop={!isDirty} />

        <UploadSection
          chartId={chart.id}
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
        />

        <ChartInfoSection
          draft={draft}
          update={update}
          readOnly={timerStopped || qaReadOnly}
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
          readOnly={timerStopped || qaReadOnly}
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
          feedbackTypes={cfg.options.feedbackTypes}
          feedbackOptionsByRow={feedbackOptionsByRow}
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
          <TimeTracker />
          <AiIcdPrediction
            prediction={liveAiPrediction}
            hasUploadedDocs={uploadedDocs.length > 0 || !!aiPrediction}
            timerRunning={timerRunning}
            onReview={() => setReviewOpen(true)}
            readOnly={qaReadOnly}
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
        onClose={() => setReviewOpen(false)}
        prediction={aiPrediction}
        docs={uploadedDocs}
        chartId={String(chart.id)}
        clientId={worklistQ.data?.clientId}
        locationId={worklistQ.data?.locationId}
        readOnly={qaReadOnly}
        onSubmitted={() => setSaveToastOpen(true)}
      />

      <Toast
        open={saveToastOpen}
        message="Successfully saved"
        variant="success"
        onClose={() => setSaveToastOpen(false)}
      />
    </div>
  );
}
