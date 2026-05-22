'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Card, CardContent } from '@/components/ui/card';
import { api, DEFAULT_TENANT_ID, TENANT_HEADER } from '@/lib/utils';

const CATEGORIES = [
  'ALL',
  'ETA_LOOKUP',
  'NEW_TOW_REQUEST',
  'TRANSFER_TO_HUMAN',
  'IMPOUND_INQUIRY',
  'PRICING_QUOTE',
  'COMPLAINT',
  'SPAM',
  'GENERAL_INQUIRY',
];

interface InteractionLog {
  id: string;
  interactionTime: string;
  callerPhone: string;
  category: string;
  outcome: string;
  summary?: string | null;
  durationSeconds: number;
  latencyMs?: number | null;
  thinkrrCallId: string;
}

interface LogsResponse {
  items: InteractionLog[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function CallLogsPage() {
  const [logs, setLogs] = useState<InteractionLog[]>([]);
  const [category, setCategory] = useState('ALL');
  const [outcome, setOutcome] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchLogs();
  }, [category, outcome, search, page, dateFrom, dateTo]);

  function buildParams(extra: Record<string, string> = {}): URLSearchParams {
    const params = new URLSearchParams();
    if (category && category !== 'ALL') params.set('category', category);
    if (outcome) params.set('outcome', outcome);
    if (search) params.set('search', search);
    if (dateFrom) params.set('date_from', new Date(dateFrom).toISOString());
    if (dateTo) params.set('date_to', new Date(dateTo).toISOString());
    Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  }

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams({ page: String(page), limit: '25' });
      const data = await api<LogsResponse>(
        `/v1/admin/interaction-logs?${params.toString()}`,
      );
      setLogs(data.items);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    // CSV needs a Blob for the download — api() only returns JSON/text, so we
    // keep a direct fetch here but reuse the shared tenant constants.
    const params = buildParams({ format: 'csv' });
    const res = await fetch(`/api/v1/admin/interaction-logs?${params.toString()}`, {
      headers: { [TENANT_HEADER]: DEFAULT_TENANT_ID },
    });
    if (!res.ok) {
      setError(`Export failed: HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <header>
          <h1 className="text-3xl font-bold">Call Logs</h1>
          <p className="text-zinc-400 mt-1">{total.toLocaleString()} total interactions</p>
        </header>
        <Button variant="outline" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-5 gap-3">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            placeholder="From"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            placeholder="To"
          />
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(1);
            }}
            placeholder="Outcome"
          />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search phone / call id / summary"
          />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <span className="flex items-center gap-2 text-zinc-400">
                      <Spinner /> Loading...
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {!loading && logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-zinc-500">
                    No interactions match these filters.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                logs.map((log) => (
                  <>
                    <TableRow
                      key={log.id}
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedRow(expandedRow === log.id ? null : log.id)
                      }
                    >
                      <TableCell>
                        {new Date(log.interactionTime).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono">{log.callerPhone}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.category}</Badge>
                      </TableCell>
                      <TableCell>{log.outcome}</TableCell>
                      <TableCell>{formatDuration(log.durationSeconds)}</TableCell>
                      <TableCell>{log.latencyMs ? `${log.latencyMs} ms` : '—'}</TableCell>
                    </TableRow>
                    {expandedRow === log.id && (
                      <TableRow key={`${log.id}-expand`}>
                        <TableCell colSpan={6} className="bg-zinc-900/40">
                          <div className="text-xs text-zinc-400">Call ID</div>
                          <div className="font-mono text-sm mb-2">
                            {log.thinkrrCallId}
                          </div>
                          <div className="text-xs text-zinc-400">Summary</div>
                          <p className="text-sm text-zinc-200 whitespace-pre-wrap">
                            {log.summary || 'No summary available.'}
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ← Previous
        </Button>
        <span className="text-sm text-zinc-400">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
