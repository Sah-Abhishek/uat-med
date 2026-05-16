import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpenCheck, Plus, ShieldCheck, ShieldOff } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FancySelect, Switch } from '@/components/ui/Field';
import { Modal, ModalFooter } from '@/components/ui/Primitives';
import {
  RULE_APPLIES_TO,
  deactivateCoderRule,
  listCoderRules,
  type CoderRule,
  type RuleAppliesTo,
  type RulePriority,
} from '@/api/coder-rules';
import { useAuth } from '@/auth/store';
import { can } from '@/permissions';
import { cn } from '@/lib/utils';
import { AddRuleModal } from './AddRuleModal';

type PriorityFilter = 'ALL' | RulePriority;
const PRIORITY_FILTERS: PriorityFilter[] = ['ALL', 'HIGH', 'NORMAL'];

export function CoderRulesPage() {
  const user = useAuth((s) => s.user)!;
  const canManage = can(user, 'coderRules.manage');

  const [priority, setPriority] = useState<PriorityFilter>('ALL');
  const [appliesTo, setAppliesTo] = useState<RuleAppliesTo | ''>('');
  const [showInactive, setShowInactive] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<CoderRule | null>(null);

  const q = useQuery({
    queryKey: ['coder-rules', { priority, appliesTo, showInactive }],
    queryFn: () =>
      listCoderRules({
        priority: priority === 'ALL' ? undefined : priority,
        applies_to: appliesTo || undefined,
        include_inactive: showInactive || undefined,
      }),
  });

  const rules = q.data?.rules ?? [];
  const totals = useMemo(
    () => ({
      total: q.data?.total ?? 0,
      high: q.data?.high_count ?? 0,
      normal: q.data?.normal_count ?? 0,
    }),
    [q.data],
  );

  return (
    <div className="p-8 max-w-[1400px] space-y-5">
      <PageHeader
        title="Coder Rules"
        subtitle="Standing instructions injected into the AI on every future report. HIGH-priority rules always apply; NORMAL rules are pulled by similarity."
      />

      <Card padding="default">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <span>
              <span className="font-mono text-ink">{totals.total}</span> total
            </span>
            <span className="opacity-50">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="font-mono text-ink">{totals.high}</span> high
            </span>
            <span className="opacity-50">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-info" />
              <span className="font-mono text-ink">{totals.normal}</span> normal
            </span>
          </div>
          {canManage && (
            <Button leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setAddOpen(true)}>
              Add rule
            </Button>
          )}
        </div>

        {/* Filter bar */}
        <div className="rounded-xl border border-line bg-surface-sunken/30 px-4 py-3 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted mr-1">
              Priority
            </span>
            {PRIORITY_FILTERS.map((p) => {
              const active = priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    'inline-flex items-center px-3 h-7 rounded-pill text-[11px] font-semibold border transition',
                    active
                      ? 'border-primary bg-primary text-white'
                      : 'border-line bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  {p}
                </button>
              );
            })}

            <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted ml-2">
              Applies to
            </span>
            <div className="w-[160px]">
              <FancySelect
                value={appliesTo}
                onChange={(v) => setAppliesTo((v as RuleAppliesTo) || '')}
                options={[
                  { value: '', label: 'Any' },
                  ...RULE_APPLIES_TO.map((a) => ({ value: a, label: a })),
                ]}
                placeholder="Any"
              />
            </div>

            <div className="ml-auto">
              <Switch
                checked={showInactive}
                onChange={setShowInactive}
                label={<span className="text-xs text-ink-muted">Show inactive</span>}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken/40">
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Rule</th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Applies to</th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Priority</th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Created</th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Status</th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">{/* actions */}</th>
                </tr>
              </thead>
              <tbody>
                {q.isPending ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-t border-line">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="h-3 rounded bg-surface-sunken/60 animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : q.isError ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8">
                      <p className="text-sm text-danger text-center">
                        {(q.error as any)?.response?.data?.error?.message
                          ?? (q.error as any)?.message
                          ?? 'Failed to load rules.'}
                      </p>
                    </td>
                  </tr>
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <BookOpenCheck className="w-8 h-8 text-ink-muted/60" />
                        <div>
                          <p className="text-sm font-semibold text-ink">No coder rules match these filters</p>
                          <p className="text-xs text-ink-muted mt-1">
                            {canManage
                              ? 'Click "Add rule" to create the first one.'
                              : 'Ask a Team Lead to add some.'}
                          </p>
                        </div>
                        {canManage && (
                          <Button size="sm" onClick={() => setAddOpen(true)} leftIcon={<Plus className="w-3 h-3" />}>
                            Add rule
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  rules.map((r) => (
                    <RuleRow
                      key={r.id}
                      rule={r}
                      canManage={canManage}
                      onDeactivate={() => setConfirmDeactivate(r)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {addOpen && <AddRuleModal onClose={() => setAddOpen(false)} />}
      {confirmDeactivate && (
        <DeactivateConfirm
          rule={confirmDeactivate}
          onClose={() => setConfirmDeactivate(null)}
        />
      )}
    </div>
  );
}

/* ── Row ─────────────────────────────────────────────────── */

function RuleRow({
  rule, canManage, onDeactivate,
}: { rule: CoderRule; canManage: boolean; onDeactivate: () => void }) {
  const isHigh = rule.priority === 'HIGH';
  return (
    <tr className={cn('border-t border-line transition', !rule.active && 'bg-surface-sunken/30 opacity-70')}>
      <td className="px-4 py-3 text-sm text-ink leading-snug">
        {rule.rule_text}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className="inline-flex items-center px-2 h-5 rounded-md border border-line bg-surface text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {rule.applies_to}
        </span>
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className={cn(
          'inline-flex items-center gap-1 px-2 h-5 rounded-md border text-[10px] font-semibold uppercase tracking-wide',
          isHigh
            ? 'border-primary/40 bg-primary-soft text-primary-ink dark:text-primary'
            : 'border-info/40 bg-info-soft/60 text-info',
        )}>
          {isHigh && <ShieldCheck className="w-2.5 h-2.5" strokeWidth={3} />}
          {rule.priority}
        </span>
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-xs text-ink-muted">
        <div title={new Date(rule.created_at).toLocaleString()}>
          {formatRelative(rule.created_at)}
        </div>
        <div className="text-[10px] opacity-70 truncate max-w-[140px]" title={rule.created_by}>
          {rule.created_by}
        </div>
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <StatusPill active={rule.active} />
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-right">
        {canManage && rule.active && (
          <button
            type="button"
            onClick={onDeactivate}
            className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-line text-xs font-semibold text-ink-muted hover:bg-danger-soft/30 hover:text-danger hover:border-danger/30 transition"
          >
            <ShieldOff className="w-3 h-3" />
            Deactivate
          </button>
        )}
        {!rule.active && (
          <span className="text-[10px] uppercase tracking-wide text-ink-muted">Inactive</span>
        )}
      </td>
    </tr>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 h-5 rounded-md border text-[10px] font-semibold uppercase tracking-wide',
      active
        ? 'border-success/40 bg-success-soft/60 text-success'
        : 'border-line bg-surface-sunken text-ink-muted',
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', active ? 'bg-success' : 'bg-ink-muted/50')} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

/* ── Deactivate confirm ──────────────────────────────────── */

function DeactivateConfirm({ rule, onClose }: { rule: CoderRule; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => deactivateCoderRule(rule.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coder-rules'] });
      onClose();
    },
    onError: (e) =>
      setError(
        (e as any)?.response?.data?.error?.message
          ?? (e as any)?.message
          ?? 'Failed to deactivate rule.',
      ),
  });

  return (
    <Modal open onClose={onClose} title="Deactivate this rule?" size="sm">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-danger-soft text-danger flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <p className="text-sm text-ink leading-relaxed">
            This rule will stop applying to new reports immediately. The audit trail in
            Postgres stays intact — there's no hard delete.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface-sunken/40 px-3 py-2 text-xs text-ink leading-snug">
          {rule.rule_text}
        </div>
        {error && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{error}</div>}
      </div>
      <ModalFooter>
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          loading={m.isPending}
          onClick={() => {
            setError(null);
            m.mutate();
          }}
        >
          Deactivate
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}
