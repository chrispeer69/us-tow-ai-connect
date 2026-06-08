'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
import { Button } from '@/components/ui/button';
import { api } from '@/lib/utils';
import { ArrowRight, Activity, Users, PhoneCall } from 'lucide-react';

interface TenantStats {
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

export default function SuperAdminPage() {
  const [tenants, setTenants] = useState<TenantStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<TenantStats[]>('/v1/super-admin/tenants');
      setTenants(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleImpersonate = async (tenantId: string) => {
    setImpersonating(tenantId);
    setError(null);
    try {
      const res = await api<{ token: string }>('/v1/super-admin/impersonate', {
        method: 'POST',
        json: { targetTenantId: tenantId },
      });
      // Store the impersonation token and redirect to their dashboard
      if (typeof window !== 'undefined') {
        localStorage.setItem('ustow_impersonation_token', res.token);
        window.location.href = '/admin'; // Redirects to the tenant's view
      }
    } catch (err) {
      setError((err as Error).message);
      setImpersonating(null);
    }
  };

  const totalCalls = (tenants || []).reduce((acc, t) => acc + t.callsLast24h, 0);
  const totalActiveJobs = (tenants || []).reduce((acc, t) => acc + t.activeJobs, 0);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded border border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button 
          variant="outline" 
          onClick={() => { window.location.href = '/admin/command-center'; }}
          className="bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-900 hover:text-white"
        >
          <ArrowRight className="w-4 h-4 mr-2 rotate-180" />
          Exit Super Admin
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-zinc-400 mb-2">
              <Users className="w-4 h-4" />
              <h3 className="text-sm font-medium uppercase tracking-wider">Total Tenants</h3>
            </div>
            <div className="text-3xl font-bold text-white">{tenants.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-zinc-400 mb-2">
              <Activity className="w-4 h-4" />
              <h3 className="text-sm font-medium uppercase tracking-wider">Active Jobs (Live)</h3>
            </div>
            <div className="text-3xl font-bold text-emerald-400">{totalActiveJobs}</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-zinc-400 mb-2">
              <PhoneCall className="w-4 h-4" />
              <h3 className="text-sm font-medium uppercase tracking-wider">24h Call Volume</h3>
            </div>
            <div className="text-3xl font-bold text-blue-400">{totalCalls}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-zinc-900 border-zinc-800">
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Client Directory</h2>
          <Button variant="outline" onClick={() => void loadData()} disabled={loading} size="sm">
            {loading ? <Spinner className="mr-2" /> : null}
            Refresh Data
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">Company</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400 text-right">Active Jobs</TableHead>
              <TableHead className="text-zinc-400 text-right">24h Calls</TableHead>
              <TableHead className="text-zinc-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && tenants.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={5} className="h-32 text-center text-zinc-500">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : tenants.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={5} className="h-32 text-center text-zinc-500">
                  No tenants found.
                </TableCell>
              </TableRow>
            ) : (
              tenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.companyName || 'Unknown Company'}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{t.ownerEmail}</div>
                  </TableCell>
                  <TableCell>
                    {t.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {t.activeJobs}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {t.callsLast24h}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => void handleImpersonate(t.id)}
                      disabled={impersonating !== null}
                    >
                      {impersonating === t.id ? <Spinner className="w-4 h-4 mr-2" /> : null}
                      Impersonate
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
