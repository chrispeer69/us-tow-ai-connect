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
import { Switch } from '@/components/ui/switch';
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
  callsTotal: number;
  callMinutesUsed: number;
  plan: string | null;
  version: string;
  billingStatus: string;
  outboundVoiceEnabled: boolean;
  freeTrialCallMinutes: number;
}

export default function SuperAdminPage() {
  const [tenants, setTenants] = useState<TenantStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [savingTenantId, setSavingTenantId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, tix] = await Promise.all([
        api<TenantStats[]>('/v1/super-admin/tenants'),
        api<any[]>('/v1/super-admin/tickets'),
      ]);
      setTenants(data);
      setTickets(tix);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
              <TableHead className="text-zinc-400">Billing</TableHead>
              <TableHead className="text-zinc-400 text-right">Active Jobs</TableHead>
              <TableHead className="text-zinc-400 text-right">24h Calls</TableHead>
              <TableHead className="text-zinc-400 text-right">Minutes Used</TableHead>
              <TableHead className="text-zinc-400 text-right">Minute Cap</TableHead>
              <TableHead className="text-zinc-400 text-center">Calls</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && tenants.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={8} className="h-32 text-center text-zinc-500">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : tenants.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={8} className="h-32 text-center text-zinc-500">
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
                  <TableCell>
                    <div className="font-medium text-zinc-100">{t.version || t.plan || 'Free'}</div>
                    <div className="text-xs text-zinc-500">{t.billingStatus || 'ACTIVE'}</div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {t.activeJobs}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {t.callsLast24h}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {t.callMinutesUsed}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={savingTenantId === t.id || t.freeTrialCallMinutes <= 0}
                        onClick={() =>
                          void updateTenantCallControls(t.id, {
                            freeTrialCallMinutes: Math.max(0, t.freeTrialCallMinutes - 5),
                          })
                        }
                        className="h-7 px-2 text-xs"
                      >
                        -5
                      </Button>
                      <span className="min-w-[72px] text-center text-xs font-medium text-zinc-300">
                        {t.freeTrialCallMinutes > 0 ? `${t.freeTrialCallMinutes} min` : 'No cap'}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={savingTenantId === t.id}
                        onClick={() =>
                          void updateTenantCallControls(t.id, {
                            freeTrialCallMinutes: t.freeTrialCallMinutes + 5,
                          })
                        }
                        className="h-7 px-2 text-xs"
                      >
                        +5
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={t.outboundVoiceEnabled}
                      disabled={savingTenantId === t.id}
                      onCheckedChange={(enabled) =>
                        void updateTenantCallControls(t.id, { outboundVoiceEnabled: enabled })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card className="bg-zinc-900 border-zinc-800">
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Support Tickets</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">Tenant</TableHead>
              <TableHead className="text-zinc-400">Subject</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && tickets.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={4} className="h-32 text-center text-zinc-500">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={4} className="h-32 text-center text-zinc-500">
                  No support tickets found.
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((t) => (
                <TableRow key={t.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell className="font-medium text-white">{t.companyName}</TableCell>
                  <TableCell>
                    <div className="font-medium">{t.subject}</div>
                    <div className="text-sm text-zinc-400">{t.description}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.status === 'open' ? 'outline' : 'secondary'} className="capitalize">
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-zinc-400 text-sm">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );

  async function updateTenantCallControls(
    tenantId: string,
    patch: {
      outboundVoiceEnabled?: boolean;
      freeTrialCallMinutes?: number;
    },
  ) {
    setSavingTenantId(tenantId);
    setError(null);
    try {
      await api(`/v1/super-admin/tenants/${tenantId}/call-controls`, {
        method: 'PATCH',
        json: patch,
      });
      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.id === tenantId
            ? {
                ...tenant,
                outboundVoiceEnabled:
                  patch.outboundVoiceEnabled ?? tenant.outboundVoiceEnabled,
                freeTrialCallMinutes:
                  patch.freeTrialCallMinutes ?? tenant.freeTrialCallMinutes,
              }
            : tenant,
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingTenantId(null);
    }
  }
}
