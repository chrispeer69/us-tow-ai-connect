'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/utils';

interface OutboundCallRow {
  id: string;
  tenantId: string;
  purpose: string;
  relatedJobId: string | null;
  toPhone: string;
  toName: string | null;
  scriptTemplate: string;
  scriptVariables: Record<string, unknown>;
  thinkrrCallId: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  scheduledFor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  recordingUrl: string | null;
  outcome: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  status: string;
  data: { items: OutboundCallRow[]; limit: number; offset: number };
}

interface OutboundVoiceConfigResponse {
  status: string;
  data: {
    enabled: boolean;
    activeProvider: string;
    config: Record<string, unknown>;
  };
}

const PAGE_SIZE = 50;

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-zinc-700 text-zinc-200',
  dialing: 'bg-blue-900 text-blue-200',
  in_progress: 'bg-indigo-900 text-indigo-200',
  completed: 'bg-emerald-900 text-emerald-200',
  failed: 'bg-rose-900 text-rose-200',
  no_answer: 'bg-amber-900 text-amber-200',
  busy: 'bg-amber-900 text-amber-200',
  rejected: 'bg-rose-900 text-rose-200',
  cancelled: 'bg-zinc-800 text-zinc-300',
};

const PURPOSES: { value: string; label: string }[] = [
  { value: 'customer_status_update', label: 'Customer status update' },
  { value: 'eta_confirmation', label: 'ETA confirmation' },
  { value: 'post_job_followup', label: 'Post-job follow-up' },
  { value: 'driver_escalation', label: 'Driver escalation' },
  { value: 'motor_club_update', label: 'Motor club update' },
  { value: 'custom', label: 'Custom' },
];

const STATUSES = [
  'queued',
  'dialing',
  'in_progress',
  'completed',
  'failed',
  'no_answer',
  'busy',
  'rejected',
  'cancelled',
];

interface PlaceCallForm {
  purpose: string;
  to_phone: string;
  to_name: string;
  script_template: string;
  variables: string;
  related_job_id: string;
}

const DEFAULT_FORM: PlaceCallForm = {
  purpose: 'customer_status_update',
  to_phone: '',
  to_name: '',
  script_template: 'customer_status_update',
  variables:
    '{\n  "customer_name": "",\n  "company_name": "",\n  "job_id": "",\n  "status": ""\n}',
  related_job_id: '',
};

