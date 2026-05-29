import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import {
  getWorklist,
  updateWorklist,
  deleteWorklist,
  allocateWorklist,
  runAiOnWorklist,
  clearStuckAiOnWorklist,
  type AllocationRange,
  type CreateWorklistDto,
  type RunAiResult,
} from '@/api/worklists';
import { listUsers } from '@/api/users';
import { bulkDeleteCharts, listCharts } from '@/api/charts';
import type { ApiErrorShape } from '@/api/types';
import { useCan } from '@/hooks/useCan';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, FancySelect, DatePicker, RangeDatePicker } from '@/components/ui/Field';
import { listPrimarySpecialities } from '@/api/configurations';
import { Modal, ModalFooter, Tabs, PillBadge, Avatar, ConfirmModal, Toast } from '@/components/ui/Primitives';
import { WorklistStatusChip, MilestoneChip } from '@/components/ui/Chip';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import {
  ArrowLeft,
  Building2,
  MapPin,
  Stethoscope,
  Cog,
  Pencil,
  Trash2,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
  X as XIcon,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
} from 'lucide-react';
import { BulkUploadWizard } from './BulkUploadWizard';

export function WorklistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [manageChartsOpen, setManageChartsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'activity'>('details');
  const canViewWorklist = useCan('worklist.view');
  const canAllocate = useCan('worklist.allocate');
  const canBulkImport = useCan('worklist.bulkImport');
  const canDeleteCharts = useCan('chart.bulkDelete');

  // Coders never see the entry link on the Charts page; this guard catches the
  // direct-URL path so the worklist detail can't be reached by typing it in.
  if (!canViewWorklist) return <Navigate to="/charts" replace />;

  const { data, isPending } = useQuery({
    queryKey: ['worklist', id],
    queryFn: () => getWorklist(id!),
    enabled: !!id,
    // Auto-refresh while any chart on this worklist is in the AI pipeline —
    // same trigger pattern used on ChartsPage so the progress bar advances
    // without a manual reload. Settles once the queue drains.
    refetchInterval: (query) => {
      const ai = (query.state.data as { aiStatusCounts?: { queued: number; processing: number } } | undefined)
        ?.aiStatusCounts;
      return ai && (ai.queued > 0 || ai.processing > 0) ? 5000 : false;
    },
  });

  if (isPending) {
    return (
      <div className="p-8 flex items-center gap-2 text-ink-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading worklist…
      </div>
    );
  }
  if (!data) return <div className="p-8 text-ink-muted">Not found.</div>;

  const s = data.chartSummary;
  const progressPct = s.total ? (s.closed / s.total) * 100 : 0;

  return (
    <div className="p-8 max-w-[1600px] space-y-6">
      <Link
        to="/worklists"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition mb-2"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to worklists
      </Link>

      <PageHeader title="Worklist details" subtitle="Worklist details" />

      {/* Top row: info / donut / counts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Info card */}
        <Card padding="default" className="lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-ink">
              Worklist #: {data.worklistNumber}
            </h3>
            <WorklistStatusChip status={data.status} />
          </div>

          <div className="space-y-2 text-sm mb-5">
            <MetaRow
              icon={Building2}
              label="Client"
              value={data.client?.name ?? `#${data.clientId}`}
            />
            <MetaRow
              icon={MapPin}
              label="Location"
              value={data.location?.name ?? `#${data.locationId}`}
            />
            <MetaRow
              icon={Stethoscope}
              label="Speciality"
              value={data.primarySpeciality?.name ?? `#${data.primarySpecialityId}`}
            />
            <MetaRow
              icon={Cog}
              label="Process"
              value={data.process?.name ?? `#${data.processId}`}
            />
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-line">
            <StatMini label="Received date" value={formatDate(data.receivedDate)} />
            <StatMini label="Date of service" value={formatDate(data.dateOfService)} />
            <StatMini label="Total charts" value={formatNumber(data.totalCharts)} />
          </div>

          {/* Documents status — makes it explicit when nothing has been uploaded. */}
          <div
            className={cn(
              'mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
              data.documentsCount > 0
                ? 'border-line bg-surface-sunken/40 text-ink'
                : 'border-warn/30 bg-warn-soft/40 text-ink',
            )}
          >
            <FileText className="w-4 h-4 shrink-0 text-ink-muted" />
            {data.documentsCount > 0 ? (
              <span>
                <span className="font-semibold">{formatNumber(data.documentsCount)}</span>{' '}
                document{data.documentsCount === 1 ? '' : 's'} uploaded
              </span>
            ) : (
              <span className="text-ink-muted">No documents uploaded yet</span>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-5">
            <Button onClick={() => setEditOpen(true)} leftIcon={<Pencil className="w-3.5 h-3.5" />}>
              Edit Worklist
            </Button>
            {canBulkImport && (
              <Button
                variant="soft"
                onClick={() => setBulkOpen(true)}
                leftIcon={<Upload className="w-3.5 h-3.5" />}
              >
                Bulk Upload
              </Button>
            )}
            {canDeleteCharts && s.total > 0 && (
              <Button
                variant="soft-danger"
                onClick={() => setManageChartsOpen(true)}
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Manage Charts
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => setDeleteOpen(true)}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Delete Worklist
            </Button>
          </div>
        </Card>

        {/* Donut */}
        <Card padding="default" className="lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <p className="text-2xl font-bold text-ink tracking-tightish">
              {progressPct.toFixed(2)}%
            </p>
          </div>
          <p className="text-xs text-ink-muted mb-4">Worklist progress</p>

          <div className="flex items-center gap-5">
            <ProgressDonut
              segments={[
                { value: s.unallocated, color: '#9CA3AF' },
                { value: s.notStarted, color: '#F87171' },
                { value: s.inProgress, color: '#FFC72C' },
                { value: s.closed, color: '#22C55E' },
              ]}
            />
            <div className="text-sm space-y-1.5">
              <LegendRow color="#9CA3AF" label="Unallocated" value={s.unallocated} />
              <LegendRow color="#F87171" label="Not Started" value={s.notStarted} />
              <LegendRow color="#FFC72C" label="In Progress" value={s.inProgress} />
              <LegendRow color="#22C55E" label="Closed" value={s.closed} />
            </div>
          </div>
        </Card>

        {/* Counts */}
        <Card padding="default" className="lg:col-span-1">
          <h3 className="text-[15px] font-bold text-ink mb-1">Charts</h3>
          <p className="text-xs text-ink-muted mb-5">
            Overall status of charts in this worklist
          </p>
          <div className="grid grid-cols-3 gap-3">
            <BigNum label="Total Charts" value={s.total} tone="success" />
            <BigNum label="Allocated" value={s.allocated} tone="primary" />
            <BigNum label="Unallocated" value={s.unallocated} tone="info" />
          </div>
        </Card>
      </div>

      {/* AI pipeline progress — full-width card */}
      <AiPipelineCard
        ai={data.aiStatusCounts}
        total={s.total}
        documentsCount={data.documentsCount}
        worklistId={id!}
        canRun={canBulkImport}
      />

      {/* Bottom row: Details table + Allocate Fresh Volume */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="none">
          <div className="px-6 pt-5">
            <Tabs
              tabs={[
                { key: 'details', label: 'Details' },
                { key: 'activity', label: 'Activity' },
              ]}
              value={activeTab}
              onChange={(v) => setActiveTab(v as 'details' | 'activity')}
            />
          </div>
          {activeTab === 'details' ? (
            <>
              <DetailsTable summary={s} />
              <AllocationsBreakdown worklistId={id!} />
            </>
          ) : (
            <div className="p-10 text-center text-sm text-ink-muted">
              Activity log coming soon.
            </div>
          )}
        </Card>

        {canAllocate && (
          <AllocateFreshVolume
            worklistId={id!}
            unallocatedCount={s.unallocated}
            totalCharts={s.total}
          />
        )}
      </div>

      <EditWorklistModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        current={data}
      />
      <DeleteWorklistModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        worklistId={id!}
        expectedNumber={data.worklistNumber}
      />
      <BulkUploadWizard
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        worklistId={id!}
        worklistNumber={data.worklistNumber}
        existingChartCount={s.total}
      />
      {canDeleteCharts && (
        <ManageChartsModal
          open={manageChartsOpen}
          onClose={() => setManageChartsOpen(false)}
          worklistId={id!}
        />
      )}
    </div>
  );
}

/* ── Tiny subcomponents ──────────────────────────────────── */

function MetaRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-ink-muted shrink-0" />
      <span className="text-ink-muted">{label}:</span>
      <span className="text-ink font-semibold">{value}</span>
    </div>
  );
}

function StatMini({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{value}</p>
      <p className="text-[11px] text-ink-muted mt-0.5">{label}</p>
    </div>
  );
}

function BigNum({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'primary' | 'info';
}) {
  const textColor = {
    success: 'text-success',
    primary: 'text-primary-ink dark:text-primary',
    info: 'text-info',
  }[tone];
  return (
    <div className="rounded-xl border border-line p-3 text-center">
      <p className={cn('text-3xl font-bold tracking-tightish', textColor)}>
        {formatNumber(value)}
      </p>
      <p className={cn('text-xs font-semibold mt-1', textColor)}>{label}</p>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-ink-muted text-[13px] flex-1">{label}</span>
      <span className="font-mono text-ink text-[13px] tabular-nums ml-6">
        {formatNumber(value)}
      </span>
    </div>
  );
}

/* ── AI pipeline progress card ──────────────────────────── */
function AiPipelineCard({
  ai: aiProp,
  total,
  documentsCount,
  worklistId,
  canRun,
}: {
  ai: Awaited<ReturnType<typeof getWorklist>>['aiStatusCounts'];
  total: number;
  documentsCount: number;
  worklistId: string;
  canRun: boolean;
}) {
  // Fall back to zeros so a stale/partial API response (e.g. a backend build
  // that predates aiStatusCounts) degrades gracefully instead of white-screening.
  const ai = aiProp ?? { queued: 0, processing: 0, done: 0, errored: 0, none: 0 };
  const qc = useQueryClient();
  const [runResult, setRunResult] = useState<RunAiResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearedCount, setClearedCount] = useState<number | null>(null);

  const runMut = useMutation({
    mutationFn: () => runAiOnWorklist(worklistId),
    onSuccess: (r) => {
      setRunResult(r);
      setRunError(null);
      qc.invalidateQueries({ queryKey: ['worklist', worklistId] });
      qc.invalidateQueries({ queryKey: ['charts'] });
    },
    onError: (err) => setRunError((err as unknown as ApiErrorShape).message),
  });

  const clearMut = useMutation({
    mutationFn: () => clearStuckAiOnWorklist(worklistId),
    onSuccess: (r) => {
      setClearedCount(r.cleared);
      setRunError(null);
      qc.invalidateQueries({ queryKey: ['worklist', worklistId] });
      qc.invalidateQueries({ queryKey: ['charts'] });
    },
    onError: (err) => setRunError((err as unknown as ApiErrorShape).message),
  });

  // "Eligible" is a frontend-approximation of the backend filter: charts that
  // exist and haven't been pushed to the AI gateway yet. We can't see per-chart
  // uploadedDocs from the worklist summary, so this is an upper bound — the
  // backend returns the exact count after running.
  const inFlight = ai.queued + ai.processing;
  const processed = ai.done + ai.errored;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const eligibleUpperBound = Math.max(0, total - processed - inFlight);
  const segments = [
    { key: 'done', value: ai.done, color: 'bg-success', label: 'Done', tone: 'text-success' },
    { key: 'processing', value: ai.processing, color: 'bg-warn', label: 'Processing', tone: 'text-warn' },
    { key: 'queued', value: ai.queued, color: 'bg-info', label: 'Queued', tone: 'text-info' },
    { key: 'errored', value: ai.errored, color: 'bg-danger', label: 'Errored', tone: 'text-danger' },
  ];
  // Empty state: no charts at all in worklist, or none has been touched by AI yet.
  const empty = total === 0 || (ai.done + ai.errored + ai.queued + ai.processing === 0);

  return (
    <Card padding="default">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-card bg-primary-soft text-primary-ink dark:text-primary flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-ink leading-tight">AI Pipeline</h3>
            <p className="text-xs text-ink-muted">
              {empty
                ? 'Waiting for the first chart to enter the pipeline'
                : `${formatNumber(processed)} of ${formatNumber(total)} chart${total === 1 ? '' : 's'} processed`}
              {inFlight > 0 && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-warn font-semibold">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {formatNumber(inFlight)} in flight
                </span>
              )}
            </p>
            {/* Documents drive the pipeline — the AI only processes charts that
                have files. Make the available document count explicit here. */}
            <p className="text-xs mt-1 inline-flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 shrink-0 text-ink-muted" />
              {documentsCount > 0 ? (
                <span className="text-ink-muted">
                  <span className="font-semibold text-ink">{formatNumber(documentsCount)}</span>{' '}
                  document{documentsCount === 1 ? '' : 's'} uploaded to feed the AI
                </span>
              ) : (
                <span className="font-medium text-warn">
                  No documents uploaded — nothing for the AI to process yet
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {canRun && inFlight > 0 && (
            <Button
              variant="soft-danger"
              loading={clearMut.isPending}
              onClick={() => setClearConfirmOpen(true)}
              leftIcon={<XIcon className="w-3.5 h-3.5" />}
            >
              Clear stuck queue ({formatNumber(inFlight)})
            </Button>
          )}
          {canRun && eligibleUpperBound > 0 && (
            <Button
              variant="primary"
              loading={runMut.isPending}
              onClick={() => setConfirmOpen(true)}
              leftIcon={<Sparkles className="w-3.5 h-3.5" />}
            >
              Run AI on {formatNumber(eligibleUpperBound)} chart{eligibleUpperBound === 1 ? '' : 's'}
            </Button>
          )}
          <div className="text-right">
            <p
              className="text-3xl font-bold text-ink tracking-tightish tabular-nums leading-none"
              aria-label={`${pct} percent of charts processed`}
            >
              {pct}
              <span className="text-lg text-ink-muted">%</span>
            </p>
            <p className="text-[11px] text-ink-muted mt-1">Processed</p>
          </div>
        </div>
      </div>

      {/* Run-result banner — shown after a manual trigger. Inline; closeable. */}
      {runResult && (
        <RunResultBanner
          result={runResult}
          onDismiss={() => setRunResult(null)}
        />
      )}
      {clearedCount !== null && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2.5 px-3.5 py-3 rounded-card border mb-4 bg-success-soft/40 border-success/30"
        >
          <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {clearedCount === 0
                ? 'Nothing was stuck'
                : `Cleared ${formatNumber(clearedCount)} stuck chart${clearedCount === 1 ? '' : 's'}`}
            </p>
            <p className="text-[11px] text-ink-muted mt-0.5">
              These charts are back to "Not started" — re-run AI when you're ready.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setClearedCount(null)}
            aria-label="Dismiss"
            className="w-6 h-6 rounded-full text-ink-muted hover:bg-surface-sunken flex items-center justify-center shrink-0"
          >
            <XIcon className="w-3 h-3" />
          </button>
        </div>
      )}
      {runError && (
        <div role="alert" className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-danger-soft text-danger border border-danger/30 text-xs mb-4">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{runError}</span>
          <button type="button" onClick={() => setRunError(null)} className="text-danger/70 hover:text-danger" aria-label="Dismiss error">
            <XIcon className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Segmented progress bar — total width = total charts.
          Segments stack visually: Done | Processing | Queued | Errored | Unstarted. */}
      <div
        role="img"
        aria-label={`Pipeline: ${ai.done} done, ${ai.processing} processing, ${ai.queued} queued, ${ai.errored} errored, ${ai.none} not started`}
        className={cn(
          'flex h-2.5 w-full rounded-pill overflow-hidden bg-surface-sunken',
          'ring-1 ring-line/60',
        )}
      >
        {segments.map((seg) => {
          const w = total > 0 ? (seg.value / total) * 100 : 0;
          if (w === 0) return null;
          return (
            <div
              key={seg.key}
              className={cn(seg.color, 'transition-all duration-500 ease-out')}
              style={{ width: `${w}%` }}
              title={`${seg.label}: ${seg.value}`}
            />
          );
        })}
      </div>

      {/* Count tiles row — 4 statuses + Not started */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-5">
        <AiStatTile
          label="Done"
          value={ai.done}
          dotClass="bg-success"
          icon={<CheckCircle2 className="w-3.5 h-3.5 text-success" />}
        />
        <AiStatTile
          label="Processing"
          value={ai.processing}
          dotClass="bg-warn"
          icon={<Loader2 className={cn('w-3.5 h-3.5 text-warn', ai.processing > 0 && 'animate-spin')} />}
        />
        <AiStatTile
          label="Queued"
          value={ai.queued}
          dotClass="bg-info"
        />
        <AiStatTile
          label="Errored"
          value={ai.errored}
          dotClass="bg-danger"
          icon={ai.errored > 0 ? <AlertTriangle className="w-3.5 h-3.5 text-danger" /> : undefined}
        />
        <AiStatTile
          label="Not started"
          value={ai.none}
          dotClass="bg-ink-subtle"
          muted
        />
      </div>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          runMut.mutate();
        }}
        variant="primary"
        message={
          `Trigger AI prediction on every chart in this worklist that has uploaded documents and hasn't been processed yet? ` +
          `Up to ${formatNumber(eligibleUpperBound)} chart${eligibleUpperBound === 1 ? '' : 's'} will be queued.`
        }
        confirmLabel="Start AI run"
        cancelLabel="Cancel"
        loading={runMut.isPending}
      />

      <ConfirmModal
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={() => {
          setClearConfirmOpen(false);
          clearMut.mutate();
        }}
        variant="danger"
        message={
          `Wipe the pending-AI state from ${formatNumber(inFlight)} chart${inFlight === 1 ? '' : 's'} stuck in Queued or Processing? ` +
          `This only resets the local state — any in-flight gateway run is abandoned. You can re-run AI afterwards.`
        }
        confirmLabel="Clear queue"
        cancelLabel="Cancel"
        loading={clearMut.isPending}
      />
    </Card>
  );
}

function RunResultBanner({
  result,
  onDismiss,
}: {
  result: RunAiResult;
  onDismiss: () => void;
}) {
  const skippedByReason = {
    no_documents: result.skipped.filter((s) => s.reason === 'no_documents').length,
    already_done: result.skipped.filter((s) => s.reason === 'already_done').length,
    already_in_flight: result.skipped.filter((s) => s.reason === 'already_in_flight').length,
    gateway_error: result.skipped.filter((s) => s.reason === 'gateway_error').length,
  };
  const reasons = [
    skippedByReason.already_done > 0 && `${skippedByReason.already_done} already processed`,
    skippedByReason.already_in_flight > 0 && `${skippedByReason.already_in_flight} already running`,
    skippedByReason.no_documents > 0 && `${skippedByReason.no_documents} have no documents`,
    skippedByReason.gateway_error > 0 && `${skippedByReason.gateway_error} failed`,
  ].filter(Boolean);
  const hasErrors = skippedByReason.gateway_error > 0;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-2.5 px-3.5 py-3 rounded-card border mb-4',
        hasErrors
          ? 'bg-warn-soft/40 border-warn/30'
          : 'bg-success-soft/40 border-success/30',
      )}
    >
      {hasErrors ? (
        <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
      ) : (
        <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {result.triggered === 0
            ? 'Nothing to queue'
            : `${formatNumber(result.triggered)} chart${result.triggered === 1 ? '' : 's'} queued for AI`}
          {reasons.length > 0 && (
            <span className="font-normal text-ink-muted"> · {reasons.join(' · ')}</span>
          )}
        </p>
        <p className="text-[11px] text-ink-muted mt-0.5">
          Predictions usually finish in 30–180 seconds. The progress bar above will update automatically.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="w-6 h-6 rounded-full text-ink-muted hover:bg-surface-sunken flex items-center justify-center shrink-0"
      >
        <XIcon className="w-3 h-3" />
      </button>
    </div>
  );
}

