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
import { ArrowRight, Activity, Users, PhoneCall, UserCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const PLAN_OPTIONS = ['FREE', 'TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'];

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
  const [savingDemoSettings, setSavingDemoSettings] = useState(false);
  const [publicDemoCallsEnabled, setPublicDemoCallsEnabled] = useState(false);
  const [capDrafts, setCapDrafts] = useState<Record<string, string>>({});
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [resolutionMessage, setResolutionMessage] = useState('');
  const { setToken } = useAuth();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, tix, demoSettings] = await Promise.all([
        api<TenantStats[]>('/v1/super-admin/tenants'),
        api<any[]>('/v1/super-admin/tickets'),
        api<{ enabled: boolean }>('/v1/super-admin/demo-call-settings'),
      ]);
      setTenants(data);
      setPublicDemoCallsEnabled(Boolean(demoSettings.enabled));
      setCapDrafts(
        Object.fromEntries(
          data.map((tenant) => [
            tenant.id,
            tenant.freeTrialCallMinutes > 0 ? String(tenant.freeTrialCallMinutes) : '',
          ]),
        ),
      );
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
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Public demo calls</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              One global switch for the public /demo page. Off shows the booking/demo form for every call action. On allows controlled live demo calls from the seeded demo workspace.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-zinc-300">
              {publicDemoCallsEnabled ? 'Enabled' : 'Disabled'}
            </span>
            <Switch
              checked={publicDemoCallsEnabled}
              disabled={savingDemoSettings}
              onCheckedChange={(enabled) => void updatePublicDemoCalls(enabled)}
            />
          </div>
        </CardContent>
      </Card>

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
              <TableHead className="text-zinc-400 text-right">Minute Allowance</TableHead>
              <TableHead className="text-zinc-400 text-center">Calls</TableHead>
              <TableHead className="text-zinc-400 text-right">Profile</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && tenants.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={9} className="h-32 text-center text-zinc-500">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : tenants.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={9} className="h-32 text-center text-zinc-500">
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
                  <TableCell className="min-w-[140px]">
                    <select
                      value={(t.plan ?? 'FREE').toUpperCase()}
                      disabled={savingTenantId === t.id}
                      onChange={(event) =>
                        void updateTenantCallControls(t.id, { plan: event.target.value })
                      }
                      className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs font-semibold text-zinc-100"
                    >
                      {PLAN_OPTIONS.map((plan) => (
                        <option key={plan} value={plan}>
                          {displayVersion(plan)}
                        </option>
                      ))}
                    </select>
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
                      <input
                        inputMode="numeric"
                        value={capDrafts[t.id] ?? ''}
                        placeholder="No cap"
                        disabled={savingTenantId === t.id}
                        onChange={(event) =>
                          setCapDrafts((prev) => ({ ...prev, [t.id]: event.target.value }))
                        }
                        onBlur={() => void saveMinuteCap(t)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                        }}
                        className="h-8 w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-right text-xs font-semibold text-zinc-100 placeholder:text-zinc-500"
                      />
                      <span className="text-xs text-zinc-500">min</span>
                    </div>
                    {(t.plan ?? 'FREE').toUpperCase() !== 'FREE' &&
                      (t.plan ?? 'FREE').toUpperCase() !== 'TRIAL' && (
                        <div className="mt-1 text-right text-[10px] text-zinc-500">
                          Paid tier: cap not enforced
                        </div>
                      )}
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
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="bg-red-600 text-white hover:bg-red-700"
                        onClick={async () => {
                          try {
                            const res = await api<{ access_token: string }>('/v1/auth/impersonate', {
                              method: 'POST',
                              json: { tenantId: t.id }
                            });
                            const currentToken = localStorage.getItem('access_token');
                            if (currentToken) {
                              localStorage.setItem('original_access_token', currentToken);
                            }
                            sessionStorage.setItem('impersonationBanner', `Impersonating Tenant: ${t.companyName}`);
                            sessionStorage.setItem('impersonationReturnUrl', '/super-admin');
                            setToken(res.access_token);
                            window.location.href = '/admin/command-center';
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      >
                        <UserCheck className="mr-2 h-3.5 w-3.5" />
                        Impersonate
                      </Button>
                    </div>
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
              <TableHead className="text-zinc-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && tickets.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={5} className="h-32 text-center text-zinc-500">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={5} className="h-32 text-center text-zinc-500">
                  No support tickets found.
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((t) => (
                <TableRow key={t.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell className="font-medium text-white">{t.companyName}</TableCell>
                  <TableCell>
                    <div className="font-medium">{t.subject}</div>
                    <div className="text-sm text-zinc-400 max-w-[200px] truncate">{t.description}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.status === 'open' ? 'outline' : 'default'} className="capitalize">
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-zinc-400 text-sm">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setSelectedTicket(t)}>
                        View
                      </Button>
                      {t.status === 'open' && (
                        <Button variant="default" size="sm" onClick={() => updateTicketStatus(t.id, 'resolved')}>
                          Resolve
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog 
        open={!!selectedTicket} 
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTicket(null);
            setResolutionMessage('');
          }
        }}
      >
        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{selectedTicket?.subject}</DialogTitle>
            <DialogDescription>
              From {selectedTicket?.companyName} on {selectedTicket && new Date(selectedTicket.createdAt).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-md bg-zinc-900 border border-zinc-800 text-sm whitespace-pre-wrap text-zinc-100">
              {selectedTicket?.description}
            </div>
            {selectedTicket?.status !== 'closed' && selectedTicket?.status !== 'resolved' && (
              <div className="space-y-3 mt-4">
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-1 block">Response to Tenant (Optional)</label>
                  <textarea
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-md p-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    rows={3}
                    placeholder="Enter a message to send to the tenant..."
                    value={resolutionMessage}
                    onChange={(e) => setResolutionMessage(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => updateTicketStatus(selectedTicket.id, 'closed', resolutionMessage)}>
                    Close Ticket
                  </Button>
                  {selectedTicket?.status === 'open' && (
                    <Button variant="outline" onClick={() => updateTicketStatus(selectedTicket.id, 'in_progress', resolutionMessage)}>
                      Mark In Progress
                    </Button>
                  )}
                  <Button onClick={() => updateTicketStatus(selectedTicket.id, 'resolved', resolutionMessage)}>
                    Mark as Resolved
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  async function updateTicketStatus(id: string, status: string, msg?: string) {
    try {
      await api(`/v1/super-admin/tickets/${id}/status`, {
        method: 'PATCH',
        json: { status, resolutionMessage: msg || undefined }
      });
      setTickets(tickets.map(t => t.id === id ? { ...t, status, resolutionMessage: msg || t.resolutionMessage } : t));
      if (selectedTicket?.id === id) {
        setSelectedTicket(null);
        setResolutionMessage('');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function updateTenantCallControls(
    tenantId: string,
    patch: {
      outboundVoiceEnabled?: boolean;
      freeTrialCallMinutes?: number;
      plan?: string;
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
                plan: patch.plan ?? tenant.plan,
                version: patch.plan ? displayVersion(patch.plan) : tenant.version,
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

  async function saveMinuteCap(tenant: TenantStats) {
    const raw = (capDrafts[tenant.id] ?? '').trim();
    const next = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(next) || next < 0) {
      setCapDrafts((prev) => ({
        ...prev,
        [tenant.id]:
          tenant.freeTrialCallMinutes > 0 ? String(tenant.freeTrialCallMinutes) : '',
      }));
      return;
    }
    const rounded = Math.round(next);
    if (rounded === tenant.freeTrialCallMinutes) return;
    setCapDrafts((prev) => ({
      ...prev,
      [tenant.id]: rounded > 0 ? String(rounded) : '',
    }));
    await updateTenantCallControls(tenant.id, { freeTrialCallMinutes: rounded });
  }

  async function updatePublicDemoCalls(enabled: boolean) {
    setSavingDemoSettings(true);
    setError(null);
    try {
      const result = await api<{ enabled: boolean }>('/v1/super-admin/demo-call-settings', {
        method: 'PATCH',
        json: { enabled },
      });
      setPublicDemoCallsEnabled(Boolean(result.enabled));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingDemoSettings(false);
    }
  }
}

function displayVersion(plan: string | null | undefined): string {
  const normalized = (plan ?? 'FREE').trim().toUpperCase();
  if (!normalized || normalized === 'FREE') return 'Free';
  return normalized.charAt(0) + normalized.slice(1).toLowerCase();
}
