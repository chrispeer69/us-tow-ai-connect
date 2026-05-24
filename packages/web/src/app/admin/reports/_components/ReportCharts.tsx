'use client';
import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  JobsPerDayReport,
  ResponseTimeReport,
  RevenueReport,
  SmsVolumeReport,
  TopDriversReport,
  WinRateReport,
} from '../_lib/reports-api';

// Alliance design tokens — navy primary, amber/green/blue/purple accents.
const SERIES = {
  navy: '#05162b',
  blue: '#2563eb',
  amber: '#f59e0b',
  green: '#4ade80',
  purple: '#7c3aed',
};
const AXIS = '#6b7280';
const GRID = '#e3e4ee';

const axisProps = {
  stroke: AXIS,
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: GRID },
} as const;

const tooltipStyle = {
  contentStyle: {
    background: 'var(--surface-card)',
    border: '1px solid var(--border-strong)',
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text-main)', fontWeight: 600 },
} as const;

/** 'YYYY-MM-DD' → 'M/D' for compact axis ticks. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function JobsPerDayChart({ data }: { data: JobsPerDayReport }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data.points} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipStyle} />
        <Line
          type="monotone"
          dataKey="jobs"
          name="Jobs"
          stroke={SERIES.blue}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function WinRateChart({ data }: { data: WinRateReport }) {
  const rows = data.adapters.map((a) => ({
    source: a.source,
    pct: Math.round(a.winRate * 1000) / 10, // 0..100, 1dp
    offered: a.offered,
    accepted: a.accepted,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="source" {...axisProps} />
        <YAxis unit="%" domain={[0, 100]} {...axisProps} />
        <Tooltip
          {...tooltipStyle}
          formatter={
            ((value: number, _name: unknown, item: { payload?: { accepted: number; offered: number } }) => {
              const p = item?.payload;
              return [`${value}%  (${p?.accepted ?? 0}/${p?.offered ?? 0})`, 'Win rate'];
            }) as never
          }
        />
        <Bar dataKey="pct" name="Win rate" radius={[6, 6, 0, 0]}>
          {rows.map((_, i) => (
            <Cell key={i} fill={i % 2 === 0 ? SERIES.green : SERIES.amber} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ResponseTimeChart({ data }: { data: ResponseTimeReport }) {
  const rows = data.points.map((p) => ({
    date: p.date,
    minutes: Math.round((p.avgSeconds / 60) * 10) / 10,
    samples: p.samples,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={16} />
        <YAxis unit="m" {...axisProps} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={shortDay as never}
          formatter={
            ((value: number, _name: unknown, item: { payload?: { samples: number } }) => {
              const p = item?.payload;
              return [`${value} min  (${p?.samples ?? 0} jobs)`, 'Avg response'];
            }) as never
          }
        />
        <Bar dataKey="minutes" name="Avg response (min)" fill={SERIES.amber} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueChart({ data }: { data: RevenueReport }) {
  // Revenue is stubbed (no per-job monetary field yet) — plot completed jobs.
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.points} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipStyle} labelFormatter={shortDay as never} />
        <Bar
          dataKey="completedJobs"
          name="Completed jobs"
          fill={SERIES.green}
          radius={[6, 6, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TopDriversChart({ data }: { data: TopDriversReport }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        layout="vertical"
        data={data.drivers}
        margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axisProps} />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          {...axisProps}
          tick={{ fontSize: 11, fill: AXIS }}
        />
        <Tooltip {...tooltipStyle} />
        <Bar
          dataKey="completedJobs"
          name="Completed"
          fill={SERIES.purple}
          radius={[0, 6, 6, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SmsVolumeChart({ data }: { data: SmsVolumeReport }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.points} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipStyle} labelFormatter={shortDay as never} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="inbound" name="Inbound" stackId="sms" fill={SERIES.blue} />
        <Bar dataKey="outbound" name="Outbound" stackId="sms" fill={SERIES.navy} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