function AiStatTile({
  label,
  value,
  dotClass,
  icon,
  muted,
}: {
  label: string;
  value: number;
  dotClass: string;
  icon?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface px-3 py-2.5 flex items-center gap-2.5 transition',
        muted && 'bg-surface-sunken/40',
      )}
    >
      <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn('text-lg font-bold leading-none tabular-nums', muted ? 'text-ink-muted' : 'text-ink')}>
          {formatNumber(value)}
        </p>
        <p className="text-[11px] text-ink-muted mt-1 truncate">{label}</p>
      </div>
      {icon && <span className="shrink-0">{icon}</span>}
    </div>
  );
}

function ProgressDonut({ segments }: { segments: Array<{ value: number; color: string }> }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 38;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 100 100" className="w-28 h-28 -rotate-90">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--surface-sunken))" strokeWidth="14" />
      {segments.map((s, i) => {
        const len = (s.value / total) * c;
        const circle = (
          <circle
            key={i}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${len} ${c}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return circle;
      })}
    </svg>
  );
}

/* ── Details table (progress grid) ───────────────────────── */
function DetailsTable({ summary }: { summary: NonNullable<Awaited<ReturnType<typeof getWorklist>>>['chartSummary'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px]">
        <thead>
          <tr>
            <th className="table-head">Progress</th>
            <th className="table-head">Ready to code</th>
            <th className="table-head">Coding in progress</th>
            <th className="table-head">Coding done</th>
            <th className="table-head">Ready to audit</th>
            <th className="table-head">Audit in progress</th>
            <th className="table-head">Audit done</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="table-cell">
              <PillBadge tone="mint">
                Allocated ({formatNumber(summary.allocated)})
              </PillBadge>
            </td>
            <td className="table-cell text-sm">{formatNumber(summary.notStarted)}</td>
            <td className="table-cell text-sm">{formatNumber(summary.inProgress)}</td>
            <td className="table-cell text-sm">—</td>
            <td className="table-cell text-sm">—</td>
            <td className="table-cell text-sm">—</td>
            <td className="table-cell text-sm">{formatNumber(summary.closed)}</td>
          </tr>
          <tr>
            <td className="table-cell">
              <PillBadge tone="sky">
                Unallocated ({formatNumber(summary.unallocated)})
              </PillBadge>
            </td>
            <td className="table-cell text-sm">—</td>
            <td className="table-cell text-sm">—</td>
            <td className="table-cell text-sm">—</td>
            <td className="table-cell text-sm">—</td>
            <td className="table-cell text-sm">—</td>
            <td className="table-cell text-sm">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ── Allocate Fresh Volume panel ─────────────────────────── */
interface AllocationForm {
  ranges: Array<{ from: number; to: number; assigneeId: number }>;
}

function AllocateFreshVolume({
  worklistId,
  unallocatedCount,
  totalCharts,
}: {
  worklistId: string;
  unallocatedCount: number;
  totalCharts: number;
}) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['users', 'coders-list'],
    queryFn: () => listUsers({ pageSize: 100 }),
  });

  const { control, register, handleSubmit, reset } = useForm<AllocationForm>({
    defaultValues: { ranges: [{ from: 1, to: 1, assigneeId: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'ranges' });

  const allocateMutation = useMutation({
    mutationFn: (ranges: AllocationRange[]) => allocateWorklist(worklistId, ranges),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worklist', worklistId] });
      reset();
    },
    onError: (err) => setServerError((err as unknown as ApiErrorShape).message),
  });

  return (
    <Card padding="default">
      <h3 className="text-[15px] font-bold text-ink mb-1">Allocate Fresh Volume</h3>
      <p className="text-xs text-ink-muted mb-4">
        Select serial numbers &amp; user to assign volume
      </p>

      <div className="rounded-xl bg-danger-soft/60 border border-dashed border-danger/40 p-4 mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-danger" />
          <span className="text-sm font-semibold text-ink">
            Volume available for allocation
          </span>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-danger">
            {formatNumber(unallocatedCount)}
          </p>
          <p className="text-[11px] text-danger font-semibold">Remaining</p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit((d) => {
          setServerError(null);
          allocateMutation.mutate(
            d.ranges.map((r) => ({
              from: Number(r.from),
              to: Number(r.to),
              assigneeId: Number(r.assigneeId),
              role: 'CODER' as const,
            })),
          );
        })}
        className="space-y-3"
      >
        {serverError && (
          <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger border border-danger/30">
            {serverError}
          </div>
        )}

        {fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end">
            <div>
              {i === 0 && (
                <Label className="text-[11px]">
                  From {totalCharts > 0 && <span className="text-ink-subtle font-normal">(1–{totalCharts})</span>}
                </Label>
              )}
              <Input
                type="number"
                min={1}
                max={totalCharts > 0 ? totalCharts : undefined}
                placeholder="From"
                {...register(`ranges.${i}.from`, { valueAsNumber: true, required: true, min: 1 })}
              />
            </div>
            <div>
              {i === 0 && (
                <Label className="text-[11px]">
                  To {totalCharts > 0 && <span className="text-ink-subtle font-normal">(1–{totalCharts})</span>}
                </Label>
              )}
              <Input
                type="number"
                min={1}
                max={totalCharts > 0 ? totalCharts : undefined}
                placeholder="To"
                {...register(`ranges.${i}.to`, { valueAsNumber: true, required: true, min: 1 })}
              />
            </div>
            <div>
              {i === 0 && <Label className="text-[11px]">Assign to</Label>}
              <Controller
                control={control}
                name={`ranges.${i}.assigneeId`}
                render={({ field }) => (
                  <FancySelect
                    placeholder={users.isPending ? 'Loading…' : 'Select coder'}
                    value={field.value ? String(field.value) : ''}
                    onChange={(v) => field.onChange(Number(v))}
                    options={(users.data?.items ?? []).map((u) => ({
                      value: String(u.id),
                      label: u.fullName,
                    }))}
                  />
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={fields.length === 1}
              className="w-10 h-10 rounded-full bg-danger-soft text-danger hover:bg-danger/20 transition flex items-center justify-center disabled:opacity-30"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="soft"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => append({ from: 1, to: 1, assigneeId: 0 })}
          >
            Add another
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => reset({ ranges: [{ from: 1, to: 1, assigneeId: 0 }] })}
            >
              Clear
            </Button>
            <Button type="submit" loading={allocateMutation.isPending}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/* ── Edit Worklist modal ──────────────────────────────
 * Only the worklist's own editable fields are exposed. Client / Location /
 * Process are deliberately read-only here — changing the client of a worklist
 * that already has allocated charts cascades into AI prediction scope and
 * billing buckets, so it isn't a single-modal operation. `numberOfCharts` was
 * removed because it isn't a column on the worklist (the table only stores
 * `total_charts`, which is a counter maintained by chart inserts/deletes) —
 * sending it had no effect and made the form misleading. */
function EditWorklistModal({
  open,
  onClose,
  current,
}: {
  open: boolean;
  onClose: () => void;
  current: NonNullable<Awaited<ReturnType<typeof getWorklist>>>;
}) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<Partial<CreateWorklistDto>>({
    defaultValues: {
      worklistNumber: current.worklistNumber,
      primarySpecialityId: current.primarySpecialityId,
      receivedDate: current.receivedDate,
      dateOfService: current.dateOfService ?? undefined,
      dateOfServiceTo: current.dateOfServiceTo ?? undefined,
    },
  });

  // Specialities are scoped per-client; an edit can only re-pick within the
  // worklist's existing client (changing client itself is intentionally
  // disallowed above).
  const specialitiesQ = useQuery({
    queryKey: ['configurations', 'primary-specialities', current.clientId],
    queryFn: () => listPrimarySpecialities(current.clientId),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: (dto: Partial<CreateWorklistDto>) => updateWorklist(current.id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worklist', current.id] });
      qc.invalidateQueries({ queryKey: ['worklists'] });
      onClose();
    },
    onError: (err) => {
      const e = err as any;
      setServerError(
        e?.response?.data?.error?.message ??
          (e as unknown as ApiErrorShape)?.message ??
          'Failed to update the worklist.',
      );
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Edit Worklist" size="lg">
      <form
        onSubmit={handleSubmit((d) => {
          setServerError(null);
          mutation.mutate({
            worklistNumber: typeof d.worklistNumber === 'string' ? d.worklistNumber.trim() : d.worklistNumber,
            primarySpecialityId: d.primarySpecialityId ? Number(d.primarySpecialityId) : undefined,
            receivedDate: d.receivedDate,
            dateOfService: d.dateOfService || undefined,
            dateOfServiceTo: d.dateOfServiceTo || undefined,
          });
        })}
        className="space-y-4"
      >
        {serverError && (
          <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger border border-danger/30">
            {serverError}
          </div>
        )}

        {/* Scope panel — read-only context so the editor can confirm what
            they're touching without an extra page round-trip. */}
        <div className="rounded-lg border border-line bg-surface-sunken/30 p-3">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-2">
            Scope (cannot be changed here)
          </p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <ReadOnlyField label="Client" value={current.client?.name ?? '—'} />
            <ReadOnlyField label="Location" value={current.location?.name ?? '—'} />
            <ReadOnlyField label="Process" value={current.process?.name ?? '—'} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Worklist #</Label>
            <Input
              placeholder="e.g. 19309A"
              error={errors.worklistNumber?.message}
              {...register('worklistNumber', { required: 'Required' })}
            />
          </div>
          <div>
            <Label required>Received Date</Label>
            <input type="hidden" {...register('receivedDate', { required: 'Required' })} />
            <DatePicker
              value={watch('receivedDate') ?? ''}
              onChange={(v) => setValue('receivedDate', v, { shouldValidate: true })}
              placeholder="Select received date"
              max={new Date().toISOString().slice(0, 10)}
            />
            {errors.receivedDate && (
              <p className="mt-1 text-xs text-danger">{errors.receivedDate.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Primary Speciality</Label>
            <input
              type="hidden"
              {...register('primarySpecialityId', { required: 'Required', valueAsNumber: true })}
            />
            <FancySelect
              value={watch('primarySpecialityId') ? String(watch('primarySpecialityId')) : ''}
              placeholder={specialitiesQ.isPending ? 'Loading…' : 'Select speciality'}
              options={(specialitiesQ.data?.items ?? []).map((s) => ({
                value: String(s.id),
                label: s.name,
              }))}
              onChange={(v) => setValue('primarySpecialityId', Number(v), { shouldValidate: true })}
            />
            {errors.primarySpecialityId && (
              <p className="mt-1 text-xs text-danger">{errors.primarySpecialityId.message}</p>
            )}
          </div>
          <div>
            <Label>Date of Service</Label>
            <input type="hidden" {...register('dateOfService')} />
            <input type="hidden" {...register('dateOfServiceTo')} />
            <RangeDatePicker
              value={{
                from: watch('dateOfService') ?? null,
                to: watch('dateOfServiceTo') ?? null,
              }}
              onChange={({ from, to }) => {
                setValue('dateOfService', from ?? undefined);
                setValue('dateOfServiceTo', to ?? undefined);
              }}
              placeholder="Optional — pick a service-date range"
            />
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save changes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-subtle">{label}</p>
      <p className="text-sm font-semibold text-ink truncate">{value}</p>
    </div>
  );
}

/* ── Manage Charts modal — multi-select + bulk delete ──────
 * Lists every chart in the worklist with checkboxes, a chart-number search,
 * and a Delete-selected action that fans out to the bulk-delete endpoint.
 * Soft-delete only on the backend, so the operation is recoverable by DBA
 * if a wrong selection slips through — but we still confirm before issuing
 * the call. */
function ManageChartsModal({
  open,
  onClose,
  worklistId,
}: {
  open: boolean;
  onClose: () => void;
  worklistId: string;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Reset the modal's transient state every time it reopens so a previous
  // session's selection / search doesn't carry over.
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelected(new Set());
      setError(null);
    }
  }, [open]);

  const chartsQ = useQuery({
    queryKey: ['worklist', worklistId, 'manage-charts'],
    queryFn: () => fetchAllCharts(worklistId),
    enabled: open && !!worklistId,
  });

  const charts = chartsQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return charts;
    return charts.filter((c) => {
      const chartNo = (c.chartNo ?? '').toLowerCase();
      const mr = (c.mrNumber ?? '').toLowerCase();
      const serial = String(c.serialNo);
      return chartNo.includes(q) || mr.includes(q) || serial.includes(q);
    });
  }, [charts, search]);

  const allFilteredIds = filtered.map((c) => c.id);
  const allFilteredSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));
  const someFilteredSelected =
    allFilteredIds.some((id) => selected.has(id)) && !allFilteredSelected;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        allFilteredIds.forEach((id) => next.delete(id));
      } else {
        allFilteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  const mutation = useMutation({
    mutationFn: () => bulkDeleteCharts([...selected].map(Number)),
    onSuccess: (res) => {
      const n = res?.deleted ?? selected.size;
      setToast(`Deleted ${n} chart${n === 1 ? '' : 's'}.`);
      setConfirmOpen(false);
      // Invalidate every surface that reads chart counts so the page,
      // sidebars, dashboards, and charts list all reflect the deletion.
      qc.invalidateQueries({ queryKey: ['worklist', worklistId] });
      qc.invalidateQueries({ queryKey: ['worklist', worklistId, 'manage-charts'] });
      qc.invalidateQueries({ queryKey: ['worklist', worklistId, 'charts-allocations'] });
      qc.invalidateQueries({ queryKey: ['worklists'] });
      qc.invalidateQueries({ queryKey: ['charts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setSelected(new Set());
    },
    onError: (err) => {
      const e = err as any;
      setError(
        e?.response?.data?.error?.message ??
          (e as unknown as ApiErrorShape)?.message ??
          'Failed to delete the selected charts.',
      );
      setConfirmOpen(false);
    },
  });

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Manage charts"
        subtitle={`${charts.length} chart${charts.length === 1 ? '' : 's'} in this worklist`}
        size="xl"
      >
        <div className="space-y-3">
          {error && (
            <div className="text-xs px-3 py-2 rounded-lg bg-danger-soft text-danger border border-danger/30">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search by chart #, MR #, or serial #"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="text-xs text-ink-muted whitespace-nowrap">
              {selected.size > 0
                ? `${selected.size} selected`
                : `${filtered.length} shown`}
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={selected.size === 0 || mutation.isPending}
              onClick={() => {
                setError(null);
                setConfirmOpen(true);
              }}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Delete selected
            </Button>
          </div>

          <div className="border border-line rounded-xl overflow-hidden">
            <div className="max-h-[420px] overflow-y-auto">
              {chartsQ.isPending ? (
                <div className="p-10 flex items-center justify-center text-ink-muted">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : chartsQ.isError ? (
                <div className="p-10 text-center text-sm text-danger">
                  Couldn't load charts: {(chartsQ.error as Error).message}
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-10 text-center text-sm text-ink-muted">
                  {charts.length === 0 ? 'No charts in this worklist.' : 'No charts match your search.'}
                </div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-surface z-10">
                    <tr>
                      <th className="table-head w-10">
                        <input
                          type="checkbox"
                          className="checkbox"
                          aria-label={allFilteredSelected ? 'Clear selection' : 'Select all visible'}
                          checked={allFilteredSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someFilteredSelected;
                          }}
                          onChange={toggleAllFiltered}
                        />
                      </th>
                      <th className="table-head">#</th>
                      <th className="table-head">Chart #</th>
                      <th className="table-head">MR #</th>
                      <th className="table-head">Milestone</th>
                      <th className="table-head">Coder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const isSel = selected.has(c.id);
                      return (
                        <tr
                          key={c.id}
                          className={cn(
                            'border-t border-line cursor-pointer transition',
                            isSel ? 'bg-danger-soft/30' : 'hover:bg-surface-sunken/40',
                          )}
                          onClick={() => toggleOne(c.id)}
                        >
                          <td className="table-cell">
                            <input
                              type="checkbox"
                              className="checkbox"
                              checked={isSel}
                              onChange={() => toggleOne(c.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select chart ${c.chartNo ?? c.serialNo}`}
                            />
                          </td>
                          <td className="table-cell text-xs text-ink-muted tabular-nums">{c.serialNo}</td>
                          <td className="table-cell font-semibold text-ink">{c.chartNo ?? '—'}</td>
                          <td className="table-cell text-ink-muted">{c.mrNumber ?? '—'}</td>
                          <td className="table-cell text-xs">
                            <MilestoneChip milestone={c.milestone} />
                          </td>
                          <td className="table-cell text-ink-muted text-sm">
                            {c.allocatedCoderName ?? <span className="text-ink-subtle">Unallocated</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <ModalFooter>
            <Button variant="ghost" type="button" onClick={onClose} disabled={mutation.isPending}>
              Close
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate()}
        variant="danger"
        confirmLabel="Delete charts"
        loading={mutation.isPending}
        message={`Delete ${selected.size} chart${selected.size === 1 ? '' : 's'} from this worklist? This soft-deletes the charts (their docs, decisions, and AI history are kept) and reduces the worklist's totals immediately.`}
      />

      <Toast
        open={!!toast}
        message={toast ?? ''}
        variant="success"
        onClose={() => setToast(null)}
      />
    </>
  );
}

/* ── Delete Worklist modal — type-to-confirm ──────────── */
function DeleteWorklistModal({
  open,
  onClose,
  worklistId,
  expectedNumber,
}: {
  open: boolean;
  onClose: () => void;
  worklistId: string;
  expectedNumber: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => deleteWorklist(worklistId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worklists'] });
      navigate('/worklists');
    },
    onError: (err) => setError((err as unknown as ApiErrorShape).message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Delete Worklist" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          Type the Worklist ID to confirm. This action cannot be undone.
        </p>
        <div>
          <Label required>Worklist Id</Label>
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={expectedNumber} />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={input !== expectedNumber}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Delete Worklist
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

/* ── Allocations breakdown — per-user serial-number list ─── */

/**
 * Compresses [1,2,3,5,7,8] → "1–3, 5, 7–8" so we don't dump 200 numbers verbatim.
 */
function formatRanges(serials: number[]): string {
  if (serials.length === 0) return '—';
  const sorted = [...serials].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return out.join(', ');
}

/**
 * Fetch every chart in the worklist, paginating in chunks of 200 (the backend
 * cap). This is fine for worklists up to a few thousand charts.
 */
async function fetchAllCharts(worklistId: string) {
  const PAGE_SIZE = 200;
  type Item = Awaited<ReturnType<typeof listCharts>>['items'][number];
  const all: Item[] = [];
  let page = 1;
  while (true) {
    const res = await listCharts({
      worklistId,
      page,
      pageSize: PAGE_SIZE,
      sortBy: 'serialNo',
      sortDir: 'asc',
    });
    all.push(...res.items);
    if (res.items.length < PAGE_SIZE || all.length >= res.total) break;
    page += 1;
  }
  return all;
}

async function fetchAllActiveUsers() {
  const PAGE_SIZE = 200;
  type Item = Awaited<ReturnType<typeof listUsers>>['items'][number];
  const all: Item[] = [];
  let page = 1;
  while (true) {
    const res = await listUsers({ page, pageSize: PAGE_SIZE, status: 'ACTIVE' });
    all.push(...res.items);
    if (res.items.length < PAGE_SIZE || all.length >= res.total) break;
    page += 1;
  }
  return all;
}

function AllocationsBreakdown({ worklistId }: { worklistId: string }) {
  const charts = useQuery({
    queryKey: ['worklist', worklistId, 'charts-allocations'],
    queryFn: () => fetchAllCharts(worklistId),
    enabled: !!worklistId,
  });

  // Map allocated user IDs → fullName so we can label rows.
  const users = useQuery({
    queryKey: ['users', 'all-active'],
    queryFn: fetchAllActiveUsers,
  });
  const userMap = new Map<string, string>();
  for (const u of users.data ?? []) userMap.set(u.id, u.fullName);

  // Group by allocated coder. Charts assigned to neither a coder nor an auditor
  // are unallocated. (If you allocate auditors directly, extend this grouping.)
  const groups = new Map<string, number[]>();
  const unallocated: number[] = [];
  for (const c of charts.data ?? []) {
    if (c.allocatedCoderId) {
      const k = String(c.allocatedCoderId);
      const arr = groups.get(k) ?? [];
      arr.push(c.serialNo);
      groups.set(k, arr);
    } else {
      unallocated.push(c.serialNo);
    }
  }

  return (
    <div className="px-6 py-5 border-t border-line">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
        Chart allocations
      </p>
      {charts.isPending ? (
        <div className="h-10 rounded bg-surface-sunken animate-pulse" />
      ) : charts.error ? (
        <p className="text-xs text-danger">
          Couldn't load charts: {(charts.error as Error).message}
        </p>
      ) : (charts.data?.length ?? 0) === 0 ? (
        <p className="text-xs text-ink-muted">No charts in this worklist yet.</p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr>
              <th className="table-head">Assignee</th>
              <th className="table-head">Charts</th>
              <th className="table-head text-right pr-4">Count</th>
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([userId, serials]) => {
              const name = userMap.get(userId) ?? `User ${userId}`;
              return (
                <tr key={userId} className="border-t border-line">
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <Avatar name={name} size="sm" />
                      <span className="text-sm font-semibold text-ink">{name}</span>
                    </div>
                  </td>
                  <td className="table-cell text-sm font-mono text-ink-muted">
                    {formatRanges(serials)}
                  </td>
                  <td className="table-cell text-sm text-ink text-right pr-4 font-semibold">
                    {serials.length}
                  </td>
                </tr>
              );
            })}
            {unallocated.length > 0 && (
              <tr className="border-t border-line">
                <td className="table-cell">
                  <PillBadge tone="sky">Unallocated</PillBadge>
                </td>
                <td className="table-cell text-sm font-mono text-ink-muted">
                  {formatRanges(unallocated)}
                </td>
                <td className="table-cell text-sm text-ink text-right pr-4 font-semibold">
                  {unallocated.length}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
