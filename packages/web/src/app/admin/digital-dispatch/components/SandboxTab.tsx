'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Rule } from '@/lib/digital-dispatch-types';
import type { UnifiedJob } from '@/lib/command-center-types';
import { api } from '@/lib/utils';

interface EngineResult {
  decision: 'accepted' | 'declined' | 'flagged';
  ruleId: string | null;
  reason: string;
  evaluatedConditions: Array<{
    ruleId: string;
    ruleName: string;
    matched: boolean;
    results: Array<{ type: string; matched: boolean; reason: string }>;
  }>;
}

interface JobsListItem {
  id: string;
  callerName: string | null;
  source: string;
  sourceJobId: string;
  status: string;
}

export function SandboxTab({ rules }: { rules: Rule[] }) {
  const [jobs, setJobs] = useState<JobsListItem[]>([]);
  const [jobId, setJobId] = useState<string>('');
  const [ruleId, setRuleId] = useState<string>(rules[0]?.id ?? '');
  const [result, setResult] = useState<EngineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ items: UnifiedJob[] }>(
          '/v1/admin/command-center/jobs?limit=50',
        );
        setJobs(
          data.items.map((j) => ({
            id: j.id,
            callerName: j.callerName,
            source: j.source,
            sourceJobId: j.sourceJobId,
            status: j.status,
          })),
        );
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ruleId && rules[0]) setRuleId(rules[0].id);
  }, [rules, ruleId]);

  async function runTest() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api<EngineResult>(`/v1/admin/digital-dispatch/rules/${ruleId}/test`, {
        method: 'POST',
        json: { job_id: jobId },
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-medium text-zinc-200">Test against a real job</h3>
        <p className="text-xs text-zinc-500">
          Pick a rule and a job — we run the rules engine in dry-run mode and show what it
          would decide and why. No side effects.
        </p>
        <label className="block text-sm text-zinc-300">
          Rule
          <select
            value={ruleId}
            onChange={(e) => setRuleId(e.target.value)}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100"
          >
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.action})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-zinc-300">
          Job
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100"
          >
            <option value="">Pick a job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.callerName || '(no name)'} — {j.source} ({j.status})
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => void runTest()} disabled={busy || !ruleId || !jobId}>
          {busy ? 'Running…' : 'Run test'}
        </Button>
        {err && <p className="text-sm text-red-400">{err}</p>}
      </div>

      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-medium text-zinc-200">Result</h3>
        {!result ? (
          <p className="text-sm text-zinc-500">Run a test to see the engine trace.</p>
        ) : (
          <>
            <p className="text-zinc-200">
              Decision: <span className="font-medium">{result.decision}</span>
            </p>
            <p className="text-xs text-zinc-400">{result.reason}</p>
            <Textarea
              readOnly
              value={JSON.stringify(result.evaluatedConditions, null, 2)}
              className="min-h-[260px] font-mono text-xs"
            />
          </>
        )}
      </div>
    </div>
  );
}