export default function OutboundVoicePage() {
  const [rows, setRows] = useState<OutboundCallRow[]>([]);
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPlaceCall, setShowPlaceCall] = useState(false);
  const [form, setForm] = useState<PlaceCallForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [outboundEnabled, setOutboundEnabled] = useState(false);
  const [activeProvider, setActiveProvider] = useState('');
  const [voiceConfig, setVoiceConfig] = useState<Record<string, unknown>>({});
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [testOverrideNumber, setTestOverrideNumber] = useState('');

  const stats = useMemo(() => {
    const last24h = rows.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 24 * 60 * 60 * 1000);
    const completed = last24h.filter((r) => r.status === 'completed');
    const totalDuration = completed.reduce((acc, r) => acc + (r.durationSeconds ?? 0), 0);
    const queued = rows.filter((r) => r.status === 'queued');
    return {
      total24h: last24h.length,
      successRate: last24h.length > 0
        ? Math.round((completed.length / last24h.length) * 100)
        : 0,
      avgDuration: completed.length > 0
        ? Math.round(totalDuration / completed.length)
        : 0,
      queued: queued.length,
    };
  }, [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = new URLSearchParams();
      qp.set('limit', String(PAGE_SIZE));
      qp.set('offset', String(offset));
      if (purpose) qp.set('purpose', purpose);
      if (status) qp.set('status', status);
      const data = await api<ListResponse>(`/v1/admin/outbound-voice/calls?${qp.toString()}`);
      setRows(data.data.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [offset, purpose, status]);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setError(null);
    try {
      const data = await api<OutboundVoiceConfigResponse>('/v1/admin/outbound-voice/config');
      const cfg = data.data.config ?? {};
      setOutboundEnabled(data.data.enabled);
      setActiveProvider(data.data.activeProvider);
      setVoiceConfig(cfg);
      setTestModeEnabled(cfg.test_mode_enabled === true);
      setTestOverrideNumber(typeof cfg.test_override_number === 'string' ? cfg.test_override_number : '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const onClearFilters = () => {
    setPurpose('');
    setStatus('');
    setOffset(0);
  };

  const submitPlaceCall = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      let parsedVariables: Record<string, unknown>;
      try {
        parsedVariables = JSON.parse(form.variables || '{}');
      } catch (err) {
        throw new Error(`Invalid JSON in variables: ${(err as Error).message}`);
      }
      await api('/v1/admin/outbound-voice/calls', {
        method: 'POST',
        body: JSON.stringify({
          purpose: form.purpose,
          toPhone: form.to_phone,
          toName: form.to_name || undefined,
          scriptTemplate: form.script_template,
          scriptVariables: parsedVariables,
          relatedJobId: form.related_job_id || undefined,
        }),
        headers: { 'content-type': 'application/json' },
      });
      setShowPlaceCall(false);
      setForm(DEFAULT_FORM);
      await load();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const onCancel = async (id: string) => {
    setActionPending(id);
    try {
      await api(`/v1/admin/outbound-voice/calls/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionPending(null);
    }
  };

  const onRetry = async (id: string) => {
    setActionPending(id);
    try {
      await api(`/v1/admin/outbound-voice/calls/${id}/retry`, { method: 'POST' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionPending(null);
    }
  };

  const saveTestMode = async () => {
    setConfigSaving(true);
    setError(null);
    try {
      const normalizedNumber = testOverrideNumber.trim();
      await api('/v1/admin/outbound-voice/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: outboundEnabled,
          config: {
            ...voiceConfig,
            test_mode_enabled: testModeEnabled,
            test_override_number: normalizedNumber || null,
          },
        }),
      });
      await loadConfig();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfigSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Outbound Voice</h1>
          <p className="text-sm text-zinc-400">
            AI-driven outbound calls to customers, drivers, and motor clubs.
            Powered by the Thinkrr outbound agent.
          </p>
        </div>
        <Button onClick={() => setShowPlaceCall(true)}>+ Place call</Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Calls (24h)" value={String(stats.total24h)} />
        <StatCard label="Success rate" value={`${stats.successRate}%`} />
        <StatCard
          label="Avg duration"
          value={stats.avgDuration ? `${stats.avgDuration}s` : '—'}
        />
        <StatCard label="Queued" value={String(stats.queued)} />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Tenant test mode</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Route this tenant's outbound AI calls to a test phone number before Retell places the call.
              </p>
              <div className="mt-2 text-xs text-zinc-500">
                Provider: {activeProvider || '—'} · Outbound voice: {outboundEnabled ? 'enabled' : 'disabled'}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-300">Route to test number</span>
              <Switch
                checked={testModeEnabled}
                disabled={configLoading || configSaving}
                onCheckedChange={setTestModeEnabled}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(240px,360px)_auto] md:items-end">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Test phone number</div>
              <Input
                value={testOverrideNumber}
                onChange={(event) => setTestOverrideNumber(event.target.value)}
                placeholder="Enter test phone"
                disabled={configLoading || configSaving}
              />
            </div>
            <Button onClick={() => void saveTestMode()} disabled={configLoading || configSaving}>
              {configSaving ? <Spinner className="mr-2" /> : null}
              Save test mode
            </Button>
          </div>

          <div className={`rounded border p-3 text-sm ${
            testModeEnabled
              ? testOverrideNumber.trim()
                ? 'border-amber-800 bg-amber-950/30 text-amber-100'
                : 'border-rose-800 bg-rose-950/30 text-rose-100'
              : 'border-zinc-800 bg-zinc-950/40 text-zinc-300'
          }`}>
            {testModeEnabled
              ? testOverrideNumber.trim()
                ? `Test mode is ON. Calls for this tenant will route to ${testOverrideNumber.trim()}.`
                : 'Test mode is ON but no test number is set. Calls will fail closed instead of calling real customers.'
              : 'Test mode is OFF. Calls for this tenant route to the customer number unless the global env override is enabled.'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Select value={purpose} onValueChange={(v) => { setPurpose(v); setOffset(0); }}>
              <SelectTrigger>
                <SelectValue placeholder="Purpose: any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any purpose</SelectItem>
                {PURPOSES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v); setOffset(0); }}>
              <SelectTrigger>
                <SelectValue placeholder="Status: any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any status</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClearFilters}>Clear</Button>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                {loading ? <Spinner className="mr-2" /> : null}
                Refresh
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-100">
              {error}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                    No outbound calls yet. Configure Thinkrr in Outbound Voice → Settings,
                    then click <span className="text-zinc-300">+ Place call</span> to get started.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <TableRow className="cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <TableCell className="text-xs text-zinc-400">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{purposeLabel(r.purpose)}</TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{r.toPhone}</div>
                      {r.toName && <div className="text-xs text-zinc-500">{r.toName}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[r.status] ?? 'bg-zinc-700 text-zinc-200'}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.attempts}/{r.maxAttempts}</TableCell>
                    <TableCell>{r.durationSeconds != null ? `${r.durationSeconds}s` : '—'}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {(r.status === 'queued' || r.status === 'dialing' || r.status === 'in_progress') && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionPending === r.id}
                          onClick={() => void onCancel(r.id)}
                        >
                          Cancel
                        </Button>
                      )}
                      {(r.status === 'failed' || r.status === 'no_answer' || r.status === 'busy') && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionPending === r.id}
                          onClick={() => void onRetry(r.id)}
                        >
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded === r.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-zinc-950/40">
                        <DetailDrawer call={r} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showPlaceCall && (
        <PlaceCallModal
          form={form}
          setForm={setForm}
          submitting={submitting}
          submitError={submitError}
          onCancel={() => { setShowPlaceCall(false); setSubmitError(null); }}
          onSubmit={submitPlaceCall}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function purposeLabel(value: string): string {
  return PURPOSES.find((p) => p.value === value)?.label ?? value;
}

function DetailDrawer({ call }: { call: OutboundCallRow }) {
  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <Field label="Call ID" value={call.id} mono />
        <Field label="Thinkrr ID" value={call.thinkrrCallId ?? '—'} mono />
        <Field label="Template" value={call.scriptTemplate} />
        <Field label="Started" value={call.startedAt ?? '—'} />
        <Field label="Ended" value={call.endedAt ?? '—'} />
        <Field label="Related job" value={call.relatedJobId ?? '—'} mono />
      </div>

      {call.transcript && (
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Transcript</div>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-zinc-950 p-3 text-xs text-zinc-200">
            {call.transcript}
          </pre>
        </div>
      )}

      {call.recordingUrl && (
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Recording</div>
          <audio controls className="mt-1 w-full" src={call.recordingUrl} />
        </div>
      )}

      {call.outcome && Object.keys(call.outcome).length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Outcome</div>
          <pre className="mt-1 rounded bg-zinc-950 p-3 text-xs text-zinc-300">
            {JSON.stringify(call.outcome, null, 2)}
          </pre>
        </div>
      )}

      {call.error && (
        <div>
          <div className="text-xs uppercase tracking-wide text-rose-400">Error</div>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-rose-950/40 p-3 text-xs text-rose-200">
            {call.error}
          </pre>
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-zinc-400">Variables</summary>
        <pre className="mt-1 rounded bg-zinc-950 p-3 text-xs text-zinc-300">
          {JSON.stringify(call.scriptVariables, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-zinc-200 ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function PlaceCallModal({
  form,
  setForm,
  submitting,
  submitError,
  onCancel,
  onSubmit,
}: {
  form: PlaceCallForm;
  setForm: (f: PlaceCallForm) => void;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold">Place outbound call</h2>
          <p className="text-xs text-zinc-400">
            The call is enqueued immediately and dispatched on the next cron tick (≤30 s).
          </p>

          <Select
            value={form.purpose}
            onValueChange={(v) => setForm({ ...form, purpose: v, script_template: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Purpose" />
            </SelectTrigger>
            <SelectContent>
              {PURPOSES.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder="To phone (e.g. +18785551212)"
              value={form.to_phone}
              onChange={(e) => setForm({ ...form, to_phone: e.target.value })}
            />
            <Input
              placeholder="To name (optional)"
              value={form.to_name}
              onChange={(e) => setForm({ ...form, to_name: e.target.value })}
            />
          </div>

          <Input
            placeholder="Related job id (optional)"
            value={form.related_job_id}
            onChange={(e) => setForm({ ...form, related_job_id: e.target.value })}
          />

          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
              Script variables (JSON)
            </div>
            <textarea
              className="h-40 w-full rounded border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              value={form.variables}
              onChange={(e) => setForm({ ...form, variables: e.target.value })}
            />
          </div>

          {submitError && (
            <div className="rounded border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-100">
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button onClick={onSubmit} disabled={submitting}>
              {submitting ? <Spinner className="mr-2" /> : null}
              Place call
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
