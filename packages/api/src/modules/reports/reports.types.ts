// Shared shapes for the operational reporting dashboard (Session 37).
//
// Every report is tenant-scoped and time-windowed. The wire format is plain
// JSON (strings/numbers/booleans only — no Date objects) so the values can be
// cached verbatim in Redis and round-trip through JSON.parse without surprises.

export type ReportRange = '7d' | '30d' | '90d' | 'custom';

export const REPORT_METRICS = [
  'jobs-per-day',
  'win-rate',
  'response-time',
  'revenue',
  'top-drivers',
  'sms-volume',
] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

/** Resolved time window. `from`/`to` are inclusive day boundaries in UTC. */
export interface ResolvedRange {
  range: ReportRange;
  /** ISO timestamp, start of the first day (00:00:00.000Z). */
  fromIso: string;
  /** ISO timestamp, the moment the report was computed (window end). */
  toIso: string;
  from: Date;
  to: Date;
  /** Ordered list of 'YYYY-MM-DD' UTC day keys covering the window. */
  days: string[];
}

interface BaseReport {
  metric: ReportMetric;
  range: ReportRange;
  from: string;
  to: string;
}

export interface JobsPerDayPoint {
  date: string;
  jobs: number;
}
export interface JobsPerDayReport extends BaseReport {
  metric: 'jobs-per-day';
  points: JobsPerDayPoint[];
  total: number;
}

export interface WinRateRow {
  source: string;
  offered: number;
  accepted: number;
  /** accepted / offered, rounded to 4dp; 0 when nothing offered. */
  winRate: number;
}
export interface WinRateReport extends BaseReport {
  metric: 'win-rate';
  adapters: WinRateRow[];
}

export interface ResponseTimePoint {
  date: string;
  avgSeconds: number;
  samples: number;
}
export interface ResponseTimeReport extends BaseReport {
  metric: 'response-time';
  points: ResponseTimePoint[];
  /** Window-wide mean response time in seconds (0 when no samples). */
  avgSeconds: number;
}

export interface RevenuePoint {
  date: string;
  completedJobs: number;
  /** null while no monetary source exists — see `stubbed`. */
  revenueCents: number | null;
}
export interface RevenueReport extends BaseReport {
  metric: 'revenue';
  points: RevenuePoint[];
  /** True when revenue is not yet sourced from billing — shows job counts only. */
  stubbed: boolean;
  note?: string;
}

export interface TopDriverRow {
  driverId: string | null;
  name: string;
  completedJobs: number;
}
export interface TopDriversReport extends BaseReport {
  metric: 'top-drivers';
  drivers: TopDriverRow[];
}

export interface SmsVolumePoint {
  date: string;
  inbound: number;
  outbound: number;
}
export interface SmsVolumeReport extends BaseReport {
  metric: 'sms-volume';
  points: SmsVolumePoint[];
  totalInbound: number;
  totalOutbound: number;
}

export type AnyReport =
  | JobsPerDayReport
  | WinRateReport
  | ResponseTimeReport
  | RevenueReport
  | TopDriversReport
  | SmsVolumeReport;

// ─── CSV serialization ──────────────────────────────────────────────────
// One serializer per metric. Each emits a header row + one row per data point
// using a stable column order, so the format is safe to snapshot-test and
// safe to open in Excel/Sheets. CRLF line endings per RFC 4180.

const CRLF = '\r\n';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join(CRLF) + CRLF;
}

/** CSV download filename for a metric + window, e.g. jobs-per-day_30d.csv. */
export function csvFilename(metric: ReportMetric, range: ReportRange): string {
  return `${metric}_${range}.csv`;
}

export function reportToCsv(report: AnyReport): string {
  switch (report.metric) {
    case 'jobs-per-day':
      return buildCsv(
        ['date', 'jobs'],
        report.points.map((p) => [p.date, p.jobs]),
      );
    case 'win-rate':
      return buildCsv(
        ['source', 'offered', 'accepted', 'win_rate'],
        report.adapters.map((a) => [a.source, a.offered, a.accepted, a.winRate]),
      );
    case 'response-time':
      return buildCsv(
        ['date', 'avg_seconds', 'samples'],
        report.points.map((p) => [p.date, p.avgSeconds, p.samples]),
      );
    case 'revenue':
      return buildCsv(
        ['date', 'completed_jobs', 'revenue_cents'],
        report.points.map((p) => [p.date, p.completedJobs, p.revenueCents]),
      );
    case 'top-drivers':
      return buildCsv(
        ['driver_id', 'name', 'completed_jobs'],
        report.drivers.map((d) => [d.driverId, d.name, d.completedJobs]),
      );
    case 'sms-volume':
      return buildCsv(
        ['date', 'inbound', 'outbound'],
        report.points.map((p) => [p.date, p.inbound, p.outbound]),
      );
  }
}
