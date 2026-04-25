import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getChart,
  updateChart,
  startChart,
  stopChart,
  transitionChart,
  listChartFeedback,
  addChartFeedback,
  updateChartFeedback,
  type UpdateChartDto,
} from '@/api/charts';
import type {
  ApiErrorShape,
  Chart,
  ChartMilestone,
  ChartStatus,
  FeedbackStatus,
  Priority,
} from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CollapsibleCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Primitives';
import { ChartStatusChip, MilestoneChip, PriorityChip } from '@/components/ui/Chip';
import { useAuth } from '@/auth/store';
import { formatDate, formatDateTime } from '@/lib/utils';
import {
  ArrowLeft,
  Play,
  Square,
  Save,
  ChevronRight,
  ChevronLeft as ChevronLeftIcon,
  Loader2,
  MessageSquarePlus,
  CheckCircle2,
} from 'lucide-react';

export function ChartDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: chart, isPending } = useQuery({
    queryKey: ['chart', id],
    queryFn: () => getChart(id!),
    enabled: !!id,
  });

  if (isPending)
    return (
      <div className="p-8 flex items-center gap-2 text-ink-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading chart…
      </div>
    );
  if (!chart) return <div className="p-8 text-ink-muted">Not found.</div>;

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <Link
        to="/charts"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to charts
      </Link>

      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title={`Chart ${chart.chartNo ?? '—'}`}
          subtitle={`Worklist ${chart.worklistNumber} · Serial ${chart.serialNo}`}
        />
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" leftIcon={<ChevronLeftIcon className="w-3.5 h-3.5" />}>
            Previous
          </Button>
          <Button variant="outline" size="sm" rightIcon={<ChevronRight className="w-3.5 h-3.5" />}>
            Next
          </Button>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-12 gap-5">
        {/* LEFT: summary */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <ChartSummaryCard chart={chart} />
          <UsersCard chart={chart} />
        </aside>

        {/* CENTER: editor sections */}
        <div className="col-span-12 lg:col-span-6 space-y-4">
          <ChartEditor chart={chart} />
        </div>

        {/* RIGHT: timer + feedback */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <TimerCard chart={chart} />
          <FeedbackThread chart={chart} />
          <MilestoneActions chart={chart} onClosed={() => navigate('/charts')} />
        </aside>
      </div>
    </div>
  );
}

/* ═════════════════ LEFT: summary + users ═════════════════ */
function ChartSummaryCard({ chart }: { chart: Chart }) {
  return (
    <Card padding="default">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
        Chart summary
      </p>
      <div className="space-y-2 text-sm">
        <Row label="Chart #" value={<span className="font-mono">{chart.chartNo ?? '—'}</span>} />
        <Row label="MR #" value={chart.mrNumber ?? '—'} />
        <Row label="Priority" value={<PriorityChip priority={chart.priority} />} />
        <Row label="Milestone" value={<MilestoneChip milestone={chart.milestone} />} />
        <Row label="Status" value={<ChartStatusChip status={chart.chartStatus} />} />
        <Row label="DOS" value={formatDate(chart.dateOfService)} />
      </div>
    </Card>
  );
}

function UsersCard({ chart }: { chart: Chart }) {
  return (
    <Card padding="default">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
        Users
      </p>
      <div className="space-y-3">
        <UserBadge role="Coder" id={chart.allocatedCoderId} />
        <UserBadge role="Auditor" id={chart.allocatedAuditorId} />
      </div>
    </Card>
  );
}
function UserBadge({ role, id }: { role: string; id: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      {id ? (
        <Avatar name={`U ${id}`} size="md" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-surface-sunken" />
      )}
      <div className="min-w-0">
        <p className="text-[11px] text-ink-muted uppercase tracking-[0.08em] font-semibold">
          {role}
        </p>
        <p className="text-sm text-ink font-semibold truncate">
          {id ? `User ${id}` : 'Unassigned'}
        </p>
      </div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-muted text-[13px]">{label}</span>
      <span className="text-ink text-[13px] font-medium">{value}</span>
    </div>
  );
}

