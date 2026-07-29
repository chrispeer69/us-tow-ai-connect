'use client';
import React, { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

/** Build headers that include both the JWT token and the super-admin email. */
function authedHeaders(email: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'x-super-admin-email': email, ...extra };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('access_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

interface TenantDetail {
  tenant: {
    id: string;
    companyName: string;
    ownerEmail: string;
    timezone: string;
    targetSoftwareType: string;
    assignedPhoneNumber: string | null;
    thinkrrAgentId: string | null;
    partnerAccountId: string | null;
    isActive: boolean;
    createdAt: string;
    outboundVoiceEnabled: boolean;
    demoMode: boolean;
    demoCallsEnabled: boolean;
    testModeEnabled: boolean;
    testOverrideNumber: string | null;
    freeTrialCallMinutes: number;
  };
  stats: {
    callsLast24h: number;
    callsLast7d: number;
    aiCallsLast24h: number;
    aiCallsLast7d: number;
    aiCallsTotal: number;
    activeJobs: number;
  };
  billing: { plan: string; status: string; version: string; currentPeriodEnd: string | null } | null;
  members: Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    status: string;
    invitedAt: string;
    acceptedAt: string | null;
    lastLoginAt: string | null;
  }>;
  recentInteractions: Array<{
    id: string;
    category: string;
    callerPhone: string;
    durationSeconds: number;
    outcome: string;
    interactionTime: string;
  }>;
}

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<TenantDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingControls, setSavingControls] = useState(false);
  const [minutesDraft, setMinutesDraft] = useState('15');
  const [testNumberDraft, setTestNumberDraft] = useState('');
  const email = typeof window !== 'undefined' ? (localStorage.getItem('superAdminEmail') ?? '') : '';

  useEffect(() => {
    if (!email) {
      setErr('Set your super-admin email at /admin/tenants first.');
      return;
    }
    fetch(`${API_BASE}/v1/super-admin/tenants/${id}`, { headers: authedHeaders(email) })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((fresh: TenantDetail) => {
        setData(fresh);
        setMinutesDraft(String(fresh.tenant.freeTrialCallMinutes ?? 15));
        setTestNumberDraft(fresh.tenant.testOverrideNumber ?? '');
      })
      .catch((e) => setErr((e as Error).message));
  }, [id, email]);

  if (err) {
    return <div className="rounded-md border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{err}</div>;
  }
  if (!data) return <div className="text-sm text-zinc-400">Loading…</div>;
  const t = data.tenant;

  async function updateCallControls(patch: {
    outboundVoiceEnabled?: boolean;
    demoMode?: boolean;
    demoCallsEnabled?: boolean;
    freeTrialCallMinutes?: number;
    testModeEnabled?: boolean;
    testOverrideNumber?: string | null;
  }) {
    setSavingControls(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/v1/super-admin/tenants/${id}/call-controls`, {
        method: 'PATCH',
        headers: authedHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? `HTTP ${res.status}`);
      const fresh = (await res.json()) as TenantDetail;
      setData(fresh);
      setMinutesDraft(String(fresh.tenant.freeTrialCallMinutes ?? 15));
      setTestNumberDraft(fresh.tenant.testOverrideNumber ?? '');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingControls(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/admin/tenants" className="text-xs text-zinc-500 underline">← All tenants</Link>
        <h1 className="text-3xl font-bold text-zinc-100">{t.companyName}</h1>
        <div className="text-sm text-zinc-400">
          {t.ownerEmail} • {t.timezone} • {t.targetSoftwareType}
          {t.partnerAccountId ? ` • partner=${t.partnerAccountId}` : ''}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle>Active jobs</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{data.stats.activeJobs}</CardContent></Card>
        <Card><CardHeader><CardTitle>AI calls (24h)</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{data.stats.aiCallsLast24h}</CardContent></Card>
        <Card><CardHeader><CardTitle>AI calls total</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{data.stats.aiCallsTotal}</CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Version</CardTitle></CardHeader>
        <CardContent className="text-sm text-zinc-300">
          {data.billing ? (
            <div>
              Version: <b>{data.billing.version || 'Free'}</b> • Status: {data.billing.status}
              {data.billing.currentPeriodEnd
                ? ` • Period end: ${new Date(data.billing.currentPeriodEnd).toLocaleDateString()}`
                : ''}
            </div>
          ) : (
            <div>Version: <b>Free</b></div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Platform call controls</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm text-zinc-300">
          <div className="flex items-start justify-between gap-4 rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
            <div>
              <div className="font-medium text-zinc-100">Outbound AI calls</div>
              <p className="mt-1 text-zinc-400">
                Master platform switch for this tenant. When off, automatic and manual outbound AI calls are blocked.
              </p>
            </div>
            <Switch
              checked={t.outboundVoiceEnabled}
              disabled={savingControls}
              onCheckedChange={(v) =>
                void updateCallControls({ outboundVoiceEnabled: v })
              }
            />
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="font-medium text-zinc-100">Free/trial call minutes</div>
            <p className="mt-1 text-zinc-400">
              Total outbound AI call minutes allowed before the account is blocked from more calls. Set 0 for no cap.
            </p>
            <div className="mt-3 flex max-w-xs gap-2">
              <input
                type="number"
                min={0}
                max={10000}
                value={minutesDraft}
                onChange={(event) => setMinutesDraft(event.target.value)}
                className="h-10 w-32 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100"
              />
              <Button
                disabled={savingControls}
                onClick={() =>
                  void updateCallControls({
                    freeTrialCallMinutes: Number(minutesDraft || 0),
                  })
                }
              >
                Save cap
              </Button>
            </div>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-zinc-100">Tenant test mode</div>
                <p className="mt-1 text-zinc-400">
                  Routes this tenant's outbound AI calls to a test number before the provider places the call.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  If enabled without a test number, calls fail closed instead of calling real customers.
                </p>
              </div>
              <Switch
                checked={t.testModeEnabled}
                disabled={savingControls}
                onCheckedChange={(v) =>
                  void updateCallControls({ testModeEnabled: v })
                }
              />
            </div>
            <div className="mt-3 flex max-w-md gap-2">
              <input
                value={testNumberDraft}
                onChange={(event) => setTestNumberDraft(event.target.value)}
                placeholder="Enter test phone"
                className="h-10 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100"
              />
              <Button
                disabled={savingControls}
                onClick={() =>
                  void updateCallControls({
                    testOverrideNumber: testNumberDraft.trim() || null,
                  })
                }
              >
                Save number
              </Button>
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
            <div>
              <div className="font-medium text-zinc-100">Demo account</div>
              <p className="mt-1 text-zinc-400">
                Platform-only safety flag. Use this for demo tenants, not real operating accounts.
              </p>
            </div>
            <Switch
              checked={t.demoMode}
              disabled={savingControls}
              onCheckedChange={(v) =>
                void updateCallControls({ demoMode: v, demoCallsEnabled: false })
              }
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
            <div>
              <div className="font-medium text-zinc-100">Allow demo calls</div>
              <p className="mt-1 text-zinc-400">
                Enable only while a platform manager is actively running a live demo.
              </p>
            </div>
            <Switch
              checked={t.demoMode && t.demoCallsEnabled}
              disabled={savingControls || !t.demoMode}
              onCheckedChange={(v) => void updateCallControls({ demoCallsEnabled: v })}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Tenant users</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs text-zinc-300">
          {data.members.length === 0 && <div className="text-zinc-500">No members on this tenant.</div>}
          {data.members.map((m) => (
            <div key={m.id} className="grid grid-cols-4 gap-2 border-t border-zinc-800 py-2">
              <span className="truncate font-medium text-zinc-100">{m.name || m.email}</span>
              <span className="truncate">{m.email}</span>
              <span>{m.role}</span>
              <span>{m.status}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent interactions</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs text-zinc-300">
          {data.recentInteractions.length === 0 && <div className="text-zinc-500">No calls logged.</div>}
          {data.recentInteractions.map((i) => (
            <div key={i.id} className="grid grid-cols-4 gap-2 border-t border-zinc-800 py-1">
              <span>{new Date(i.interactionTime).toLocaleString()}</span>
              <span>{i.callerPhone}</span>
              <span>{i.category}</span>
              <span>{i.outcome} ({i.durationSeconds}s)</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Button onClick={() => impersonate(t.id, email)}>Impersonate {t.companyName}</Button>
      </div>
    </div>
  );
}

async function impersonate(targetTenantId: string, email: string) {
  try {
    const res = await fetch(`${API_BASE}/v1/auth/impersonate`, {
      method: 'POST',
      headers: authedHeaders(email, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tenantId: targetTenantId }),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? `HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string };
    
    const currentToken = localStorage.getItem('access_token');
    if (currentToken) {
      localStorage.setItem('original_access_token', currentToken);
    }
    
    sessionStorage.setItem('impersonationBanner', `Impersonating Tenant: ${targetTenantId}`);
    localStorage.setItem('access_token', body.access_token);
    
    alert(`Impersonation session active.\nToken stored in localStorage. Refreshing page...`);
    window.location.href = '/admin/command-center';
  } catch (e) {
    alert(`Impersonation failed: ${(e as Error).message}`);
  }
}
