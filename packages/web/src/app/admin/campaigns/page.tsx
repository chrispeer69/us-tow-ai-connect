'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/utils';

/**
 * Session 78 — Outreach Campaigns.
 *
 * The point of this page is the bottom half: a call list with the transcript
 * readable inline and the recording playable inline. Everything above it exists
 * to get calls into that list safely.
 *
 * Campaign calls are deliberately NOT on the Flip Engine board — a 30-second
 * "claim your free profile" call has no vehicle, no motor club and no offer
 * ladder, and mixing them would corrupt the flip win-rate population.
 */

interface Campaign {
  id: string;
  name: string;
  slug: string;
  status: 'OFF' | 'ACTIVE' | 'PAUSED';
  fromNumber: string | null;
  outboundAgentId: string | null;
  outboundAgentVersion: string | null;
  inboundAgentId: string | null;
  concurrency: number;
  dailyCap: number;
  maxAttempts: number;
  testMode?: boolean;
  testOverrideNumber?: string | null;
  callWindowStartHour: number;
  callWindowEndHour: number;
  callDays: number[];
}

interface CampaignStatus {
  campaign: Campaign & {
    window: { startHour: number; endHour: number; days: number[] };
    testMode?: boolean;
    testOverrideNumber?: string | null;
  };
  leads: Record<string, number>;
  queueDepth: number;
  retryDepth: number;
  today: Record<string, number>;
  dialedToday: number;
  suppressedTotal: number;
}

interface CallRow {
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  phone: string;
  company: string | null;
  status: string;
  disposition: string | null;
  disconnectionReason: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  recordingUrl: string | null;
  summary: string | null;
  sentiment: string | null;
  callbackTime: string | null;
  error: string | null;
  createdAt: string;
}

interface IngestReport {
  received: number;
  added: number;
  duplicates: number;
  suppressed: number;
  mobiles: number;
  invalid: Array<{ input: string; reason: string }>;
}

interface Analytics {
  byVersion: Array<{
    version: string; calls: number; avg_seconds: number; median_seconds: number;
    pitched: number; warm: number; voicemail: number; opted_out: number;
    gatekeeper: number; connected: number;
  }>;
  funnel: { dialed?: number; answered?: number; machine?: number; human?: number; heard_offer?: number; warm?: number };
  byHour: Array<{ hour: number; calls: number; reached_human: number }>;
  objections: Array<{ objection: string; n: number }>;
  needsAttention: Array<{
    id: string; phone: string; company: string | null; disposition: string;
    callbackTime: string | null; summary: string | null; durationSeconds: number | null; createdAt: string;
  }>;
}

interface RunResult {
  campaign: string;
  dryRun: boolean;
  testMode: boolean;
  testOverrideNumber: string | null;
  considered: number;
  placed: number;
  skipped: Record<string, number>;
  wouldDial: Array<{ phone: string; company: string | null; timezone: string | null }>;
  errors: string[];
}

/** Disposition → badge colour. Deliberately not all red/green: most outcomes
 *  here are neither a win nor a failure, and colouring them as failures is how
 *  a working campaign gets read as a broken one. */
