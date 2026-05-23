'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { Condition, Rule, RuleAction } from '@/lib/digital-dispatch-types';
import { ConditionBuilder } from './ConditionBuilder';

export function RuleEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: Rule | null;
  onSave: (input: {
    name: string;
    enabled: boolean;
    priority: number;
    conditions: Condition[];
    action: RuleAction;
  }) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [priority, setPriority] = useState(initial?.priority ?? 10);
  const [action, setAction] = useState<RuleAction>(initial?.action ?? 'accept');
  const [conditions, setConditions] = useState<Condition[]>(initial?.conditions ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await onSave({ name, enabled, priority, conditions, action });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-end gap-3">
        <label className="flex-1 text-sm text-zinc-300">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Accept AAA within 25mi" />
        </label>
        <label className="text-sm text-zinc-300">
          Priority
          <Input
            type="number"
            value={String(priority)}
            onChange={(e) => setPriority(Number(e.target.value) || 0)}
            className="w-24"
          />
        </label>
        <label className="text-sm text-zinc-300">
          Action
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as RuleAction)}
            className="block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100"
          >
            <option value="accept">Accept</option>
            <option value="decline">Decline</option>
            <option value="flag">Flag for human</option>
          </select>
        </label>
        <div className="flex items-center gap-2 pb-1.5">
          <Switch checked={enabled} onCheckedChange={setEnabled} id="enabled-toggle" />
          <label htmlFor="enabled-toggle" className="text-sm text-zinc-300">
            Enabled
          </label>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-200">Conditions (all must match)</h3>
        <ConditionBuilder conditions={conditions} onChange={setConditions} />
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      <div className="flex items-center justify-between">
        <div>
          {initial && onDelete && (
            <Button
              variant="outline"
              onClick={async () => {
                if (!confirm('Delete this rule?')) return;
                await onDelete();
              }}
              className="text-red-400 hover:text-red-300"
            >
              Delete rule
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Create rule'}
          </Button>
        </div>
      </div>
    </div>
  );
}
