'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { describeCondition, type Condition, type Rule, type RuleAction } from '@/lib/digital-dispatch-types';
import { DecisionsTab } from './components/DecisionsTab';
import { RuleEditor } from './components/RuleEditor';
import { SandboxTab } from './components/SandboxTab';
import { StatsTab } from './components/StatsTab';

type Tab = 'rules' | 'decisions' | 'stats' | 'sandbox';

const ACTION_COLOR: Record<RuleAction, string> = {
  accept: 'bg-emerald-600',
  decline: 'bg-red-600',
  flag: 'bg-amber-500',
};

export default function DigitalDispatchPage() {
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<{ rule: Rule | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refreshRules() {
    try {
      setRules(await api<Rule[]>(`/v1/admin/digital-dispatch/rules`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void refreshRules();
  }, []);

  async function handleSave(input: {
    name: string;
    enabled: boolean;
    priority: number;
    conditions: Condition[];
    action: RuleAction;
  }) {
    if (editing?.rule) {
      await api(`/v1/admin/digital-dispatch/rules/${editing.rule.id}`, {
        method: 'PUT',
        json: input,
      });
    } else {
      await api(`/v1/admin/digital-dispatch/rules`, {
        method: 'POST',
        json: input,
      });
    }
    setEditing(null);
    await refreshRules();
  }

  async function handleDelete(id: string) {
    await api(`/v1/admin/digital-dispatch/rules/${id}`, { method: 'DELETE' });
    setEditing(null);
    await refreshRules();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Digital Dispatch"
        subtitle="AI auto-accept rules for motor-club intake (AAA today). Rules fire on every new inbound job in priority order; the first match wins."
      />

      <nav className="flex gap-1 border-b border-zinc-800">
        {(['rules', 'decisions', 'stats', 'sandbox'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-t-md px-4 py-2 text-sm transition',
              tab === t
                ? 'border-b-2 border-emerald-500 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-200',
            )}
          >
            {t === 'rules' ? 'Rules' : t === 'decisions' ? 'Decisions' : t === 'stats' ? 'Stats' : 'Sandbox'}
          </button>
        ))}
      </nav>

      {err && <p className="text-sm text-red-400">{err}</p>}

      {tab === 'rules' && (
        <div className="space-y-4">
          {editing ? (
            <RuleEditor
              initial={editing.rule}
              onCancel={() => setEditing(null)}
              onSave={handleSave}
              onDelete={editing.rule ? () => handleDelete(editing.rule!.id) : undefined}
            />
          ) : (
            <div className="flex justify-end">
              <Button onClick={() => setEditing({ rule: null })}>+ New rule</Button>
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-3 py-2 text-left">Priority</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Conditions</th>
                  <th className="px-3 py-2 text-left">Enabled</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-zinc-500">
                      No rules yet. Create one to start auto-accepting motor-club jobs.
                    </td>
                  </tr>
                )}
                {rules.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-zinc-300">{r.priority}</td>
                    <td className="px-3 py-2 font-medium text-zinc-100">{r.name}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium text-white',
                          ACTION_COLOR[r.action],
                        )}
                      >
                        {r.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-400">
                      {r.conditions.length === 0
                        ? '(no conditions — matches all)'
                        : r.conditions.map(describeCondition).join(' AND ')}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{r.enabled ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing({ rule: r })}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'decisions' && <DecisionsTab />}
      {tab === 'stats' && <StatsTab />}
      {tab === 'sandbox' && <SandboxTab rules={rules} />}
    </div>
  );
}
