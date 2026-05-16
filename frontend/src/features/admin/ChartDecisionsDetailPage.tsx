import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { PillBadge } from '@/components/ui/Primitives';
import {
  getChartDecisionsDetail,
  type AdminChartDecisionDetail,
  type AdminChartDetail,
  type AiPredictedCode,
  type DecisionVerdict,
} from '@/api/admin';
import { cn, formatDateTime } from '@/lib/utils';

export function ChartDecisionsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['admin', 'chart-detail', id],
    queryFn: () => getChartDecisionsDetail(id!),
    enabled: !!id,
  });

  return (
    <div className="p-8 max-w-[1400px] space-y-5">
      <div>
        <Link
          to="/admin/code-decisions"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-primary mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to all charts
        </Link>
        <PageHeader
          title={`Chart ${q.data?.chart.chartNo ?? `#${id}`}`}
          subtitle="AI predicted codes and coder decisions, side by side."
        />
      </div>

      {q.isPending && (
        <Card padding="default">
          <div className="py-10 text-center text-sm text-ink-muted">Loading…</div>
        </Card>
      )}
      {q.isError && (
        <Card padding="default">
          <div className="py-10 text-center text-sm text-danger">Failed to load chart.</div>
        </Card>
      )}
      {q.data && (
        <>
          <ChartHeader detail={q.data} />
          <AiCodesSection detail={q.data} />
          <DecisionsSection detail={q.data} />
        </>
      )}
    </div>
  );
}

/* ── Chart header ─────────────────────────────────────────────── */
function ChartHeader({ detail }: { detail: AdminChartDetail }) {
  const c = detail.chart;
  return (
    <Card padding="default">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <HeaderField label="Milestone" value={humanize(c.milestone)} />
        <HeaderField label="Status" value={c.chartStatus} />
        <HeaderField label="Priority" value={c.priority} />
        <HeaderField
          label="Encounter id"
          value={c.encounterId ? <code className="font-mono text-[11px]">{c.encounterId}</code> : '—'}
        />
        <HeaderField label="Coder #" value={c.allocatedCoderId ?? '—'} />
        <HeaderField label="Auditor #" value={c.allocatedAuditorId ?? '—'} />
        <HeaderField label="Worklist" value={c.worklistId} />
        <HeaderField label="Last updated" value={formatDateTime(c.updatedAt)} />
      </div>
    </Card>
  );
}

function HeaderField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-subtle font-semibold">{label}</div>
      <div className="text-sm text-ink mt-0.5 break-words">{value || '—'}</div>
    </div>
  );
}

/* ── AI predicted codes ───────────────────────────────────────── */
function AiCodesSection({ detail }: { detail: AdminChartDetail }) {
  const { aiCodes, aiCodesError, chart } = detail;
  return (
    <Card padding="none">
      <div className="px-6 py-4 border-b border-line/60 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold text-ink">AI predicted codes</h3>
        <span className="text-xs text-ink-subtle ml-auto">
          {chart.encounterId
            ? aiCodesError
              ? 'gateway error'
              : `${aiCodes.length} codes from gateway`
            : 'No AI encounter on this chart'}
        </span>
      </div>
      {!chart.encounterId ? (
        <p className="px-6 py-8 text-sm text-ink-muted">
          This chart was never run through the AI pipeline, so there are no predicted codes to show.
        </p>
      ) : aiCodesError ? (
        <p className="px-6 py-8 text-sm text-danger">{aiCodesError}</p>
      ) : aiCodes.length === 0 ? (
        <p className="px-6 py-8 text-sm text-ink-muted">
          The gateway returned no predicted codes for this encounter.
        </p>
      ) : (
        <div className="divide-y divide-line/60">
          {aiCodes.map((c) => <AiCodeRow key={c.id} code={c} />)}
        </div>
      )}
    </Card>
  );
}

