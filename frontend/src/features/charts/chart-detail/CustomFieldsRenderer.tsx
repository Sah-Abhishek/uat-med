import { Input, Label, DatePicker, Textarea } from '@/components/ui/Field';
import { FormField, MultiSelect } from './shared';
import type { CustomChartField } from '@/api/configurations';
import type { CustomFieldValues } from './formState';
import { cn } from '@/lib/utils';

interface Props {
  fields: CustomChartField[];
  placement: 'Chart Info' | 'Processing Info';
  values: CustomFieldValues;
  onChange: (id: number, v: unknown) => void;
  readOnly?: boolean;
}

/**
 * Renders all custom fields for a given placement.
 * Type-driven: text/number → Input, date → DatePicker, multiline → Textarea,
 * dropdown → FancySelect (or MultiSelect when isMultiSelect=true).
 * Honors the per-field `validation` rule the same way standard fields do:
 * NOT_APPLICABLE hides the field, MANDATORY surfaces the `*` indicator.
 */
export function CustomFieldsRenderer({
  fields,
  placement,
  values,
  onChange,
  readOnly,
}: Props) {
  const visible = fields.filter(
    (f) => (f.placement ?? 'Chart Info') === placement && f.validation !== 'NOT_APPLICABLE',
  );
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-line">
      {visible.map((f) => (
        <CustomFieldInput
          key={f.id}
          field={f}
          value={values[String(f.id)]}
          onChange={(v) => onChange(f.id!, v)}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function CustomFieldInput({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: CustomChartField;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const required = field.validation === 'MANDATORY';

  // Multi-select dropdown — wrap in its own column so it can span a row if needed.
  if (field.type === 'dropdown' && field.isMultiSelect) {
    return (
      <div className="col-span-3">
        <Label required={required}>{field.name}</Label>
        <MultiSelect
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(next) => onChange(next)}
          options={field.options ?? []}
          readOnly={readOnly}
        />
      </div>
    );
  }

  if (field.type === 'dropdown') {
    return (
      <FormField
        label={field.name}
        type="select"
        required={required}
        value={typeof value === 'string' ? value : ''}
        onChange={(v) => onChange(v)}
        options={field.options ?? []}
        readOnly={readOnly}
      />
    );
  }

  if (field.type === 'date') {
    return (
      <div className={cn('min-w-0', readOnly && 'pointer-events-none')}>
        <Label required={required}>{field.name}</Label>
        <DatePicker
          value={typeof value === 'string' ? value : ''}
          onChange={(v) => onChange(v)}
          disabled={readOnly}
        />
      </div>
    );
  }

  if (field.type === 'multiline') {
    return (
      <div className="col-span-3">
        <Label required={required}>{field.name}</Label>
        <Textarea
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
        />
      </div>
    );
  }

  // text or number
  return (
    <div className="min-w-0">
      <Label required={required}>{field.name}</Label>
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
        readOnly={readOnly}
      />
    </div>
  );
}
