'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const SUPER_ADMIN_EMAIL =
  typeof window !== 'undefined' ? (localStorage.getItem('superAdminEmail') ?? '') : '';

interface TenantRow {
  id: string;
  companyName: string;
  ownerEmail: string;
  partnerAccountId: string | null;
  isActive: boolean;
  createdAt: string;
  activeJobs: number;
  callsLast24h: number;
  plan: string | null;
}

export default function TenantsPage() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState(SUPER_ADMIN_EMAIL);

  useEffect(() => {
    if (!email) return;
    localStorage.setItem('superAdminEmail', email);
    fetch(`${API_BASE}/v1/super-admin/tenants`, { headers: { 'x-super-admin-email': email } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(setRows)
      .catch((e) => setErr((e as Error).message));
  }, [email]);

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="All tenants"
        subtitle="Super-admin view across the entire platform."
      />
      <Card>
        <CardHeader><CardTitle>Identify yourself</CardTitle></CardHeader>
        <CardContent>
          <label className="block text-sm">
            <div className="mb-1 text-zinc-300">Super-admin email</div>
            <input
              data-testid="super-admin-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="thechrispeer@gmail.com"
              className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
            />
          </label>
        </CardContent>
      </Card>
      {err && (
        <div className="rounded-md border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{err}</div>
      )}
      <Card>
        <CardHeader><CardTitle>Tenants ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-7 gap-2 text-xs font-medium text-zinc-400">
            <div className="col-span-2">Company</div>
            <div>Owner</div>
            <div>Plan</div>
            <div>Active jobs</div>
            <div>Calls 24h</div>
            <div>Actions</div>
          </div>
          {rows.map((t) => (
            <div key={t.id} className="grid grid-cols-7 gap-2 items-center border-t border-zinc-800 py-2 text-sm">
              <div className="col-span-2 text-zinc-100">{t.companyName}{t.partnerAccountId ? <span className="ml-2 rounded bg-zinc-800 px-1 text-xs text-zinc-400">{t.partnerAccountId}</span> : null}</div>
              <div className="text-zinc-300 text-xs truncate">{t.ownerEmail}</div>
              <div className="text-zinc-300">{t.plan ?? '—'}</div>
              <div>{t.activeJobs}</div>
              <div>{t.callsLast24h}</div>
              <div className="flex gap-2">
                <Link href={`/admin/tenants/${t.id}`}><Button size="sm" variant="outline">Open</Button></Link>
                <Button size="sm" onClick={() => impersonate(t.id, email)}>Impersonate</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
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
    const body = (await res.json()) as { token: string; targetCompanyName: string; bannerLabel: string };
    sessionStorage.setItem('impersonationToken', body.token);
    sessionStorage.setItem('impersonationBanner', body.bannerLabel);
    alert(`${body.bannerLabel}\n\nImpersonation session active for 15 minutes. Token stored in sessionStorage as impersonationToken.`);
    window.location.href = '/admin/integrations';
  } catch (e) {
    alert(`Impersonation failed: ${(e as Error).message}`);
  }
}
