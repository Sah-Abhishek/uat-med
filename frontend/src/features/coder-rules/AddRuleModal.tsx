import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { FancySelect, Label, Textarea } from '@/components/ui/Field';
import { Modal, ModalFooter } from '@/components/ui/Primitives';
import {
  RULE_APPLIES_TO,
  RULE_PRIORITIES,
  createCoderRule,
  type RuleAppliesTo,
  type RulePriority,
} from '@/api/coder-rules';
import { cn } from '@/lib/utils';

const RULE_MIN_CHARS = 10;

interface Props {
  onClose: () => void;
  /** Default values when invoked from a code-context (e.g. the Review modal,
   * where we know which code type the user was looking at). */
  defaultAppliesTo?: RuleAppliesTo;
  defaultPriority?: RulePriority;
  /** Pre-fill the rule text — useful when the user's typing context already
   * suggested a rule. */
  defaultText?: string;
  onCreated?: () => void;
}

export function AddRuleModal({
  onClose,
  defaultAppliesTo = 'ALL',
  defaultPriority = 'HIGH',
  defaultText = '',
  onCreated,
}: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState(defaultText);
  const [appliesTo, setAppliesTo] = useState<RuleAppliesTo>(defaultAppliesTo);
  const [priority, setPriority] = useState<RulePriority>(defaultPriority);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const tooShort = trimmed.length < RULE_MIN_CHARS;

  const m = useMutation({
    mutationFn: () =>
      createCoderRule({
        rule_text: trimmed,
        applies_to: appliesTo,
        priority,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coder-rules'] });
      onCreated?.();
      onClose();
    },
    onError: (e) =>
      setError(
        (e as any)?.response?.data?.error?.message
          ?? (e as any)?.message
          ?? 'Failed to create rule.',
      ),
  });

  return (
    <Modal open onClose={onClose} title="Add coder rule" size="md">
      <div className="space-y-4">
        {error && <div className="text-xs px-3 py-2 rounded bg-danger-soft text-danger">{error}</div>}

        <div>
          <Label required>Rule text</Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='e.g. "Always assign Z51.11 when the encounter is for chemotherapy."'
            rows={4}
            autoFocus
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-[11px] text-ink-muted">
              Write the rule as a self-contained imperative — the AI sees this verbatim.
            </p>
            <span className={cn(
              'text-[11px] font-mono shrink-0',
              tooShort ? 'text-danger' : 'text-success',
            )}>
              {trimmed.length} / {RULE_MIN_CHARS}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label required>Applies to</Label>
            <FancySelect
              value={appliesTo}
              onChange={(v) => setAppliesTo(v as RuleAppliesTo)}
              options={RULE_APPLIES_TO.map((a) => ({ value: a, label: a }))}
            />
          </div>
          <div>
            <Label required>Priority</Label>
            <FancySelect
              value={priority}
              onChange={(v) => setPriority(v as RulePriority)}
              options={RULE_PRIORITIES.map((p) => ({
                value: p,
                label: p === 'HIGH' ? 'HIGH — always injected' : 'NORMAL — by similarity',
              }))}
            />
          </div>
        </div>

        <div className="rounded-lg border border-warn/30 bg-warn-soft/30 px-3 py-2 text-[11px] text-warn">
          <strong className="font-semibold">HIGH</strong> rules are injected into every future report.{' '}
          <strong className="font-semibold">NORMAL</strong> rules are retrieved by similarity search against the current report's clinical text.
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button
          type="button"
          loading={m.isPending}
          disabled={tooShort || m.isPending}
          onClick={() => {
            setError(null);
            m.mutate();
          }}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
        >
          Create rule
        </Button>
      </ModalFooter>
    </Modal>
  );
}
