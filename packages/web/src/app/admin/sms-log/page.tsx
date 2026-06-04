'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { api } from '@/lib/utils';

interface SmsRow {
  id: string;
  direction: 'inbound' | 'outbound';
  toPhone: string;
  fromPhone: string;
  body: string;
  status: string;
  twilioSid: string | null;
  relatedTrackingLinkId: string | null;
  relatedFlipRequestId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  error: string | null;
  createdAt: string;
}

interface ApiResponse {
  status: string;
  data: {
    items: SmsRow[];
    total: number;
    limit: number;
    offset: number;
  };
}

const PAGE_SIZE = 50;

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-zinc-700 text-zinc-200',
  sent: 'bg-blue-900 text-blue-200',
  delivered: 'bg-emerald-900 text-emerald-200',
  failed: 'bg-rose-900 text-rose-200',
  received: 'bg-indigo-900 text-indigo-200',
  log_only: 'bg-amber-900 text-amber-200',
};

const DIRECTION_COLOR: Record<string, string> = {
  outbound: 'bg-slate-700 text-slate-200',
  inbound: 'bg-cyan-900 text-cyan-200',
};

export default function SmsLogPage() {
  const [rows, setRows] = useState<SmsRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = new URLSearchParams();
      qp.set('limit', String(PAGE_SIZE));
      qp.set('offset', String(offset));
      if (direction) qp.set('direction', direction);
      if (status) qp.set('status', status);
      if (fromDate) qp.set('from', new Date(fromDate).toISOString());
      if (toDate) qp.set('to', new Date(toDate + 'T23:59:59').toISOString());
      const data = await api<ApiResponse>(`/v1/admin/sms-log?${qp.toString()}`);
      setRows(data.data.items);
      setTotal(data.data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [offset, direction, status, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const onClearFilters = () => {
    setDirection('');
    setStatus('');
    setFromDate('');
    setToDate('');
    setOffset(0);
  };

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">SMS Log</h1>
          <p className="text-xs text-zinc-500 mt-1">
            All inbound and outbound SMS activity for this tenant. {total.toLocaleString()} records.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Direction</label>
              <Select value={direction || 'all'} onValueChange={(v) => { setDirection(v === 'all' ? '' : v); setOffset(0); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                  <SelectItem value="inbound">Inbound</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Status</label>
              <Select value={status || 'all'} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setOffset(0); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="log_only">Log-only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">From date</label>
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setOffset(0); }} />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">To date</label>
              <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setOffset(0); }} />
            </div>
            <div className="flex items-end">
              <Button variant="ghost" onClick={onClearFilters}>Clear</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>To / From</TableHead>
                <TableHead>Body</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Related</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-zinc-500">
                    <Spinner /> Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-zinc-500">
                    No SMS records match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                rows.map((row) => {
                  const isExpanded = expanded === row.id;
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-zinc-900/50"
                        onClick={() => setExpanded(isExpanded ? null : row.id)}
                      >
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge className={DIRECTION_COLOR[row.direction] ?? ''}>{row.direction}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.direction === 'outbound' ? row.toPhone : row.fromPhone}
                          <div className="text-zinc-500">
                            {row.direction === 'outbound' ? `← ${row.fromPhone}` : `→ ${row.toPhone}`}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md truncate">{row.body}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLOR[row.status] ?? 'bg-zinc-700 text-zinc-200'}>
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.relatedTrackingLinkId && (
                            <span className="text-emerald-400">tracking</span>
                          )}
                          {row.relatedFlipRequestId && (
                            <span className="text-amber-400 ml-2">flip</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-zinc-950/50">
                            <div className="space-y-2 text-xs font-mono p-3">
                              <div>
                                <span className="text-zinc-500">Body: </span>
                                <span className="text-zinc-200 whitespace-pre-wrap">{row.body}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <span className="text-zinc-500">Twilio SID: </span>
                                  {row.twilioSid ?? '—'}
                                </div>
                                <div>
                                  <span className="text-zinc-500">Sent: </span>
                                  {row.sentAt ? new Date(row.sentAt).toLocaleString() : '—'}
                                </div>
                                <div>
                                  <span className="text-zinc-500">Delivered: </span>
                                  {row.deliveredAt ? new Date(row.deliveredAt).toLocaleString() : '—'}
                                </div>
                                <div>
                                  <span className="text-zinc-500">Error: </span>
                                  {row.error ?? '—'}
                                </div>
                                <div>
                                  <span className="text-zinc-500">Tracking link: </span>
                                  {row.relatedTrackingLinkId ?? '—'}
                                </div>
                                <div>
                                  <span className="text-zinc-500">Flip request: </span>
                                  {row.relatedFlipRequestId ?? '—'}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-zinc-500">
              Page {currentPage} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
