import { api } from '@/lib/utils';

// Wire shapes mirror packages/api/src/modules/reports/reports.types.ts.
export type ReportRange = '7d' | '30d' | '90d' | 'custom';
export type ReportMetric =
  | 'jobs-per-day'
  | 'win-rate'
  | 'response-time'
  | 'revenue'
  | 'top-drivers'
  | 'sms-volume';

export interface JobsPerDayReport {
  metric: 'jobs-per-day';
  range: ReportRange;
  from: string;
  to: string;
  points: { date: string; jobs: number }[];
  total: number;
}
export interface WinRateReport {
  metric: 'win-rate';
  range: ReportRange;
  from: string;
  to: string;
  adapters: { source: string; offered: number; accepted: number; winRate: number }[];
}
export interface ResponseTimeReport {
  metric: 'response-time';
  range: ReportRange;
  from: string;
  to: string;
  points: { date: string; avgSeconds: number; samples: number }[];
  avgSeconds: number;
}
export interface RevenueReport {
  metric: 'revenue';
  range: ReportRange;
  from: string;
  to: string;
  points: { date: string; completedJobs: number; revenueCents: number | null }[];
  stubbed: boolean;
  note?: string;
}
export interface TopDriversReport {
  metric: 'top-drivers';
  range: ReportRange;
  from: string;
  to: string;
  drivers: { driverId: string | null; name: string; completedJobs: number }[];
}
export interface SmsVolumeReport {
  metric: 'sms-volume';
  range: ReportRange;
  from: string;
  to: string;
  points: { date: string; inbound: number; outbound: number }[];
  totalInbound: number;
  totalOutbound: number;
}

export interface RangeQuery {
  range: ReportRange;
  from?: string;
  to?: string;
}

function qs(q: RangeQuery): string {
  const p = new URLSearchParams({ range: q.range });
  if (q.range === 'custom' && q.from && q.to) {
    p.set('from', q.from);
    p.set('to', q.to);
  }
  return p.toString();
}

export function fetchReport<T>(metric: ReportMetric, q: RangeQuery): Promise<T> {
  return api<T>(`/v1/admin/reports/${metric}?${qs(q)}`);
}

/**
 * Pull the CSV variant of a report and trigger a browser download. Reuses the
 * shared `api()` helper (which injects the tenant header and returns text for
 * non-JSON responses), then blobs it client-side so the filename is stable.
 */
export async function downloadReportCsv(metric: ReportMetric, q: RangeQuery): Promise<void> {
  const csv = await api<string>(`/v1/admin/reports/${metric}?${qs(q)}&format=csv`);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${metric}_${q.range}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
