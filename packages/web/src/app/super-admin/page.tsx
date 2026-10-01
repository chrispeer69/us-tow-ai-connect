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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/utils';
import { ArrowRight, Activity, Users, PhoneCall, UserCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

const PLAN_OPTIONS = ['FREE', 'TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'];
const RETELL_USAGE_PAGE_SIZE = 50;

interface TenantStats {
  id: string;
  companyName: string;
  ownerEmail: string;
  partnerAccountId: string | null;
  isActive: boolean;
  createdAt: string;
  activeJobs: number;
  callsLast24h: number;
  callsToday: number;
  callsTotal: number;
  callMinutesUsed: number;
  emilyCallsToday: number;
  emilyAttemptsToday: number;
  emilyRetriesToday: number;
  emilyMinutesToday: number;
  emilyAverageLlmTokensToday: number;
  emilyCostTodayCents: number;
  emilyCostMeasuredAttemptsToday: number;
  plan: string | null;
  version: string;
  billingStatus: string;
  outboundVoiceEnabled: boolean;
  freeTrialCallMinutes: number;
}

interface RetellUsageRow {
  id: string;
  tenantId: string;
  companyName: string;
  outboundCallId: string;
  latestRetellCallId: string;
  attemptCount: number;
  retryCount: number;
  purpose: string;
  toName: string | null;
  toPhone: string;
  status: string | null;
  agentId: string | null;
  agentVersion: string | null;
  durationSeconds: number;
  measuredCostAttempts: number;
  combinedCostCents: number;
  llmAverageTokens: number;
  llmRequestCount: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  lastAttemptAt: string;
}

interface RetellDailyUsageRow {
  day: string;
  calls: number;
  attempts: number;
  retries: number;
  minutes: number;
  measuredCostAttempts: number;
  costCents: number;
  averageLlmTokens: number;
  llmRequests: number;
  costChangeCents: number | null;
  costChangePercent: number | null;
  callChange: number | null;
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
  const [retellUsage, setRetellUsage] = useState<RetellUsageRow[]>([]);
  const [retellDailyUsage, setRetellDailyUsage] = useState<RetellDailyUsageRow[]>([]);
  const [retellUsageOffset, setRetellUsageOffset] = useState(0);
  const { setToken } = useAuth();
  const router = useRouter();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, tix, demoSettings, usage, dailyUsage] = await Promise.all([
        api<TenantStats[]>('/v1/super-admin/tenants'),
        api<any[]>('/v1/super-admin/tickets'),
        api<{ enabled: boolean }>('/v1/super-admin/demo-call-settings'),
        api<{ items: RetellUsageRow[]; limit: number; offset: number }>(
          `/v1/super-admin/retell-call-usage?limit=${RETELL_USAGE_PAGE_SIZE}&offset=${retellUsageOffset}`,
        ),
        api<RetellDailyUsageRow[]>('/v1/super-admin/retell-daily-usage?days=30'),
      ]);
      setTenants(data);
      setRetellUsage(usage.items);
      setRetellDailyUsage(dailyUsage);
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
  }, [retellUsageOffset]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalCalls = (tenants || []).reduce((acc, t) => acc + (t.callsToday ?? 0), 0);
  const totalActiveJobs = (tenants || []).reduce((acc, t) => acc + t.activeJobs, 0);
  const totalEmilyCostCents = (tenants || []).reduce(
    (acc, t) => acc + (t.emilyCostTodayCents ?? 0),
    0,
  );
  const totalEmilyMeasuredCalls = (tenants || []).reduce(
    (acc, t) => acc + (t.emilyCostMeasuredAttemptsToday ?? 0),
    0,
  );

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

      <Tabs defaultValue="overview" className="space-y-6">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-11 min-w-max border border-zinc-800 bg-zinc-900 p-1">
            <TabsTrigger value="overview" className="px-4">Overview</TabsTrigger>
            <TabsTrigger value="daily-costs" className="px-4">Daily Costs</TabsTrigger>
            <TabsTrigger value="call-usage" className="px-4">Call Usage</TabsTrigger>
            <TabsTrigger value="clients" className="px-4">Clients</TabsTrigger>
            <TabsTrigger value="support" className="px-4">Support</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
              <PhoneCall className="w-4 h-4" />
              <h3 className="text-sm font-medium uppercase tracking-wider">Today&apos;s Emily Cost</h3>
            </div>
            <div className="text-3xl font-bold text-amber-400">
              {totalEmilyMeasuredCalls > 0 ? formatUsdFromCents(totalEmilyCostCents) : '—'}
            </div>
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
              <h3 className="text-sm font-medium uppercase tracking-wider">Today&apos;s Call Volume</h3>
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
        </TabsContent>

        <TabsContent value="daily-costs">
      <Card className="bg-zinc-900 border-zinc-800">
        <div className="border-b border-zinc-800 p-6">
          <h2 className="text-lg font-semibold text-white">Emily Daily Comparison</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Calendar-day totals in UTC. Compare calls, retries, LLM usage, and cost across the last 30 days.
          </p>
        </div>
        <div className="w-full overflow-x-auto">
          <Table className="min-w-[1050px]">
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Day</TableHead>
                <TableHead className="text-right text-zinc-400">Customer Calls</TableHead>
                <TableHead className="text-right text-zinc-400">Attempts</TableHead>
                <TableHead className="text-right text-zinc-400">Retries</TableHead>
                <TableHead className="text-right text-zinc-400">Minutes</TableHead>
                <TableHead className="text-right text-zinc-400">Avg LLM Tokens</TableHead>
                <TableHead className="text-right text-zinc-400">LLM Requests</TableHead>
                <TableHead className="text-right text-zinc-400">Total Cost</TableHead>
                <TableHead className="text-right text-zinc-400">vs Previous Day</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {retellDailyUsage.length === 0 ? (
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableCell colSpan={9} className="h-28 text-center text-zinc-500">
                    No daily Retell usage has been recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                retellDailyUsage.map((day) => (
                  <TableRow key={day.day} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="whitespace-nowrap font-medium text-white">
                      {formatUtcDay(day.day)}
                    </TableCell>
                    <TableCell className="text-right">{day.calls.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{day.attempts.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{day.retries.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{day.minutes.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {day.averageLlmTokens > 0 ? day.averageLlmTokens.toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right">{day.llmRequests.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-semibold text-amber-400">
                      {day.measuredCostAttempts > 0 ? formatUsdFromCents(day.costCents) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {day.costChangeCents == null ? (
                        '—'
                      ) : (
                        <div className={day.costChangeCents > 0 ? 'text-rose-400' : day.costChangeCents < 0 ? 'text-emerald-400' : 'text-zinc-400'}>
                          {formatSignedUsdFromCents(day.costChangeCents)}
                          {day.costChangePercent != null && (
                            <span className="ml-1 text-xs">({formatSignedPercent(day.costChangePercent)})</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
        </TabsContent>

        <TabsContent value="call-usage">
      <Card className="bg-zinc-900 border-zinc-800">
        <div className="flex flex-col gap-3 border-b border-zinc-800 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Emily Call Usage</h2>
            <p className="mt-1 text-sm text-zinc-400">
              One row per customer call. Retries are combined into the retry count, total duration, LLM usage, and total cost.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || retellUsageOffset === 0}
              onClick={() => setRetellUsageOffset((current) => Math.max(0, current - RETELL_USAGE_PAGE_SIZE))}
            >
              Previous
            </Button>
            <span className="min-w-20 text-center text-xs text-zinc-500">
              {retellUsageOffset + 1}–{retellUsageOffset + retellUsage.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || retellUsage.length < RETELL_USAGE_PAGE_SIZE}
              onClick={() => setRetellUsageOffset((current) => current + RETELL_USAGE_PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
        <div className="w-full overflow-x-auto">
          <Table className="min-w-[1650px]">
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">When</TableHead>
                <TableHead className="text-zinc-400">Company</TableHead>
                <TableHead className="text-zinc-400">Customer</TableHead>
                <TableHead className="text-zinc-400">Purpose</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-right text-zinc-400">Attempts</TableHead>
                <TableHead className="text-right text-zinc-400">Retries</TableHead>
                <TableHead className="text-right text-zinc-400">Total Duration</TableHead>
                <TableHead className="text-right text-zinc-400">Retell Cost</TableHead>
                <TableHead className="text-right text-zinc-400">Cost / Min</TableHead>
                <TableHead className="text-right text-zinc-400">Avg LLM Tokens</TableHead>
                <TableHead className="text-right text-zinc-400">LLM Requests</TableHead>
                <TableHead className="text-zinc-400">Agent / Version</TableHead>
                <TableHead className="text-zinc-400">Retell Call ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && retellUsage.length === 0 ? (
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableCell colSpan={14} className="h-28 text-center text-zinc-500">
                    <Spinner className="mx-auto" />
                  </TableCell>
                </TableRow>
              ) : retellUsage.length === 0 ? (
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableCell colSpan={14} className="h-28 text-center text-zinc-500">
                    No Retell call usage has been recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                retellUsage.map((call) => {
                  const costPerMinute =
                    call.combinedCostCents != null && (call.durationSeconds ?? 0) > 0
                      ? call.combinedCostCents / ((call.durationSeconds ?? 0) / 60)
                      : null;
                  return (
                    <TableRow key={call.id} className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableCell className="whitespace-nowrap text-xs text-zinc-400">
                        {new Date(call.startedAt ?? call.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-medium text-white">{call.companyName}</TableCell>
                      <TableCell>
                        <div className="whitespace-nowrap font-medium">{call.toName || 'Unknown'}</div>
                        <div className="whitespace-nowrap font-mono text-xs text-zinc-500">{call.toPhone}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{call.purpose}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap capitalize">
                          {call.status || 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{call.attemptCount}</TableCell>
                      <TableCell className="text-right">{call.retryCount}</TableCell>
                      <TableCell className="text-right">{call.durationSeconds > 0 ? `${call.durationSeconds}s` : '—'}</TableCell>
                      <TableCell className="text-right font-semibold text-amber-400">
                        {call.measuredCostAttempts > 0
                          ? formatUsdFromCents(call.combinedCostCents)
                          : '—'}
                        <div className="text-xs font-normal text-zinc-500">
                          {call.measuredCostAttempts}/{call.attemptCount} measured
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {costPerMinute != null ? `${formatUsdFromCents(costPerMinute)}/min` : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {call.llmAverageTokens > 0
                          ? Math.round(call.llmAverageTokens).toLocaleString()
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {call.llmRequestCount > 0 ? call.llmRequestCount.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-52 truncate font-mono text-xs">{call.agentId || '—'}</div>
                        <div className="text-xs text-zinc-500">v{call.agentVersion || '—'}</div>
                      </TableCell>
                      <TableCell className="max-w-60 truncate font-mono text-xs text-zinc-400">
                        {call.latestRetellCallId}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
        </TabsContent>

        <TabsContent value="clients">
      <Card className="bg-zinc-900 border-zinc-800">
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Client Directory</h2>
          <Button variant="outline" onClick={() => void loadData()} disabled={loading} size="sm">
            {loading ? <Spinner className="mr-2" /> : null}
            Refresh Data
          </Button>
        </div>
        <div className="w-full overflow-x-auto">
        <Table className="min-w-[1450px]">
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">Company</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400">Billing</TableHead>
              <TableHead className="text-zinc-400 text-right">Active Jobs</TableHead>
              <TableHead className="text-zinc-400 text-right">Today&apos;s Calls</TableHead>
              <TableHead className="text-zinc-400 text-right">Emily Today</TableHead>
              <TableHead className="text-zinc-400 text-right">Avg LLM Tokens</TableHead>
              <TableHead className="text-zinc-400 text-right">Retell Cost</TableHead>
              <TableHead className="text-zinc-400 text-right">Minutes Used</TableHead>
              <TableHead className="text-zinc-400 text-right">Minute Allowance</TableHead>
              <TableHead className="text-zinc-400 text-center">Calls</TableHead>
              <TableHead className="text-zinc-400 text-right">Profile</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && tenants.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={12} className="h-32 text-center text-zinc-500">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : tenants.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={12} className="h-32 text-center text-zinc-500">
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
                    {t.callsToday}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <div>{t.emilyCallsToday ?? 0} calls</div>
                    <div className="text-xs font-normal text-zinc-500">
                      {(t.emilyMinutesToday ?? 0).toLocaleString()} min ·{' '}
                      {t.emilyRetriesToday ?? 0} retries
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {(t.emilyAverageLlmTokensToday ?? 0) > 0
                      ? t.emilyAverageLlmTokensToday.toLocaleString()
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {(t.emilyCostMeasuredAttemptsToday ?? 0) > 0
                      ? formatUsdFromCents(t.emilyCostTodayCents ?? 0)
                      : '—'}
                    <div className="text-xs font-normal text-zinc-500">
                      {t.emilyCostMeasuredAttemptsToday ?? 0}/{t.emilyAttemptsToday ?? 0} attempts measured
                    </div>
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
        </div>
      </Card>
        </TabsContent>

        <TabsContent value="support">
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
                      <Button variant="outline" size="sm" onClick={() => router.push(`/super-admin/tickets/${t.id}`)}>
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
        </TabsContent>
      </Tabs>
    </div>
  );

  async function updateTicketStatus(id: string, status: string, msg?: string) {
    try {
      await api(`/v1/super-admin/tickets/${id}/status`, {
        method: 'PATCH',
        json: { status, resolutionMessage: msg || undefined }
      });
      setTickets(tickets.map(t => t.id === id ? { ...t, status, resolutionMessage: msg || t.resolutionMessage } : t));
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

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatUtcDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

function formatSignedUsdFromCents(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${sign}${formatUsdFromCents(Math.abs(cents))}`;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}
