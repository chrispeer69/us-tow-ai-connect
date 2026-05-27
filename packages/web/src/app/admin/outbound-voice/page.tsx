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
import { api } from '@/lib/utils';

interface OutboundCallRow {
  id: string;
  tenant_id: string;
  purpose: string;
  related_job_id: string | null;
  to_phone: string;
  to_name: string | null;
  script_template: string;
  script_variables: Record<string, unknown>;
  thinkrr_call_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  recording_url: string | null;
  outcome: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  status: string;
  data: { items: OutboundCallRow[]; limit: number; offset: number };
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

  const stats = useMemo(() => {
    const last24h = rows.filter((r) => Date.now() - new Date(r.created_at).getTime() < 24 * 60 * 60 * 1000);
    const completed = last24h.filter((r) => r.status === 'completed');
    const totalDuration = completed.reduce((acc, r) => acc + (r.duration_seconds ?? 0), 0);
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

  useEffect(() => {
    void load();
  }, [load]);

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
          to_phone: form.to_phone,
          to_name: form.to_name || undefined,
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
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{purposeLabel(r.purpose)}</TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{r.to_phone}</div>
                      {r.to_name && <div className="text-xs text-zinc-500">{r.to_name}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[r.status] ?? 'bg-zinc-700 text-zinc-200'}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.attempts}/{r.max_attempts}</TableCell>
                    <TableCell>{r.duration_seconds != null ? `${r.duration_seconds}s` : '—'}</TableCell>
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
        <Field label="Thinkrr ID" value={call.thinkrr_call_id ?? '—'} mono />
        <Field label="Template" value={call.script_template} />
        <Field label="Started" value={call.started_at ?? '—'} />
        <Field label="Ended" value={call.ended_at ?? '—'} />
        <Field label="Related job" value={call.related_job_id ?? '—'} mono />
      </div>

      {call.transcript && (
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Transcript</div>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-zinc-950 p-3 text-xs text-zinc-200">
            {call.transcript}
          </pre>
        </div>
      )}

      {call.recording_url && (
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Recording</div>
          <audio controls className="mt-1 w-full" src={call.recording_url} />
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
          {JSON.stringify(call.script_variables, null, 2)}
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
