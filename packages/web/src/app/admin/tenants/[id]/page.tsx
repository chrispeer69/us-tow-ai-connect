'use client';
import React, { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

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
  };
  stats: { callsLast24h: number; callsLast7d: number; activeJobs: number };
  billing: { plan: string; status: string; currentPeriodEnd: string } | null;
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
  const email = typeof window !== 'undefined' ? (localStorage.getItem('superAdminEmail') ?? '') : '';

  useEffect(() => {
    if (!email) {
      setErr('Set your super-admin email at /admin/tenants first.');
      return;
    }
    fetch(`${API_BASE}/v1/super-admin/tenants/${id}`, { headers: { 'x-super-admin-email': email } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, [id, email]);

  if (err) {
    return <div className="rounded-md border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{err}</div>;
  }
  if (!data) return <div className="text-sm text-zinc-400">Loading…</div>;
  const t = data.tenant;

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
        <Card><CardHeader><CardTitle>Calls (24h)</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{data.stats.callsLast24h}</CardContent></Card>
        <Card><CardHeader><CardTitle>Calls (7d)</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{data.stats.callsLast7d}</CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Billing</CardTitle></CardHeader>
        <CardContent className="text-sm text-zinc-300">
          {data.billing ? (
            <div>Plan: <b>{data.billing.plan}</b> • Status: {data.billing.status} • Period end: {new Date(data.billing.currentPeriodEnd).toLocaleDateString()}</div>
          ) : (
            <div className="text-zinc-500">No billing record</div>
          )}
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
    const res = await fetch(`${API_BASE}/v1/super-admin/impersonate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-super-admin-email': email },
      body: JSON.stringify({ targetTenantId }),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? `HTTP ${res.status}`);
    const body = (await res.json()) as { token: string; bannerLabel: string };
    sessionStorage.setItem('impersonationToken', body.token);
    sessionStorage.setItem('impersonationBanner', body.bannerLabel);
    window.location.href = '/admin/integrations';
  } catch (e) {
    alert(`Impersonation failed: ${(e as Error).message}`);
  }
}