/* ═════════════════ CENTER: editor ═════════════════ */
function ChartEditor({ chart }: { chart: Chart }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<UpdateChartDto>(() => ({
    priority: chart.priority,
    primaryDiagnosis: chart.primaryDiagnosis ?? '',
    secondaryDiagnoses: chart.secondaryDiagnoses ?? [],
    emLevel: chart.emLevel ?? '',
    coderCommentsToClient: '',
    rejectionDenialComments: '',
    deficiencyComments: '',
  }));
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const mutation = useMutation({
    mutationFn: (dto: UpdateChartDto) => updateChart(chart.id, dto),
    onSuccess: () => {
      setSavedAt(new Date());
      qc.invalidateQueries({ queryKey: ['chart', chart.id] });
    },
  });

  // Debounced auto-save
  const timer = useRef<number | null>(null);
  function patch(partial: UpdateChartDto) {
    setLocal((prev) => ({ ...prev, ...partial }));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      mutation.mutate({ ...local, ...partial });
    }, 800);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-[11px] text-ink-muted">
        <span>Auto-save enabled</span>
        {mutation.isPending ? (
          <span className="flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving…
          </span>
        ) : savedAt ? (
          <span className="flex items-center gap-1 text-success">
            <CheckCircle2 className="w-3 h-3" /> Saved {formatDateTime(savedAt.toISOString())}
          </span>
        ) : null}
      </div>

      {/* Chart Info */}
      <CollapsibleCard title="Chart Info" defaultOpen>
        <div className="grid grid-cols-2 gap-4 pt-3">
          <Field label="Priority">
            <Select
              value={local.priority}
              onChange={(e) => patch({ priority: e.target.value as Priority })}
            >
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="FINALIZED">Finalized</option>
            </Select>
          </Field>
          <Field label="EM Level">
            <Input
              value={local.emLevel ?? ''}
              onChange={(e) => patch({ emLevel: e.target.value })}
            />
          </Field>
          <Field label="Admit date">
            <Input
              type="date"
              defaultValue={chart.dischargeDate ?? ''}
              onChange={(e) => patch({ admitDate: e.target.value })}
            />
          </Field>
          <Field label="Discharge date">
            <Input
              type="date"
              defaultValue={chart.dischargeDate ?? ''}
              onChange={(e) => patch({ dischargeDate: e.target.value })}
            />
          </Field>
          <Field label="DOS">
            <Input
              type="date"
              defaultValue={chart.dateOfService ?? ''}
              onChange={(e) => patch({ dos: e.target.value })}
            />
          </Field>
          <Field label="DRG value">
            <Input
              type="number"
              step="0.01"
              defaultValue={undefined}
              onChange={(e) => patch({ drgValue: parseFloat(e.target.value) || undefined })}
            />
          </Field>
        </div>
      </CollapsibleCard>

      {/* Processing Info */}
      <CollapsibleCard title="Processing Info" defaultOpen>
        <div className="grid grid-cols-1 gap-4 pt-3">
          <Field label="Primary diagnosis">
            <Input
              value={local.primaryDiagnosis ?? ''}
              onChange={(e) => patch({ primaryDiagnosis: e.target.value })}
              placeholder="ICD-10 code"
            />
          </Field>
          <Field label="Secondary diagnoses (comma-separated)">
            <Input
              value={(local.secondaryDiagnoses ?? []).join(', ')}
              onChange={(e) =>
                patch({
                  secondaryDiagnoses: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Coder comments to client">
            <Textarea
              rows={3}
              value={local.coderCommentsToClient ?? ''}
              onChange={(e) => patch({ coderCommentsToClient: e.target.value })}
            />
          </Field>
          <Field label="Deficiency comments">
            <Textarea
              rows={3}
              value={local.deficiencyComments ?? ''}
              onChange={(e) => patch({ deficiencyComments: e.target.value })}
            />
          </Field>
        </div>
      </CollapsibleCard>

      {/* Audit Information */}
      <CollapsibleCard title="Audit Information" subtitle="Auditor notes, rejection comments">
        <div className="grid grid-cols-1 gap-4 pt-3">
          <Field label="Rejection / denial comments">
            <Textarea
              rows={4}
              value={local.rejectionDenialComments ?? ''}
              onChange={(e) => patch({ rejectionDenialComments: e.target.value })}
            />
          </Field>
        </div>
      </CollapsibleCard>

      <div className="flex justify-end">
        <Button
          leftIcon={<Save className="w-3.5 h-3.5" />}
          loading={mutation.isPending}
          onClick={() => mutation.mutate(local)}
        >
          Save now
        </Button>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/* ═════════════════ RIGHT: timer ═════════════════ */
function TimerCard({ chart }: { chart: Chart }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Tick
  useEffect(() => {
    if (!startedAt) return;
    const iv = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(iv);
  }, [startedAt]);

  const startMut = useMutation({
    mutationFn: () => startChart(chart.id),
    onSuccess: (res) => {
      setStartedAt(Date.parse(res.startedAt));
      qc.invalidateQueries({ queryKey: ['chart', chart.id] });
    },
  });
  const stopMut = useMutation({
    mutationFn: () => stopChart(chart.id),
    onSuccess: () => {
      setStartedAt(null);
      setElapsed(0);
      qc.invalidateQueries({ queryKey: ['chart', chart.id] });
    },
  });

  const canStart = user.role === 'CODER' || user.role === 'AUDITOR';
  const hh = Math.floor(elapsed / 3_600_000).toString().padStart(2, '0');
  const mm = Math.floor((elapsed % 3_600_000) / 60_000).toString().padStart(2, '0');
  const ss = Math.floor((elapsed % 60_000) / 1000).toString().padStart(2, '0');

  if (!canStart) return null;

  return (
    <div className="rounded-card p-5 bg-gradient-to-br from-cyan-500 to-teal-600 text-white">
      <p className="text-[11px] uppercase tracking-[0.1em] opacity-80 font-semibold mb-2">
        {startedAt ? 'Coding in progress' : 'Timer'}
      </p>
      <p className="text-4xl font-bold font-mono tabular-nums mb-4">
        {hh}:{mm}:{ss}
      </p>
      {startedAt ? (
        <Button
          variant="primary"
          className="!bg-white !text-cyan-700 w-full"
          leftIcon={<Square className="w-3.5 h-3.5" />}
          loading={stopMut.isPending}
          onClick={() => stopMut.mutate()}
        >
          Stop
        </Button>
      ) : (
        <Button
          className="!bg-white !text-cyan-700 w-full"
          leftIcon={<Play className="w-3.5 h-3.5" />}
          loading={startMut.isPending}
          onClick={() => startMut.mutate()}
        >
          Start coding
        </Button>
      )}
    </div>
  );
}

/* ═════════════════ RIGHT: feedback thread ═════════════════ */
function FeedbackThread({ chart }: { chart: Chart }) {
  const user = useAuth((s) => s.user)!;
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [newComments, setNewComments] = useState('');

  const { data: feedback = [] } = useQuery({
    queryKey: ['chart', chart.id, 'feedback'],
    queryFn: () => listChartFeedback(chart.id),
  });

  const addMut = useMutation({
    mutationFn: () =>
      addChartFeedback(chart.id, {
        categoryId: 1,
        feedbackTypeId: 1,
        feedbackStatus: 'Feedback Provided',
        comments: newComments,
      }),
    onSuccess: () => {
      setNewComments('');
      setComposing(false);
      qc.invalidateQueries({ queryKey: ['chart', chart.id, 'feedback'] });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ fid, status }: { fid: string; status: FeedbackStatus }) =>
      updateChartFeedback(fid, { feedbackStatus: status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chart', chart.id, 'feedback'] }),
  });

  return (
    <Card padding="default">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold">
          Feedback ({feedback.length})
        </p>
        {user.role === 'AUDITOR' && !composing && (
          <button
            onClick={() => setComposing(true)}
            className="text-xs font-semibold text-primary-ink bg-primary-soft hover:bg-primary/30 px-2 py-1 rounded-pill flex items-center gap-1"
          >
            <MessageSquarePlus className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {composing && (
        <div className="space-y-2 mb-4 p-3 bg-surface-sunken rounded-lg">
          <Textarea
            rows={3}
            placeholder="Feedback comments…"
            value={newComments}
            onChange={(e) => setNewComments(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={addMut.isPending} onClick={() => addMut.mutate()}>
              Submit
            </Button>
          </div>
        </div>
      )}

      {feedback.length === 0 ? (
        <p className="text-[11px] text-ink-subtle">No feedback yet.</p>
      ) : (
        <div className="space-y-3">
          {feedback.map((f) => (
            <div key={f.id} className="text-xs border-l-2 border-primary pl-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">{f.feedbackTypeName}</span>
                <span className="text-ink-subtle text-[10px]">{formatDate(f.createdAt)}</span>
              </div>
              <p className="text-ink-muted mt-0.5">{f.comments}</p>
              <p className="text-[10px] text-ink-subtle mt-1">
                Status: <span className="font-medium">{f.feedbackStatus}</span>
              </p>
              {user.role === 'CODER' && f.feedbackStatus === 'Feedback Provided' && (
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => updateMut.mutate({ fid: f.id, status: 'Agree' })}
                    className="text-[10px] px-2 py-0.5 rounded-pill bg-success-soft text-success font-semibold"
                  >
                    Agree
                  </button>
                  <button
                    onClick={() => updateMut.mutate({ fid: f.id, status: 'Reject' })}
                    className="text-[10px] px-2 py-0.5 rounded-pill bg-danger-soft text-danger font-semibold"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => updateMut.mutate({ fid: f.id, status: 'Feedback Implemented' })}
                    className="text-[10px] px-2 py-0.5 rounded-pill bg-primary-soft text-primary-ink font-semibold"
                  >
                    Implement
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ═════════════════ RIGHT: milestone actions ═════════════════ */
function MilestoneActions({ chart, onClosed }: { chart: Chart; onClosed: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (dto: { milestone: ChartMilestone; chartStatus: ChartStatus }) =>
      transitionChart(chart.id, dto),
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ['chart', chart.id] });
      if (next.milestone === 'CLOSED') onClosed();
    },
    onError: (err) => setError((err as unknown as ApiErrorShape).message),
  });

  // Suggest the next plausible transition based on current milestone
  const suggestion = getNextTransition(chart.milestone);

  return (
    <Card padding="default">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
        Milestone
      </p>
      {error && (
        <div className="text-[11px] px-2 py-1.5 rounded bg-danger-soft text-danger mb-3">
          {error}
        </div>
      )}
      {suggestion ? (
        <Button
          className="w-full"
          loading={mut.isPending}
          onClick={() =>
            mut.mutate({
              milestone: suggestion.milestone,
              chartStatus: suggestion.chartStatus,
            })
          }
        >
          {suggestion.label}
        </Button>
      ) : (
        <p className="text-xs text-ink-muted">Chart is closed. No further transitions.</p>
      )}
    </Card>
  );
}

function getNextTransition(
  m: ChartMilestone,
): { milestone: ChartMilestone; chartStatus: ChartStatus; label: string } | null {
  switch (m) {
    case 'READY_TO_CODE':
      return { milestone: 'CODING_IN_PROGRESS', chartStatus: 'OPEN', label: 'Start coding' };
    case 'CODING_IN_PROGRESS':
      return { milestone: 'CODING_DONE', chartStatus: 'COMPLETE', label: 'Mark coding complete' };
    case 'CODING_DONE':
      return { milestone: 'READY_TO_AUDIT', chartStatus: 'COMPLETE', label: 'Send to audit' };
    case 'READY_TO_AUDIT':
      return { milestone: 'AUDIT_IN_PROGRESS', chartStatus: 'OPEN', label: 'Start audit' };
    case 'AUDIT_IN_PROGRESS':
      return { milestone: 'AUDIT_DONE', chartStatus: 'COMPLETE', label: 'Mark audit complete' };
    case 'AUDIT_DONE':
      return { milestone: 'CLOSED', chartStatus: 'COMPLETE', label: 'Close chart' };
    case 'CLOSED':
      return null;
  }
}
