import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  Save,
} from 'lucide-react';
import { getChart, updateChart, getActiveTimer, type UpdateChartDto } from '@/api/charts';
import { getWorklist } from '@/api/worklists';
import { listUsers } from '@/api/users';
import type { AiEncounterResult, Chart, ChartStatus, Priority, UploadedDocument } from '@/api/types';
import { useAuth } from '@/auth/store';
import { Button } from '@/components/ui/Button';
import { HeaderCard } from './chart-detail/HeaderCard';
import { UploadSection } from './chart-detail/UploadSection';
import { ChartInfoSection } from './chart-detail/ChartInfoSection';
import { ProcessingInfoSection } from './chart-detail/ProcessingInfoSection';
import { AuditInfoSection } from './chart-detail/AuditInfoSection';
import { DocumentViewerModal } from './chart-detail/DocumentViewerModal';
import { ReviewEditModal } from './chart-detail/ReviewEditModal';
import { useFormDraft, useAuditDraft, useCustomFieldValues } from './chart-detail/formState';
import { useFieldConfig, STANDARD_FIELD_MAP } from './chart-detail/useFieldConfig';
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

  // Frontend-only draft for the source's wide form. Seed with whatever the
  // current Chart entity carries; everything else is local-only until backend lands.
  const { draft, update: rawUpdate } = useFormDraft({
    chartNo: chart.chartNo ?? '',
    mrNo: chart.mrNumber ?? '',
    dateOfService: chart.dateOfService ?? '',
    dischargeDate: chart.dischargeDate ?? '',
    primaryDiagnosis: chart.primaryDiagnosis ?? '',
    em: chart.emLevel ?? '',
    priority: chart.priority,
    chartStatus:
      chart.chartStatus === 'COMPLETE' ? 'Complete' : chart.chartStatus === 'INCOMPLETE' ? 'Incomplete' : 'Open',
  });
  const { audit, updateAudit: rawUpdateAudit } = useAuditDraft();
  const { values: customValues, updateValue: rawUpdateCustomValue } = useCustomFieldValues(
    (chart.customFields ?? {}) as Record<string, unknown>,
  );

  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Hydrate the ICD-Predictor result + uploaded docs from customFields on first
  // paint, so a page reload after processing keeps the sidebar populated. The
  // upload UI overwrites these with the fresh response after a new run.
  const persisted = chart.customFields as
    | { aiPrediction?: AiEncounterResult; uploadedDocs?: UploadedDocument[] }
    | undefined;
  const [aiPrediction, setAiPrediction] = useState<AiEncounterResult | null>(
    persisted?.aiPrediction ?? null,
  );
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocument[]>(
    persisted?.uploadedDocs ?? [],
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [missingFields, setMissingFields] = useState<string[]>([]);
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
  const isCoderOrAuditor = user?.role === 'CODER' || user?.role === 'AUDITOR';
  const activeTimer = useQuery({
    queryKey: ['active-timer'],
    queryFn: getActiveTimer,
    enabled: isCoderOrAuditor,
  });
  const timerRunning = activeTimer.data?.chartId === chart.id;
  const timerStopped = !timerRunning;
  const auditDisabled = !isAuditor || !timerRunning;

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

  // Allocation pickers in the Processing Info section need real user lists.
  const codersQ = useQuery({
    queryKey: ['users', 'coders'],
    queryFn: () => listUsers({ role: 'CODER', pageSize: 100, status: 'ACTIVE' }),
  });
  const auditorsQ = useQuery({
    queryKey: ['users', 'auditors'],
    queryFn: () => listUsers({ role: 'AUDITOR', pageSize: 100, status: 'ACTIVE' }),
  });
  const coderOpts = (codersQ.data?.items ?? []).map((u) => ({ id: u.id, fullName: u.fullName }));
  const auditorOpts = (auditorsQ.data?.items ?? []).map((u) => ({ id: u.id, fullName: u.fullName }));

  /**
   * Check every field marked MANDATORY in the per-combo config and collect
   * any whose draft slot is empty. Includes custom fields. Returns labels.
   */
  function collectMissingMandatory(): string[] {
    const missing: string[] = [];
    for (const f of STANDARD_FIELD_MAP) {
      if (cfg.getValidation(f.key) !== 'MANDATORY') continue;
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
  const chartStatusForApi: ChartStatus | undefined =
    draft.chartStatus === 'Complete'
      ? 'COMPLETE'
      : draft.chartStatus === 'Incomplete'
      ? 'INCOMPLETE'
      : draft.chartStatus === 'Open'
      ? 'OPEN'
      : undefined;

  const saveMut = useMutation({
    mutationFn: () => {
      const payload: UpdateChartDto = {
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
        customFields: customValues,
      };
      return updateChart(chart.id, payload);
    },
    onSuccess: () => {
      setIsDirty(false);
      qc.invalidateQueries({ queryKey: ['chart', chart.id] });
      qc.invalidateQueries({ queryKey: ['charts'] });
      qc.invalidateQueries({ queryKey: ['active-timer'] });
    },
  });

  function onSaveClick() {
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
          onView={(docId) => {
            setActiveDocId(docId);
            setViewerOpen(true);
          }}
          onProcessed={(result) => {
            setAiPrediction(result);
            setUploadedDocs(result.uploadedDocs);
            // The server stashes the prediction under customFields.aiPrediction;
            // refetch so other consumers (e.g. the milestone state) see it.
            qc.invalidateQueries({ queryKey: ['chart', chart.id] });
          }}
        />

        <ChartInfoSection
          draft={draft}
          update={update}
          readOnly={timerStopped}
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
          readOnly={timerStopped}
          isAuditor={isAuditor}
          cfg={cfg}
          customValues={customValues}
          updateCustomValue={updateCustomValue}
          coders={coderOpts}
          auditors={auditorOpts}
        />
        <AuditInfoSection
          draft={draft}
          update={update}
          audit={audit}
          updateAudit={updateAudit}
          disabled={auditDisabled}
          feedbackTypes={cfg.options.feedbackTypes}
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
      </div>

      {/* RIGHT — sidebar */}
      {sidebarOpen && (
        <aside className="space-y-4 lg:sticky lg:top-4">
          <UsersPanel chart={chart} />
          <ConversationLog chart={chart} timerRunning={timerRunning} />
          <TimeTracker />
          <AiIcdPrediction
            prediction={aiPrediction}
            hasUploadedDocs={uploadedDocs.length > 0 || !!aiPrediction}
            timerRunning={timerRunning}
            onReview={() => setReviewOpen(true)}
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
      />
    </div>
  );
}
