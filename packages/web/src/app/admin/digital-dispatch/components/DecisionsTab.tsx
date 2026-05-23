'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/utils';
import type { DecisionRow } from '@/lib/digital-dispatch-types';

const DECISION_COLOR: Record<string, string> = {
  accepted: 'bg-emerald-600',
  declined: 'bg-red-600',
  flagged: 'bg-amber-500',
  manual: 'bg-zinc-500',
};

export function DecisionsTab() {
  const [items, setItems] = useState<DecisionRow[]>([]);
  const [decisionFilter, setDecisionFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams();
        if (decisionFilter) params.set('decision', decisionFilter);
        const data = await api<{ items: DecisionRow[]; total: number }>(
          `/v1/admin/digital-dispatch/decisions${params.toString() ? `?${params}` : ''}`,
        );
        setItems(data.items);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [decisionFilter]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-400">Filter:</label>
        <select
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
        >
          <option value="">All decisions</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
          <option value="flagged">Flagged</option>
          <option value="manual">Manual</option>
        </select>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Decision</th>
              <th className="px-3 py-2 text-left">Job</th>
              <th className="px-3 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-zinc-500">
                  No decisions yet — once the rules engine fires you'll see entries here.
                </td>
              </tr>
            )}
            {items.map((d) => (
              <>
                <tr
                  key={d.decision.id}
                  className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-800/60"
                  onClick={() => setExpanded((cur) => (cur === d.decision.id ? null : d.decision.id))}
                >
                  <td className="px-3 py-2 text-zinc-300">
                    {new Date(d.decision.decidedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium text-white ${
                        DECISION_COLOR[d.decision.decision] ?? 'bg-zinc-500'
                      }`}
                    >
                      {d.decision.decision}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-200">
                    <div>{d.job.callerName || '—'}</div>
                    <div className="text-xs text-zinc-500">
                      {d.job.source} · {d.job.sourceJobId}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{d.decision.reason || '—'}</td>
                </tr>
                {expanded === d.decision.id && (
                  <tr key={`${d.decision.id}-expanded`} className="bg-zinc-950">
                    <td colSpan={4} className="p-4">
                      <h4 className="mb-2 text-xs uppercase text-zinc-500">
                        Evaluated rules (in order)
                      </h4>
                      <div className="space-y-2">
                        {d.decision.evaluatedConditions.length === 0 && (
                          <p className="text-sm text-zinc-500">No rules to evaluate.</p>
                        )}
                        {d.decision.evaluatedConditions.map((rule) => (
                          <div
                            key={rule.ruleId}
                            className="rounded border border-zinc-800 bg-zinc-900/40 p-3"
                          >
                            <div className="mb-1 flex items-center gap-2">
                              <span className="text-sm font-medium text-zinc-200">
                                {rule.ruleName}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs ${
                                  rule.matched
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-zinc-700 text-zinc-300'
                                }`}
                              >
                                {rule.matched ? 'matched' : 'skipped'}
                              </span>
                            </div>
                            <ul className="space-y-1 text-xs text-zinc-400">
                              {rule.results.map((r, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span
                                    className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full text-[10px] ${
                                      r.matched ? 'bg-emerald-600 text-white' : 'bg-red-700 text-white'
                                    }`}
                                  >
                                    {r.matched ? '✓' : '✕'}
                                  </span>
                                  <span>
                                    <span className="text-zinc-300">{r.type}</span> — {r.reason}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
