'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ChartCard } from './_components/ChartCard';
import {
  JobsPerDayChart,
  ResponseTimeChart,
  RevenueChart,
  SmsVolumeChart,
  TopDriversChart,
  WinRateChart,
} from './_components/ReportCharts';
import {
  downloadReportCsv,
  fetchReport,
  type JobsPerDayReport,
  type RangeQuery,
  type ReportMetric,
  type ReportRange,
  type ResponseTimeReport,
  type RevenueReport,
  type SmsVolumeReport,
  type TopDriversReport,
  type WinRateReport,
} from './_lib/reports-api';

const RANGE_OPTIONS: { value: ReportRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'custom', label: 'Custom' },
];

interface Bundle {
  jobsPerDay?: JobsPerDayReport;
  winRate?: WinRateReport;
  responseTime?: ResponseTimeReport;
  revenue?: RevenueReport;
  topDrivers?: TopDriversReport;
  smsVolume?: SmsVolumeReport;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const [range, setRange] = useState<ReportRange>('30d');
  const [from, setFrom] = useState<string>(daysAgoIso(29));
  const [to, setTo] = useState<string>(todayIso());

  const [data, setData] = useState<Bundle>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ReportMetric | null>(null);

  const query = useMemo<RangeQuery>(
    () => (range === 'custom' ? { range, from, to } : { range }),
    [range, from, to],
  );
  const customReady = range !== 'custom' || Boolean(from && to && from <= to);

  const load = useCallback(async () => {
    if (!customReady) return;
    setLoading(true);
    setError(null);
    try {
      const [jobsPerDay, winRate, responseTime, revenue, topDrivers, smsVolume] = await Promise.all([
        fetchReport<JobsPerDayReport>('jobs-per-day', query),
        fetchReport<WinRateReport>('win-rate', query),
        fetchReport<ResponseTimeReport>('response-time', query),
        fetchReport<RevenueReport>('revenue', query),
        fetchReport<TopDriversReport>('top-drivers', query),
        fetchReport<SmsVolumeReport>('sms-volume', query),
      ]);
      setData({ jobsPerDay, winRate, responseTime, revenue, topDrivers, smsVolume });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, customReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const onExport = useCallback(
    async (metric: ReportMetric) => {
      setExporting(metric);
      try {
        await downloadReportCsv(metric, query);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setExporting(null);
      }
    },
    [query],
  );

  const winRateSubtitle = data.winRate?.adapters.length
    ? `${data.winRate.adapters.length} adapter${data.winRate.adapters.length > 1 ? 's' : ''}`
    : 'accepted / offered';

  return (
    <div className="space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--text-main)]">Reports</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Operational analytics for this tenant. Aggregates cached 5 min.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface-card)] p-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                className={
                  'rounded-[9px] px-3 py-1.5 text-xs font-semibold transition-colors ' +
                  (range === opt.value
                    ? 'bg-[var(--alliance-navy)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]')
                }
              >
                {opt.label}
              </button>
            ))}
          </div>

          {range === 'custom' && (
            <div className="flex items-end gap-2">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  From
                </label>
                <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  To
                </label>
                <Input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}
        </div>
      </header>

      {!customReady && (
        <p className="text-sm text-[var(--alliance-amber)]">Pick a valid date range (From must be on or before To).</p>
      )}
      {error && <p className="text-sm text-[var(--alliance-red)]">{error}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard
          title="Jobs per day"
          subtitle={data.jobsPerDay ? `${data.jobsPerDay.total} total` : undefined}
          loading={loading}
          empty={!loading && (data.jobsPerDay?.total ?? 0) === 0}
          onExport={() => onExport('jobs-per-day')}
          exporting={exporting === 'jobs-per-day'}
        >
          {data.jobsPerDay && <JobsPerDayChart data={data.jobsPerDay} />}
        </ChartCard>

        <ChartCard
          title="Win rate by adapter"
          subtitle={winRateSubtitle}
          loading={loading}
          empty={!loading && (data.winRate?.adapters.length ?? 0) === 0}
          onExport={() => onExport('win-rate')}
          exporting={exporting === 'win-rate'}
        >
          {data.winRate && <WinRateChart data={data.winRate} />}
        </ChartCard>

        <ChartCard
          title="Avg response time"
          subtitle={
            data.responseTime
              ? `call → dispatch · ${Math.round((data.responseTime.avgSeconds / 60) * 10) / 10} min avg`
              : 'call → dispatch'
          }
          loading={loading}
          empty={!loading && (data.responseTime?.avgSeconds ?? 0) === 0}
          onExport={() => onExport('response-time')}
          exporting={exporting === 'response-time'}
        >
          {data.responseTime && <ResponseTimeChart data={data.responseTime} />}
        </ChartCard>

        <ChartCard
          title="Revenue per day"
          subtitle={data.revenue?.stubbed ? 'completed jobs (revenue not yet wired)' : 'completed jobs'}
          loading={loading}
          empty={!loading && (data.revenue?.points.every((p) => p.completedJobs === 0) ?? true)}
          onExport={() => onExport('revenue')}
          exporting={exporting === 'revenue'}
        >
          {data.revenue && <RevenueChart data={data.revenue} />}
        </ChartCard>

        <ChartCard
          title="Top drivers"
          subtitle="by completed jobs"
          loading={loading}
          empty={!loading && (data.topDrivers?.drivers.length ?? 0) === 0}
          onExport={() => onExport('top-drivers')}
          exporting={exporting === 'top-drivers'}
        >
          {data.topDrivers && <TopDriversChart data={data.topDrivers} />}
        </ChartCard>

        <ChartCard
          title="SMS volume"
          subtitle={
            data.smsVolume
              ? `${data.smsVolume.totalInbound} in · ${data.smsVolume.totalOutbound} out`
              : 'inbound vs outbound'
          }
          loading={loading}
          empty={
            !loading && (data.smsVolume?.totalInbound ?? 0) + (data.smsVolume?.totalOutbound ?? 0) === 0
          }
          onExport={() => onExport('sms-volume')}
          exporting={exporting === 'sms-volume'}
        >
          {data.smsVolume && <SmsVolumeChart data={data.smsVolume} />}
        </ChartCard>
      </div>
    </div>
  );
}