const DISPOSITION_STYLE: Record<string, string> = {
  PITCHED: 'bg-emerald-900/40 text-emerald-200 border-emerald-700',
  WARM: 'bg-amber-900/40 text-amber-200 border-amber-600',
  VM: 'bg-sky-900/40 text-sky-200 border-sky-700',
  RETRY: 'bg-slate-800 text-slate-300 border-slate-600',
  GATEKEEPER: 'bg-indigo-900/40 text-indigo-200 border-indigo-700',
  NOT_INTERESTED: 'bg-slate-800 text-slate-400 border-slate-600',
  DNC: 'bg-rose-950/50 text-rose-200 border-rose-700',
  ERROR: 'bg-rose-950/50 text-rose-300 border-rose-800',
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pasteText, setPasteText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestReport, setIngestReport] = useState<IngestReport | null>(null);

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runLimit, setRunLimit] = useState('5');

  const [removePhone, setRemovePhone] = useState('');
  const [tab, setTab] = useState<'calls' | 'performance'>('calls');
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [testNumber, setTestNumber] = useState('');

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await api<{ data: Campaign[] }>('/v1/admin/campaigns');
      setCampaigns(res.data);
      if (res.data.length > 0) {
        setSelectedId((current) => current ?? res.data[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async (id: string) => {
    try {
      const res = await api<{ data: CampaignStatus }>(`/v1/admin/campaigns/${id}/status`);
      setStatus(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadCalls = useCallback(async (id: string, disposition: string) => {
    try {
      const query = disposition ? `?disposition=${encodeURIComponent(disposition)}` : '';
      const res = await api<{ data: CallRow[] }>(`/v1/admin/campaigns/${id}/calls${query}`);
      setCalls(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadAnalytics = useCallback(async (id: string) => {
    try {
      const res = await api<{ data: Analytics }>(`/v1/admin/campaigns/${id}/analytics`);
      setAnalytics(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  // Only fetch the expensive aggregate when the tab is actually open.
  useEffect(() => {
    if (tab === 'performance' && selectedId) void loadAnalytics(selectedId);
  }, [tab, selectedId, loadAnalytics]);

  useEffect(() => {
    if (!selectedId) return;
    void loadStatus(selectedId);
    void loadCalls(selectedId, filter);
  }, [selectedId, filter, loadStatus, loadCalls]);

  // Poll while a campaign is live so calls appear as they land, without
  // needing a socket. 15s is slow enough to be free and fast enough that Chris
  // sees a call before he wonders whether it worked.
  useEffect(() => {
    if (!selectedId || status?.campaign.status !== 'ACTIVE') return;
    const t = setInterval(() => {
      void loadStatus(selectedId);
      void loadCalls(selectedId, filter);
    }, 15000);
    return () => clearInterval(t);
  }, [selectedId, status?.campaign.status, filter, loadStatus, loadCalls]);

  const campaign = status?.campaign;

  useEffect(() => {
    if (campaign?.testOverrideNumber) setTestNumber(campaign.testOverrideNumber);
  }, [campaign?.testOverrideNumber]);

  const setTestMode = async (on: boolean) => {
    if (!selectedId) return;
    try {
      await api(`/v1/admin/campaigns/${selectedId}`, {
        method: 'PATCH',
        json: { testMode: on, testOverrideNumber: testNumber || undefined },
      });
      await loadStatus(selectedId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setCampaignStatus = async (next: 'OFF' | 'ACTIVE' | 'PAUSED') => {
    if (!selectedId) return;
    try {
      await api(`/v1/admin/campaigns/${selectedId}`, { method: 'PATCH', json: { status: next } });
      await loadStatus(selectedId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const doIngest = async () => {
    if (!selectedId || !pasteText.trim()) return;
    setIngesting(true);
    setIngestReport(null);
    try {
      const res = await api<{ data: IngestReport }>(`/v1/admin/campaigns/${selectedId}/leads`, {
        method: 'POST',
        json: { text: pasteText },
      });
      setIngestReport(res.data);
      setPasteText('');
      await loadStatus(selectedId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIngesting(false);
    }
  };

  const doRun = async (dryRun: boolean) => {
    if (!selectedId) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api<{ data: RunResult }>(`/v1/admin/campaigns/${selectedId}/run`, {
        method: 'POST',
        json: { dryRun, limit: runLimit ? Number(runLimit) : undefined },
      });
      setRunResult(res.data);
      await loadStatus(selectedId);
      await loadCalls(selectedId, filter);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const doRemove = async (kind: 'accepted' | 'dnc') => {
    if (!removePhone.trim()) return;
    try {
      await api(`/v1/admin/campaigns/leads/${kind}`, {
        method: 'POST',
        json: { phone: removePhone },
      });
      setRemovePhone('');
      if (selectedId) await loadStatus(selectedId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const readiness = useMemo(() => {
    if (!campaign) return [];
    const issues: string[] = [];
    if (!campaign.fromNumber) issues.push('No phone number bound — run scripts/usta-retell-setup.js');
    if (!campaign.outboundAgentId) issues.push('No outbound agent configured');
    if (!campaign.outboundAgentVersion)
      issues.push('Outbound agent is UNPINNED — it will run the latest draft, published or not');
    if (!campaign.inboundAgentId) issues.push('No inbound agent — returned calls will not be answered');
    return issues;
  }, [campaign]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-300">
        No campaigns for this account.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Outreach Campaigns</h1>
          <p className="text-sm text-slate-400">
            Outbound calling that is not a tow job. Transcripts and recordings below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {readiness.length > 0 && (
        <div className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
          <div className="font-medium">Not ready to dial</div>
          <ul className="mt-1 list-disc pl-5">
            {readiness.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Test mode ------------------------------------------------------
          Loud on purpose. A campaign silently redirecting every call is the
          kind of state you must never discover from a phone bill. */}
      {campaign?.testMode && (
        <div className="rounded border border-sky-600 bg-sky-950/40 p-3 text-sm text-sky-100">
          <span className="font-semibold">TEST MODE.</span> Every call is going to{' '}
          <span className="font-mono">{campaign.testOverrideNumber ?? '(not set)'}</span> instead of the
          prospect. Leads are still claimed and attempts still counted.
          {!campaign.testOverrideNumber && (
            <span className="ml-1 font-semibold text-rose-200">
              No number set — the dialler will refuse to run.
            </span>
          )}
        </div>
      )}

      {/* ---- Status strip -------------------------------------------------- */}
      {status && campaign && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <Badge
                className={
                  campaign.status === 'ACTIVE'
                    ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200'
                    : campaign.status === 'PAUSED'
                      ? 'border-amber-600 bg-amber-900/40 text-amber-200'
                      : 'border-slate-600 bg-slate-800 text-slate-300'
                }
              >
                {campaign.status}
              </Badge>
              <span className="text-sm text-slate-300">
                {campaign.fromNumber ?? 'no number'} · {campaign.concurrency} at a time · cap{' '}
                {campaign.dailyCap}/day · {campaign.maxAttempts} attempts
              </span>
              <span className="text-sm text-slate-400">
                {campaign.window.startHour}:00–{campaign.window.endHour}:00 local to each number,{' '}
                {campaign.window.days.map((d) => DAY_LABELS[d - 1]).join(' ')}
              </span>
              <div className="ml-auto flex gap-2">
                {campaign.status !== 'ACTIVE' && (
                  <Button
                    size="sm"
                    onClick={() => setCampaignStatus('ACTIVE')}
                    disabled={readiness.length > 0}
                    title={readiness.length > 0 ? 'Resolve the warnings above first' : undefined}
                  >
                    Start
                  </Button>
                )}
                {campaign.status === 'ACTIVE' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setCampaignStatus('PAUSED')}>
                      Pause
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setCampaignStatus('OFF')}>
                      Stop
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Queue" value={status.queueDepth} />
              <Stat label="Retry / VM" value={status.retryDepth} />
              <Stat label="Dialed today" value={status.dialedToday} />
              <Stat label="Pitched today" value={status.today.PITCHED ?? 0} tone="good" />
              <Stat label="Warm today" value={status.today.WARM ?? 0} tone="warm" />
              <Stat label="Suppressed" value={status.suppressedTotal} tone="bad" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Import + run -------------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-medium text-slate-200">Add numbers</h2>
            <p className="text-xs text-slate-400">
              Paste anything — one per line, or CSV. Extensions, parens, dashes and a leading 1 are
              all fine. Duplicates and suppressed numbers are dropped automatically.
            </p>
            <Textarea
              rows={6}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'614-555-0100, Wayne\'s Towing, OH\n(740) 555-0142 x12\n2205550188'}
              className="font-mono text-xs"
            />
            <Button onClick={doIngest} disabled={ingesting || !pasteText.trim()} size="sm">
              {ingesting ? 'Importing…' : 'Import'}
            </Button>

            {ingestReport && (
              <div className="rounded border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300">
                <div className="flex flex-wrap gap-3">
                  <span>received {ingestReport.received}</span>
                  <span className="text-emerald-300">added {ingestReport.added}</span>
                  <span>duplicates {ingestReport.duplicates}</span>
                  <span className="text-rose-300">suppressed {ingestReport.suppressed}</span>
                  <span className="text-amber-300">invalid {ingestReport.invalid.length}</span>
                </div>
                {ingestReport.invalid.length > 0 && (
                  <ul className="mt-2 max-h-32 overflow-y-auto font-mono">
                    {ingestReport.invalid.slice(0, 40).map((row, i) => (
                      <li key={i} className="text-amber-200">
                        {row.input} — {row.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-medium text-slate-200">Run a batch</h2>
            <p className="text-xs text-slate-400">
              A dry run resolves every guard — window, caps, suppression — and reports what would be
              dialled without placing a call. Always dry-run a fresh list first.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={runLimit}
                onChange={(e) => setRunLimit(e.target.value)}
                className="w-24"
                placeholder="limit"
              />
              <Button size="sm" variant="outline" onClick={() => doRun(true)} disabled={running}>
                Dry run
              </Button>
              <Button
                size="sm"
                onClick={() => doRun(false)}
                disabled={running || campaign?.status !== 'ACTIVE'}
                title={campaign?.status !== 'ACTIVE' ? 'Campaign must be ACTIVE to place calls' : undefined}
              >
                {running ? 'Running…' : 'Run live'}
              </Button>
            </div>

            {runResult && (
              <div className="rounded border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300">
                <div className="flex flex-wrap gap-3">
                  <span>{runResult.dryRun ? 'DRY RUN' : 'LIVE'}</span>
                  <span>considered {runResult.considered}</span>
                  <span className="text-emerald-300">
                    {runResult.dryRun ? `would dial ${runResult.wouldDial.length}` : `placed ${runResult.placed}`}
                  </span>
                </div>
                {runResult.errors.length > 0 && (
                  <div className="mt-2 text-rose-300">{runResult.errors.join(' · ')}</div>
                )}
                {Object.keys(runResult.skipped).length > 0 && (
                  <div className="mt-2">
                    skipped:{' '}
                    {Object.entries(runResult.skipped)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(', ')}
                  </div>
                )}
                {runResult.wouldDial.length > 0 && (
                  <ul className="mt-2 max-h-32 overflow-y-auto font-mono">
                    {runResult.wouldDial.map((d) => (
                      <li key={d.phone}>
                        {d.phone} {d.company ? `· ${d.company}` : ''}{' '}
                        <span className="text-slate-500">{d.timezone}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="border-t border-slate-800 pt-3">
              <h3 className="text-xs font-medium text-slate-300">Test mode</h3>
              <p className="mt-1 text-xs text-slate-400">
                Send every call to your own phone instead of the prospect. The whole pipeline still
                runs — lead claimed, attempt counted, transcript and recording saved.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={testNumber}
                  onChange={(e) => setTestNumber(e.target.value)}
                  placeholder="740-880-7758"
                  className="w-44"
                />
                {campaign?.testMode ? (
                  <Button size="sm" variant="outline" onClick={() => void setTestMode(false)}>
                    Turn off
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void setTestMode(true)}
                    disabled={!testNumber.trim()}
                  >
                    Turn on
                  </Button>
                )}
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3">
              <h3 className="text-xs font-medium text-slate-300">Remove a number</h3>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={removePhone}
                  onChange={(e) => setRemovePhone(e.target.value)}
                  placeholder="614-555-0100"
                  className="w-44"
                />
                <Button size="sm" variant="outline" onClick={() => doRemove('accepted')}>
                  Claimed
                </Button>
                <Button size="sm" variant="outline" onClick={() => doRemove('dnc')}>
                  Do not call
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- The call list — the point of this page ------------------------ */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex gap-1 border-b border-slate-800">
            {(['calls', 'performance'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${
                  tab === t
                    ? 'border-slate-300 text-slate-100'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'performance' && <PerformanceTab analytics={analytics} />}

          {tab === 'calls' && (
          <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-slate-200">Calls</h2>
            <div className="ml-auto flex flex-wrap gap-1">
              {['', 'PITCHED', 'WARM', 'VM', 'GATEKEEPER', 'DNC', 'RETRY', 'ERROR'].map((d) => (
                <button
                  key={d || 'all'}
                  onClick={() => setFilter(d)}
                  className={`rounded border px-2 py-1 text-xs ${
                    filter === d
                      ? 'border-slate-400 bg-slate-700 text-slate-100'
                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {d || 'All'}
                </button>
              ))}
            </div>
          </div>

          {calls.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No calls yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Dir</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <>
                    <TableRow key={call.id} className="cursor-pointer" onClick={() => setExpanded(expanded === call.id ? null : call.id)}>
                      <TableCell className="whitespace-nowrap text-xs text-slate-400">
                        {new Date(call.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{call.phone}</TableCell>
                      <TableCell className="text-xs text-slate-300">{call.company ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {call.direction === 'INBOUND' ? '← in' : '→ out'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            DISPOSITION_STYLE[call.disposition ?? ''] ??
                            'border-slate-600 bg-slate-800 text-slate-300'
                          }
                        >
                          {call.disposition ?? call.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {call.durationSeconds != null ? `${call.durationSeconds}s` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs text-slate-500">
                        {expanded === call.id ? '▲' : '▼'}
                      </TableCell>
                    </TableRow>

                    {expanded === call.id && (
                      <TableRow key={`${call.id}-detail`}>
                        <TableCell colSpan={7} className="bg-slate-950/60">
                          <div className="space-y-3 p-2">
                            {call.recordingUrl && (
                              <div>
                                <div className="mb-1 text-xs font-medium text-slate-300">Recording</div>
                                {/* Native audio element: the URL is a signed
                                    Retell link and needs no player of ours. */}
                                <audio controls preload="none" src={call.recordingUrl} className="w-full max-w-lg">
                                  <track kind="captions" />
                                </audio>
                              </div>
                            )}

                            {call.summary && (
                              <div>
                                <div className="text-xs font-medium text-slate-300">Summary</div>
                                <p className="text-xs text-slate-400">{call.summary}</p>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                              {call.sentiment && <span>sentiment: {call.sentiment}</span>}
                              {call.callbackTime && <span>callback: {call.callbackTime}</span>}
                              {call.disconnectionReason && <span>ended: {call.disconnectionReason}</span>}
                              {call.error && <span className="text-rose-300">error: {call.error}</span>}
                            </div>

                            {call.transcript ? (
                              <div>
                                <div className="mb-1 text-xs font-medium text-slate-300">Transcript</div>
                                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-300">
                                  {call.transcript}
                                </pre>
                              </div>
                            ) : (
                              <div className="text-xs text-slate-600">No transcript.</div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
          </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Is it getting better?
 *
 * On 2026-08-20 the first live batch ran four agent versions in ninety minutes,
 * and answering that question meant a person reading eighteen transcripts by
 * hand. The answer was worth having — median call length went 9s to 32s — and
 * nothing in the product could surface it.
 *
 * Everything here groups by AGENT VERSION, because that is the unit of change.
 * A number that pools every version together answers a question nobody asked.
 */
function PerformanceTab({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const f = analytics.funnel ?? {};
  const dialed = f.dialed ?? 0;
  const pct = (n: number | undefined) => (dialed ? Math.round(((n ?? 0) / dialed) * 100) : 0);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-200">Funnel</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <FunnelStep label="Dialed" value={dialed} pct={100} />
          <FunnelStep label="Answered" value={f.answered ?? 0} pct={pct(f.answered)} />
          <FunnelStep label="Reached a human" value={f.human ?? 0} pct={pct(f.human)} />
          <FunnelStep label="Heard the offer" value={f.heard_offer ?? 0} pct={pct(f.heard_offer)} tone="good" />
          <FunnelStep label="Warm" value={f.warm ?? 0} pct={pct(f.warm)} tone="warm" />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {f.machine ?? 0} reached an answering machine. Reached a human excludes voicemail and calls
          that died before the pitch — a batch can look busy while reaching nobody.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-200">By agent version</h3>
        <p className="mb-2 text-xs text-slate-500">
          The unit of change. Median call length is the earliest signal that a script edit worked —
          it moves days before win rate does.
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Median</TableHead>
                <TableHead className="text-right">Avg</TableHead>
                <TableHead className="text-right">Reached</TableHead>
                <TableHead className="text-right">Pitched</TableHead>
                <TableHead className="text-right">Warm</TableHead>
                <TableHead className="text-right">VM</TableHead>
                <TableHead className="text-right">Opt-out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analytics.byVersion.map((v) => (
                <TableRow key={v.version}>
                  <TableCell className="font-mono text-xs">v{v.version}</TableCell>
                  <TableCell className="text-right text-xs">{v.calls}</TableCell>
                  <TableCell className="text-right text-xs font-semibold text-slate-100">
                    {v.median_seconds}s
                  </TableCell>
                  <TableCell className="text-right text-xs text-slate-400">{v.avg_seconds}s</TableCell>
                  <TableCell className="text-right text-xs">{v.connected}</TableCell>
                  <TableCell className="text-right text-xs text-emerald-300">{v.pitched}</TableCell>
                  <TableCell className="text-right text-xs text-amber-300">{v.warm}</TableCell>
                  <TableCell className="text-right text-xs text-sky-300">{v.voicemail}</TableCell>
                  <TableCell className="text-right text-xs text-rose-300">{v.opted_out}</TableCell>
                </TableRow>
              ))}
              {analytics.byVersion.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-6 text-center text-sm text-slate-500">
                    No calls yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {analytics.byVersion.length === 1 && (
          <p className="mt-2 text-xs text-amber-300/80">
            Only one version has run. Resist changing the agent again until this one has enough calls
            to read — a version that never gets a sample can never be compared.
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-200">
          Needs you ({analytics.needsAttention.length})
        </h3>
        <p className="mb-2 text-xs text-slate-500">
          Warm leads and gatekeeper callbacks. These are the only rows on this page worth acting on
          today.
        </p>
        {analytics.needsAttention.length === 0 ? (
          <div className="rounded border border-slate-800 bg-slate-900/40 py-6 text-center text-sm text-slate-500">
            Nothing waiting.
          </div>
        ) : (
          <div className="space-y-2">
            {analytics.needsAttention.map((r) => (
              <div key={r.id} className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={
                      r.disposition === 'WARM'
                        ? 'border-amber-600 bg-amber-900/40 text-amber-200'
                        : 'border-indigo-700 bg-indigo-900/40 text-indigo-200'
                    }
                  >
                    {r.disposition}
                  </Badge>
                  <span className="text-sm text-slate-200">{r.company ?? 'Unknown'}</span>
                  <span className="font-mono text-xs text-slate-400">{r.phone}</span>
                  {r.callbackTime && (
                    <span className="text-xs text-slate-300">call back: {r.callbackTime}</span>
                  )}
                  <span className="ml-auto text-xs text-slate-500">{r.durationSeconds ?? 0}s</span>
                </div>
                {r.summary && <p className="mt-1 text-xs text-slate-400">{r.summary}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-200">Best hours to call</h3>
        <p className="mb-2 text-xs text-slate-500">
          The 9-5 window is an assumption. This is the only thing that can correct it.
        </p>
        <div className="space-y-1">
          {analytics.byHour.map((h) => {
            const rate = h.calls ? Math.round((h.reached_human / h.calls) * 100) : 0;
            return (
              <div key={h.hour} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-slate-400">
                  {h.hour % 12 === 0 ? 12 : h.hour % 12}
                  {h.hour < 12 ? 'am' : 'pm'}
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded bg-slate-800">
                  <div className="h-full bg-emerald-700" style={{ width: `${rate}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-slate-500">
                  {h.reached_human}/{h.calls} ({rate}%)
                </span>
              </div>
            );
          })}
          {analytics.byHour.length === 0 && <div className="text-sm text-slate-500">No calls yet.</div>}
        </div>
      </div>

      {analytics.objections.filter((o) => o.objection !== '(none)').length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-200">What they push back on</h3>
          <div className="flex flex-wrap gap-2">
            {analytics.objections
              .filter((o) => o.objection !== '(none)')
              .map((o) => (
                <span
                  key={o.objection}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"
                >
                  {o.objection} <span className="text-slate-500">{o.n}</span>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FunnelStep({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: number;
  pct: number;
  tone?: 'good' | 'warm';
}) {
  const colour =
    tone === 'good' ? 'text-emerald-300' : tone === 'warm' ? 'text-amber-300' : 'text-slate-200';
  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${colour}`}>{value}</div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-slate-600" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-slate-600">{pct}%</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'good' | 'warm' | 'bad';
}) {
  const colour =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'warm'
        ? 'text-amber-300'
        : tone === 'bad'
          ? 'text-rose-300'
          : 'text-slate-200';
  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${colour}`}>{value}</div>
    </div>
  );
}