function AiCodeRow({ code }: { code: AiPredictedCode }) {
  const [open, setOpen] = useState(false);
  const just = code.evidence_json?.justification;
  const notes = code.evidence_json?.audit_notes;
  const sources = code.evidence_json?.source_reports;
  const hasMore = !!just || !!notes || (sources && sources.length > 0);

  return (
    <div className="px-6 py-3">
      <button
        type="button"
        onClick={() => hasMore && setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-3 text-left',
          hasMore && 'cursor-pointer',
        )}
      >
        {hasMore ? (
          open ? <ChevronDown className="w-4 h-4 text-ink-subtle" /> : <ChevronRight className="w-4 h-4 text-ink-subtle" />
        ) : <span className="w-4" />}
        <span className="text-[11px] uppercase tracking-wide text-ink-subtle w-20">{code.code_type}</span>
        <span className="font-mono text-sm font-semibold text-ink min-w-[80px]">{code.icd_code}</span>
        <span className="flex-1 text-sm text-ink-muted truncate">{code.description}</span>
        <ConfidencePill v={code.confidence} />
        <code className="font-mono text-[11px] text-ink-subtle">{shortId(code.id)}</code>
      </button>
      {open && hasMore && (
        <div className="pl-7 mt-2 space-y-2 text-xs">
          {just && (
            <Block label="Justification">{just}</Block>
          )}
          {notes && (
            <Block label="Audit notes">{notes}</Block>
          )}
          {sources && sources.length > 0 && (
            <Block label="Source reports">{sources.join(', ')}</Block>
          )}
        </div>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-ink-subtle font-semibold">{label}</span>
      <p className="text-ink-muted mt-0.5">{children}</p>
    </div>
  );
}

function ConfidencePill({ v }: { v: number }) {
  const tone = v >= 0.8 ? 'mint' : v >= 0.5 ? 'butter' : 'coral';
  return <PillBadge tone={tone}>{(v * 100).toFixed(0)}%</PillBadge>;
}

/* ── Decisions table ──────────────────────────────────────────── */
function DecisionsSection({ detail }: { detail: AdminChartDetail }) {
  return (
    <Card padding="none">
      <div className="px-6 py-4 border-b border-line/60 flex items-center gap-2">
        <h3 className="text-sm font-bold text-ink">Coder decisions</h3>
        <span className="text-xs text-ink-subtle ml-auto">
          {detail.decisions.length} total
        </span>
        {detail.correctionsError && (
          <span className="text-xs text-danger ml-2">
            (couldn't load gateway corrections: {detail.correctionsError})
          </span>
        )}
      </div>
      {detail.decisions.length === 0 ? (
        <p className="px-6 py-8 text-sm text-ink-muted">
          No decisions recorded on this chart yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr>
                <th className="table-head w-10" />
                <th className="table-head">Decided</th>
                <th className="table-head">Coder</th>
                <th className="table-head">Type</th>
                <th className="table-head">Code → Edit</th>
                <th className="table-head">Decision</th>
                <th className="table-head">Reason</th>
                <th className="table-head">In AI</th>
              </tr>
            </thead>
            <tbody>
              {detail.decisions.map((d) => <DecisionRow key={d.id} d={d} />)}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DecisionRow({ d }: { d: AdminChartDecisionDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="border-b border-line/60 hover:bg-surface-sunken/40 cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="table-cell">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="table-cell text-xs text-ink-muted whitespace-nowrap">
          {formatDateTime(d.decidedAt)}
        </td>
        <td className="table-cell">
          <div className="flex flex-col">
            <span className="text-sm">{d.decidedByName ?? d.decidedByEmail}</span>
            <span className="text-xs text-ink-subtle">{d.decidedByRole}</span>
          </div>
        </td>
        <td className="table-cell text-xs">{d.codeType}</td>
        <td className="table-cell font-mono">
          {d.codeValue}
          {d.decision === 'EDITED' && d.editedCode && (
            <span className="text-warn ml-1">→ {d.editedCode}</span>
          )}
          {d.decision === 'ADDED' && (
            <span className="text-info ml-1 text-xs">(new)</span>
          )}
        </td>
        <td className="table-cell"><DecisionBadge d={d.decision} /></td>
        <td className="table-cell max-w-[260px]">
          {d.reasonDropdown || d.reasonText ? (
            <div className="flex flex-col gap-0.5">
              {d.reasonDropdown && (
                <span className="text-xs font-semibold text-ink">{d.reasonDropdown}</span>
              )}
              {d.reasonText && (
                <span className="text-xs text-ink-muted truncate" title={d.reasonText}>
                  {d.reasonText}
                </span>
              )}
            </div>
          ) : (
            <span className="text-ink-subtle text-xs">—</span>
          )}
        </td>
        <td className="table-cell"><SyncBadge d={d} /></td>
      </tr>
      {open && (
        <tr className="border-b border-line/60 bg-surface-sunken/30">
          <td colSpan={8} className="px-6 py-4">
            <SideBySide d={d} />
          </td>
        </tr>
      )}
    </>
  );
}

function DecisionBadge({ d }: { d: DecisionVerdict }) {
  const tone: Record<DecisionVerdict, 'mint' | 'coral' | 'butter' | 'sky'> = {
    ACCEPTED: 'mint',
    REJECTED: 'coral',
    EDITED: 'butter',
    ADDED: 'sky',
  };
  const label: Record<DecisionVerdict, string> = {
    ACCEPTED: 'Accepted',
    REJECTED: 'Rejected',
    EDITED: 'Edited',
    ADDED: 'Added',
  };
  return <PillBadge tone={tone[d]}>{label[d]}</PillBadge>;
}

function SyncBadge({ d }: { d: AdminChartDecisionDetail }) {
  if (d.decision === 'ACCEPTED') return <PillBadge tone="sky">Local only</PillBadge>;
  if (d.gatewayCorrectionId)     return <PillBadge tone="mint">Synced</PillBadge>;
  return <PillBadge tone="coral">Not synced</PillBadge>;
}

/* ── Inline expand: local vs gateway side-by-side ─────────────── */
function SideBySide({ d }: { d: AdminChartDecisionDetail }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Panel title="Local record" tone="default">
        <Row k="Code"          v={`${d.codeType} · ${d.codeValue}`} />
        {d.originalDescription && <Row k="Description" v={d.originalDescription} />}
        {d.decision === 'EDITED' && (
          <>
            <Row k="Edited to"   v={d.editedCode ?? '—'} />
            {d.editedDescription && <Row k="Edited desc" v={d.editedDescription} />}
          </>
        )}
        {d.decision === 'ADDED' && (
          <>
            <Row k="Added code"  v={d.editedCode ?? d.codeValue} />
            {d.editedDescription && <Row k="Added desc" v={d.editedDescription} />}
          </>
        )}
        {d.reasonDropdown && <Row k="Reason category" v={d.reasonDropdown} />}
        {d.reasonText && <Row k="Reason text"   v={d.reasonText} />}
        {d.predictedCodeId && <Row k="predicted_code_id" v={<code className="font-mono text-[11px]">{d.predictedCodeId}</code>} />}
        {d.gatewayCorrectionId && <Row k="correction_id" v={<code className="font-mono text-[11px]">{d.gatewayCorrectionId}</code>} />}
      </Panel>
      <GatewayPanel d={d} />
    </div>
  );
}

function GatewayPanel({ d }: { d: AdminChartDecisionDetail }) {
  if (d.decision === 'ACCEPTED') {
    return (
      <Panel title="AI golden dataset" tone="muted">
        <p className="text-sm text-ink-muted">
          ACCEPT actions don't write to <code>coder_corrections</code> by
          design — accepting an AI prediction isn't a correction.
        </p>
      </Panel>
    );
  }
  if (!d.gatewayCorrection) {
    return (
      <Panel title="AI golden dataset" tone="danger">
        <p className="text-sm text-ink-muted">
          No matching gateway correction. Either the forward failed at submit
          time, or this row predates the column. The AI did <strong>not</strong>{' '}
          receive this correction.
        </p>
      </Panel>
    );
  }
  const c = d.gatewayCorrection;
  return (
    <Panel title="AI golden dataset" tone={c.synced_to_qdrant ? 'success' : 'warning'}>
      <Row k="Action type" v={c.action_type} />
      {c.wrong_code && <Row k="Wrong code" v={c.wrong_code} />}
      {c.wrong_code_description && <Row k="Wrong desc" v={c.wrong_code_description} />}
      {c.correct_code && <Row k="Correct code" v={c.correct_code} />}
      {c.correct_description && <Row k="Correct desc" v={c.correct_description} />}
      {c.reason && <Row k="Reason" v={c.reason} />}
      <Row k="Reviewed at" v={formatDateTime(c.reviewed_at)} />
      <Row k="In Qdrant" v={c.synced_to_qdrant ? 'Yes' : 'Not yet'} />
      <Row k="correction_id" v={<code className="font-mono text-[11px]">{c.id}</code>} />
      {c.confidence_was != null && <Row k="AI confidence" v={c.confidence_was.toFixed(2)} />}
    </Panel>
  );
}

function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'default' | 'muted' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  const cls: Record<typeof tone, string> = {
    default: 'border-line bg-surface',
    muted:   'border-dashed border-line bg-surface-sunken/40',
    success: 'border-mint-300 bg-mint-50',
    warning: 'border-butter-300 bg-butter-50',
    danger:  'border-coral-300 bg-coral-50',
  };
  return (
    <div className={cn('rounded-card border p-4 space-y-3', cls[tone])}>
      <h4 className="text-sm font-bold text-ink">{title}</h4>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-xs uppercase tracking-wide text-ink-subtle col-span-1">{k}</span>
      <span className="col-span-2 text-ink break-words">{v}</span>
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function humanize(s: string): string {
  return s.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
