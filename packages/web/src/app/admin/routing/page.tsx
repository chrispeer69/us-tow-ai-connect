'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/utils';

interface RoutingRule {
  id: string;
  ruleName: string;
  phoneNumber: string;
  isActiveNow: boolean;
  priorityOrder: number;
  createdAt: string;
}

const E164 = /^\+?[1-9]\d{6,14}$/;

export default function RoutingPage() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRules();
  }, []);

  async function fetchRules() {
    setLoading(true);
    try {
      const data = await api<RoutingRule[]>('/v1/admin/routing-rules');
      setRules(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function addRule() {
    if (!newName.trim() || !E164.test(newPhone)) {
      setError('Phone must be in E.164 format (e.g. +16143069970)');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await api('/v1/admin/routing-rules', {
        method: 'POST',
        json: { ruleName: newName.trim(), phoneNumber: newPhone.trim() },
      });
      setNewName('');
      setNewPhone('');
      await fetchRules();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function activate(id: string) {
    try {
      await api(`/v1/admin/routing-rules/${id}/activate`, { method: 'POST' });
      await fetchRules();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteRule(id: string) {
    try {
      await api(`/v1/admin/routing-rules/${id}`, { method: 'DELETE' });
      await fetchRules();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const active = rules.find((r) => r.isActiveNow);

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Call Transfer Routing"
        subtitle="Manage which phone number receives transferred calls."
      />

      {active && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
              Active Route
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-emerald-300">{active.ruleName}</div>
            <div className="text-sm text-zinc-300 font-mono">{active.phoneNumber}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-400">
              <Spinner /> Loading rules...
            </div>
          ) : rules.length === 0 ? (
            <p className="text-sm text-zinc-400">No rules yet. Add one below.</p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {rules.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <div className="font-medium">{r.ruleName}</div>
                    <div className="text-sm text-zinc-400 font-mono">{r.phoneNumber}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.isActiveNow ? (
                      <Badge variant="success">ACTIVE</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => activate(r.id)}>
                        Set Active
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteRule(r.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add Rule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Rule name (e.g. Night Dispatch)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            placeholder="+16143069970"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
          />
          <Button onClick={addRule} disabled={adding}>
            {adding ? <Spinner className="mr-2" /> : null}
            Add Rule
          </Button>
          {error && <p className="text-sm text-red-400 break-words">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
