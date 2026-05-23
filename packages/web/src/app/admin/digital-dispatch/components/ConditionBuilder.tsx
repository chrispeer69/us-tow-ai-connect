'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CONDITION_LABEL,
  DAY_LABELS,
  type Condition,
  type ConditionType,
} from '@/lib/digital-dispatch-types';

const TYPES: ConditionType[] = [
  'distance_max_miles',
  'time_of_day',
  'day_of_week',
  'service_type_in',
  'estimated_payout_min',
  'driver_available_count_min',
  'job_age_minutes_max',
  'caller_phone_blacklist',
  'custom_jsonpath',
];

function defaultOfType(t: ConditionType): Condition {
  switch (t) {
    case 'distance_max_miles':
      return { type: t, miles: 25 };
    case 'time_of_day':
      return { type: t, start: '06:00', end: '22:00' };
    case 'day_of_week':
      return { type: t, days: [1, 2, 3, 4, 5] };
    case 'service_type_in':
      return { type: t, values: [] };
    case 'estimated_payout_min':
      return { type: t, amount: 50 };
    case 'driver_available_count_min':
      return { type: t, count: 1 };
    case 'job_age_minutes_max':
      return { type: t, minutes: 30 };
    case 'caller_phone_blacklist':
      return { type: t, phones: [] };
    case 'custom_jsonpath':
      return { type: t, expression: '$.payout' };
  }
}

export function ConditionBuilder({
  conditions,
  onChange,
}: {
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
}) {
  function update(idx: number, next: Condition) {
    const copy = conditions.slice();
    copy[idx] = next;
    onChange(copy);
  }
  function remove(idx: number) {
    onChange(conditions.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...conditions, defaultOfType('distance_max_miles')]);
  }

  return (
    <div className="space-y-3">
      {conditions.length === 0 && (
        <p className="rounded border border-dashed border-zinc-700 p-3 text-sm text-zinc-500">
          No conditions yet. A rule with zero conditions matches every job.
        </p>
      )}
      {conditions.map((c, i) => (
        <div
          key={i}
          className="space-y-2 rounded border border-zinc-800 bg-zinc-900/60 p-3"
        >
          <div className="flex items-center gap-2">
            <select
              value={c.type}
              onChange={(e) => update(i, defaultOfType(e.target.value as ConditionType))}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {CONDITION_LABEL[t]}
                </option>
              ))}
            </select>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => remove(i)}>
              Remove
            </Button>
          </div>
          <ConditionFields condition={c} onChange={(next) => update(i, next)} />
        </div>
      ))}
      <Button variant="outline" onClick={add}>
        + Add condition
      </Button>
    </div>
  );
}

function ConditionFields({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (next: Condition) => void;
}) {
  switch (condition.type) {
    case 'distance_max_miles':
      return (
        <NumberField
          label="miles"
          value={condition.miles}
          onChange={(v) => onChange({ ...condition, miles: v })}
        />
      );
    case 'time_of_day':
      return (
        <div className="flex gap-2">
          <Input
            type="time"
            value={condition.start}
            onChange={(e) => onChange({ ...condition, start: e.target.value })}
          />
          <span className="self-center text-sm text-zinc-400">to</span>
          <Input
            type="time"
            value={condition.end}
            onChange={(e) => onChange({ ...condition, end: e.target.value })}
          />
        </div>
      );
    case 'day_of_week':
      return (
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((label, idx) => {
            const on = condition.days.includes(idx);
            return (
              <button
                key={label}
                onClick={() => {
                  const next = on
                    ? condition.days.filter((d) => d !== idx)
                    : [...condition.days, idx].sort((a, b) => a - b);
                  onChange({ ...condition, days: next });
                }}
                className={`rounded px-2 py-1 text-xs ${
                  on ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      );
    case 'service_type_in':
      return (
        <StringList
          values={condition.values}
          placeholder="e.g. tow, lockout"
          onChange={(v) => onChange({ ...condition, values: v })}
        />
      );
    case 'estimated_payout_min':
      return (
        <NumberField
          label="dollars"
          value={condition.amount}
          onChange={(v) => onChange({ ...condition, amount: v })}
        />
      );
    case 'driver_available_count_min':
      return (
        <NumberField
          label="drivers"
          value={condition.count}
          onChange={(v) => onChange({ ...condition, count: v })}
        />
      );
    case 'job_age_minutes_max':
      return (
        <NumberField
          label="minutes"
          value={condition.minutes}
          onChange={(v) => onChange({ ...condition, minutes: v })}
        />
      );
    case 'caller_phone_blacklist':
      return (
        <StringList
          values={condition.phones}
          placeholder="e.g. 6145551234"
          onChange={(v) => onChange({ ...condition, phones: v })}
        />
      );
    case 'custom_jsonpath':
      return (
        <Input
          value={condition.expression}
          onChange={(e) => onChange({ ...condition, expression: e.target.value })}
          placeholder="$.payout > 50 or $.special_flag"
        />
      );
  }
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={String(value)}
        onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
        className="max-w-[140px]"
      />
      <span className="text-sm text-zinc-400">{label}</span>
    </div>
  );
}

function StringList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  return (
    <Input
      value={values.join(', ')}
      placeholder={placeholder}
      onChange={(e) =>
        onChange(
          e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      }
    />
  );
}
