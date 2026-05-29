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

interface AuditRow {
  id: string;
  tenantId: string | null;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  beforeState: unknown;
  afterState: unknown;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ApiResponse {
  items: AuditRow[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 50;

const ACTOR_COLOR: Record<string, string> = {
  user: 'bg-blue-900 text-blue-200',
  api_key: 'bg-emerald-900 text-emerald-200',
  system: 'bg-zinc-700 text-zinc-200',
  ai_agent: 'bg-violet-900 text-violet-200',
  adapter: 'bg-amber-900 text-amber-200',
  webhook: 'bg-cyan-900 text-cyan-200',
};

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actorType, setActorType] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [resourceType, setResourceType] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = new URLSearchParams();
      qp.set('limit', String(PAGE_SIZE));
      qp.set('page', String(page));
      if (actorType) qp.set('actorType', actorType);
      if (action) qp.set('action', action);
      if (resourceType) qp.set('resourceType', resourceType);
      if (fromDate) qp.set('from', new Date(fromDate).toISOString());
      if (toDate) qp.set('to', new Date(toDate + 'T23:59:59').toISOString());
      const data = await api<ApiResponse>(`/v1/admin/audit-log?${qp.toString()}`);
      setRows(data.items);
      setTotal(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, actorType, action, resourceType, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const onClearFilters = () => {
    setActorType('');
    setAction('');
    setResourceType('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Every mutating action against this tenant. {total.toLocaleString()} entries.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Actor type</label>
              <Select
                value={actorType || 'all'}
                onValueChange={(v) => { setActorType(v === 'all' ? '' : v); setPage(1); }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="api_key">API key</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="ai_agent">AI agent</SelectItem>
                  <SelectItem value="adapter">Adapter</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Action</label>
              <Input
                placeholder="e.g. credential.update"
                value={action}
                onChange={(e) => { setAction(e.target.value); setPage(1); }}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Resource type</label>
              <Input
                placeholder="e.g. tenant"
                value={resourceType}
                onChange={(e) => { setResourceType(e.target.value); setPage(1); }}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">From</label>
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">To</label>
              <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
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
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-zinc-500">
                    <Spinner /> Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-zinc-500">
                    No audit entries match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                rows.map((row) => {
                  const isExpanded = expanded === row.id;
                  const meta = row.metadata ?? {};
                  const status = (meta as Record<string, unknown>).status === 'error' ? 'error' : 'ok';
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
                          <Badge className={ACTOR_COLOR[row.actorType] ?? ''}>{row.actorType}</Badge>
                          <div className="text-xs font-mono text-zinc-500 mt-1">{row.actorId}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.action}</TableCell>
                        <TableCell className="text-xs">
                          {row.resourceType ?? '—'}
                          {row.resourceId && (
                            <div className="text-zinc-500 font-mono">{row.resourceId}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={status === 'error' ? 'bg-rose-900 text-rose-200' : 'bg-emerald-900 text-emerald-200'}
                          >
                            {status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-zinc-950/50">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 text-xs">
                              <div>
                                <p className="text-zinc-500 mb-1">Before</p>
                                <pre className="bg-zinc-900 rounded p-2 overflow-auto max-h-64">
                                  {JSON.stringify(row.beforeState ?? null, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <p className="text-zinc-500 mb-1">After</p>
                                <pre className="bg-zinc-900 rounded p-2 overflow-auto max-h-64">
                                  {JSON.stringify(row.afterState ?? null, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <p className="text-zinc-500 mb-1">Metadata</p>
                                <pre className="bg-zinc-900 rounded p-2 overflow-auto max-h-64">
                                  {JSON.stringify(row.metadata ?? {}, null, 2)}
                                </pre>
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
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
