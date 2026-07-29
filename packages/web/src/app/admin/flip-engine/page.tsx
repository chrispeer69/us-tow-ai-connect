'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

// The flip-engine API returns shop rows straight from Drizzle, whose column
// properties are camelCase (shopType, addressLine, …). The previous snake_case
// shape here silently resolved every such field to `undefined` — which is why
// the TYPE column rendered blank and the "Repair shops: 0 / Body shops: 0"
// counts never matched. Keep this in sync with AlphaShopRow on the API.
interface AlphaShop {
  id: string;
  tenantId: string;
  name: string;
  shopType: 'REPAIR' | 'BODY';
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  lat: string | number | null;
  lng: string | number | null;
  phone: string | null;
  website: string | null;
  rentalPickupAvailable: boolean;
  active: boolean;
  specialties: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BlocklistEntry {
  id: string;
  tenantId: string;
  matchType: 'STANDALONE_WORD' | 'NAME_PATTERN' | 'EXACT_NAME' | 'EXACT_ADDRESS' | 'PHONE';
  matchValue: string;
  label: string;
  notes: string | null;
  active: boolean;
  addedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FlipEngineConfig {
  enabled: boolean;
  config: Record<string, unknown>;
}

type Tab = 'shops' | 'blocklist' | 'settings' | 'activity' | 'sandbox';

interface FlipActivityRow {
  id: string;
  tenantId: string;
  customerName: string;
  customerPhone: string;
  motorClub: string | null;
  vehicle: string | null;
  issueType: string | null;
  originalDestination: string | null;
  destinationBusinessName: string | null;
  destinationType: string | null;
  flipEligible: boolean;
  noFlipReason: string | null;
  nearestOurShop: string | null;
  offer1Result: string | null;
  offer2Result: string | null;
  offer3Result: string | null;
  flipOutcome: string | null;
  conviniLinkSent: boolean;
  callTime: string;
}

interface FlipActivityResponse {
  items: FlipActivityRow[];
  today: {
    total: number;
    wins: number;
    losses: number;
    skipped: number;
    winRate: number;
  };
}

interface JobsListItem {
  id: string;
  callerName: string | null;
  source: string;
  sourceJobId: string;
  status: string;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
}

interface SandboxResult {
  dryRun: true;
  job: Record<string, unknown>;
  destination: {
    tag: string;
    reason: string;
    placeTypes?: string[];
    placeId?: string | null;
    resolvedName?: string | null;
    resolvedAddress?: string | null;
    resolvedLat?: number | null;
    resolvedLng?: number | null;
  };
  issue: {
    subcategory: string | null;
    confidence: number;
    signals: string[];
  };
  decision: {
    flipEligible: boolean;
    reasonCode: string;
    bodyShopSoftMention?: boolean;
  };
  nearestShop: {
    name: string;
    distanceMiles: number | null;
    withinMaxDistance: boolean;
  } | null;
  maxShopDistanceMiles: number;
  final: {
    wouldCall: boolean;
    wouldPitchFlip: boolean;
    scenario: string;
    reason: string;
  };
  scriptPreview: string;
}

const MATCH_TYPE_COLOR: Record<BlocklistEntry['matchType'], string> = {
  STANDALONE_WORD: 'bg-emerald-900 text-emerald-200',
  NAME_PATTERN: 'bg-amber-900 text-amber-200',
  EXACT_NAME: 'bg-rose-900 text-rose-200',
  EXACT_ADDRESS: 'bg-indigo-900 text-indigo-200',
  PHONE: 'bg-zinc-700 text-zinc-200',
};

const MATCH_TYPE_LABEL: Record<BlocklistEntry['matchType'], string> = {
  STANDALONE_WORD: 'Contains word',
  NAME_PATTERN: 'Contains pattern',
  EXACT_NAME: 'Exact name',
  EXACT_ADDRESS: 'Exact address',
  PHONE: 'Phone',
};

export default function FlipEnginePage() {
  const [tab, setTab] = useState<Tab>('shops');
  const [shops, setShops] = useState<AlphaShop[]>([]);
  const [blocklist, setBlocklist] = useState<BlocklistEntry[]>([]);
  const [config, setConfig] = useState<FlipEngineConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadShops = useCallback(async () => {
    const data = await api<{ data: { items: AlphaShop[] } }>(
      '/v1/admin/flip-engine/shops',
    );
    setShops(data.data.items);
  }, []);

  const loadBlocklist = useCallback(async () => {
    const data = await api<{ data: { items: BlocklistEntry[] } }>(
      '/v1/admin/flip-engine/aaa-blocklist',
    );
    setBlocklist(data.data.items);
  }, []);

  const loadConfig = useCallback(async () => {
    const data = await api<{ data: FlipEngineConfig }>('/v1/admin/flip-engine/config');
    setConfig(data.data);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadShops(), loadBlocklist(), loadConfig()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadShops, loadBlocklist, loadConfig]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const stats = useMemo(() => {
    const repairCount = shops.filter((s) => s.shopType === 'REPAIR' && s.active).length;
    const bodyCount = shops.filter((s) => s.shopType === 'BODY' && s.active).length;
    const blockCount = blocklist.filter((b) => b.active).length;
    return { repairCount, bodyCount, blockCount };
  }, [shops, blocklist]);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Flip Engine</h1>
          <p className="text-sm text-zinc-400">
            Partner shop registry, AAA-branded hard guardrail, and engine
            configuration. Drives the outbound confirmation + flip pipeline.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadAll()} disabled={loading}>
          {loading ? <Spinner className="mr-2" /> : null}
          Refresh
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatCard label="Repair shops" value={String(stats.repairCount)} />
        <StatCard label="Body shops" value={String(stats.bodyCount)} />
        <StatCard label="AAA brand blocks" value={String(stats.blockCount)} />
        <StatCard
          label="Engine status"
          value={config?.enabled ? 'Enabled' : 'Disabled'}
          colorClass={config?.enabled ? 'text-emerald-300' : 'text-zinc-400'}
        />
      </div>

      <div className="flex gap-2 border-b border-zinc-800">
        <TabButton label="Activity" active={tab === 'activity'} onClick={() => setTab('activity')} />
        <TabButton label={`Shops (${shops.length})`} active={tab === 'shops'} onClick={() => setTab('shops')} />
        <TabButton label="Sandbox" active={tab === 'sandbox'} onClick={() => setTab('sandbox')} />
        <TabButton
          label={`AAA Blocklist (${blocklist.length})`}
          active={tab === 'blocklist'}
          onClick={() => setTab('blocklist')}
        />
        <TabButton label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
      </div>

      {error && (
        <div className="rounded border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {tab === 'activity' && <ActivityTab setError={setError} />}
      {tab === 'shops' && <ShopsTab shops={shops} reload={loadShops} setError={setError} />}
      {tab === 'sandbox' && <SandboxTab setError={setError} />}
      {tab === 'blocklist' && (
        <BlocklistTab blocklist={blocklist} reload={loadBlocklist} setError={setError} />
      )}
      {tab === 'settings' && config && (
        <SettingsTab config={config} reload={loadConfig} setError={setError} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
        <div className={`mt-1 text-xl font-semibold ${colorClass ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${active
        ? 'border-emerald-500 text-zinc-100'
        : 'border-transparent text-zinc-400 hover:text-zinc-200'
        }`}
    >
      {label}
    </button>
  );
}

// ---------- sandbox tab ----------

function SandboxTab({ setError }: { setError: (s: string | null) => void }) {
  const [jobs, setJobs] = useState<JobsListItem[]>([]);
  const [jobId, setJobId] = useState('');
  const [form, setForm] = useState({
    destinationName: '',
    destinationAddress: '',
    pickupAddress: '',
    pickupLat: '',
    pickupLng: '',
    reasonText: '',
    vehicleNotes: '',
    motorClubServiceCode: '',
  });
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SandboxResult | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingJobs(true);
      try {
        const data = await api<{ items: JobsListItem[] }>(
          '/v1/admin/command-center/jobs?limit=50',
        );
        setJobs(data.items);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoadingJobs(false);
      }
    })();
  }, [setError]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const json = jobId
        ? { jobId }
        : {
          destinationName: emptyToNull(form.destinationName),
          destinationAddress: emptyToNull(form.destinationAddress),
          pickupAddress: emptyToNull(form.pickupAddress),
          pickupLat: numberOrNull(form.pickupLat),
          pickupLng: numberOrNull(form.pickupLng),
          reasonText: emptyToNull(form.reasonText),
          vehicleNotes: emptyToNull(form.vehicleNotes),
          motorClubServiceCode: emptyToNull(form.motorClubServiceCode),
        };
      const res = await api<{ data: SandboxResult }>('/v1/admin/flip-engine/sandbox/classify', {
        method: 'POST',
        json,
      });
      setResult(res.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <h2 className="text-sm font-semibold">Dry-run classifier</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Test an existing job or manual destination. This does not place calls or write logs.
            </p>
          </div>

          <label className="block text-sm">
            Previous job
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-zinc-100"
              disabled={loadingJobs}
            >
              <option value="">Manual input</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.callerName || '(no name)'} - {j.source} {j.sourceJobId} ({j.status})
                </option>
              ))}
            </select>
          </label>

          {!jobId && (
            <div className="space-y-3">
              <Input
                placeholder="Destination business name"
                value={form.destinationName}
                onChange={(e) => setForm({ ...form, destinationName: e.target.value })}
              />
              <Input
                placeholder="Destination address"
                value={form.destinationAddress}
                onChange={(e) => setForm({ ...form, destinationAddress: e.target.value })}
              />
              <Input
                placeholder="Pickup address"
                value={form.pickupAddress}
                onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Pickup lat"
                  value={form.pickupLat}
                  onChange={(e) => setForm({ ...form, pickupLat: e.target.value })}
                />
                <Input
                  placeholder="Pickup lng"
                  value={form.pickupLng}
                  onChange={(e) => setForm({ ...form, pickupLng: e.target.value })}
                />
              </div>
              <Input
                placeholder="Reason / service type"
                value={form.reasonText}
                onChange={(e) => setForm({ ...form, reasonText: e.target.value })}
              />
              <Input
                placeholder="Vehicle notes"
                value={form.vehicleNotes}
                onChange={(e) => setForm({ ...form, vehicleNotes: e.target.value })}
              />
              <Input
                placeholder="Motor club service code"
                value={form.motorClubServiceCode}
                onChange={(e) => setForm({ ...form, motorClubServiceCode: e.target.value })}
              />
            </div>
          )}

          <Button
            onClick={() => void run()}
            disabled={running || (!jobId && !form.destinationAddress && !form.destinationName)}
          >
            {running ? <Spinner className="mr-2" /> : null}
            Run dry run
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          {!result ? (
            <p className="text-sm text-zinc-500">Run a dry run to see the flip decision trace.</p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <TraceCard
                  label="Destination"
                  value={result.destination.tag}
                  detail={result.destination.reason}
                />
                <TraceCard
                  label="Issue"
                  value={result.issue.subcategory ?? 'unknown'}
                  detail={`confidence ${result.issue.confidence}`}
                />
                <TraceCard
                  label="Final"
                  value={result.final.wouldPitchFlip ? 'Flip pitch' : 'No flip pitch'}
                  detail={result.final.reason}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <JsonPanel title="Classification trace" value={{
                  destination: result.destination,
                  issue: result.issue,
                  decision: result.decision,
                  nearestShop: result.nearestShop,
                  maxShopDistanceMiles: result.maxShopDistanceMiles,
                  final: result.final,
                }} />
                <JsonPanel title="Job input" value={result.job} />
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Script preview</h3>
                <textarea
                  readOnly
                  value={result.scriptPreview}
                  className="min-h-[280px] w-full rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-100"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TraceCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-100">{value}</div>
      <div className="mt-1 text-xs text-zinc-400">{detail}</div>
    </div>
  );
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <textarea
        readOnly
        value={JSON.stringify(value, null, 2)}
        className="min-h-[260px] w-full rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-100"
      />
    </div>
  );
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------- shops tab ----------

function ShopsTab({
  shops,
  reload,
  setError,
}: {
  shops: AlphaShop[];
  reload: () => Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editShop, setEditShop] = useState<AlphaShop | null>(null);
  const [deleteShopId, setDeleteShopId] = useState<string | null>(null);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-400">
            Partner repair + body shops. Tenant zero is pre-seeded with 9 Alpha
            Automotive locations. The flip engine picks the active shop nearest
            to the pickup address.
          </p>
          <Button onClick={() => setShowAdd(true)}>+ Add shop</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Rental pickup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shops.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-zinc-500">
                  No shops yet. Add your first repair or body shop.
                </TableCell>
              </TableRow>
            )}
            {shops.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{s.name}</div>
                    <button
                      onClick={() => setEditShop(s)}
                      className="text-xs text-emerald-500 hover:text-emerald-400"
                    >
                      (Edit)
                    </button>
                    <button
                      onClick={() => setDeleteShopId(s.id)}
                      className="text-xs text-rose-500 hover:text-rose-400"
                    >
                      (Delete)
                    </button>
                  </div>
                  {s.notes && <div className="text-xs text-zinc-500">{s.notes}</div>}
                </TableCell>
                <TableCell>
                  <ShopTypeCell shop={s} reload={reload} setError={setError} />
                </TableCell>
                <TableCell className="text-xs">
                  {s.addressLine}
                  <br />
                  {s.city}, {s.state} {s.postalCode}
                </TableCell>
                <TableCell className="text-xs font-mono">{s.phone ?? '—'}</TableCell>
                <TableCell>
                  <ActiveToggleCell
                    active={!!s.active}
                    endpoint={`/v1/admin/flip-engine/shops/${s.id}`}
                    method="PUT"
                    reload={reload}
                    setError={setError}
                  />
                </TableCell>
                <TableCell className="text-xs">{s.rentalPickupAvailable ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {showAdd && (
        <AddShopModal
          onClose={() => setShowAdd(false)}
          onSaved={async () => {
            setShowAdd(false);
            await reload();
          }}
          setError={setError}
        />
      )}
      {deleteShopId && (
        <ConfirmDeleteModal
          title="Delete Shop"
          message="Are you sure you want to permanently delete this shop? This cannot be undone."
          onClose={() => setDeleteShopId(null)}
          onConfirm={async () => {
            await api(`/v1/admin/flip-engine/shops/${deleteShopId}`, { method: 'DELETE' });
            await reload();
          }}
        />
      )}
      {editShop && (
        <EditShopModal
          shop={editShop}
          onClose={() => setEditShop(null)}
          onSaved={async () => {
            setEditShop(null);
            await reload();
          }}
          setError={setError}
        />
      )}
    </Card>
  );
}

// Inline, editable TYPE control for a shop row. PATCHes `shopType` via the
// existing PUT /v1/admin/flip-engine/shops/:id endpoint (ShopPatchSchema
// accepts a partial { shopType }), then reloads so the row and the header
// "Repair shops / Body shops" counts update from the source of truth.
function ShopTypeCell({
  shop,
  reload,
  setError,
}: {
  shop: AlphaShop;
  reload: () => Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);

  const change = async (next: string) => {
    if (next === shop.shopType || (next !== 'REPAIR' && next !== 'BODY')) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/v1/admin/flip-engine/shops/${shop.id}`, {
        method: 'PUT',
        body: JSON.stringify({ shopType: next }),
        headers: { 'content-type': 'application/json' },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-[120px]">
        <Select value={shop.shopType} onValueChange={(v) => void change(v)} disabled={saving}>
          <SelectTrigger>
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="REPAIR">Repair</SelectItem>
            <SelectItem value="BODY">Body</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {saving && <Spinner />}
    </div>
  );
}

function ActiveToggleCell({
  active,
  endpoint,
  method,
  reload,
  setError,
}: {
  active: boolean;
  endpoint: string;
  method: string;
  reload: () => Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(endpoint, {
        method,
        json: { active: !active },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      onClick={() => void toggle()}
      disabled={saving}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${active ? 'bg-emerald-600' : 'bg-zinc-700'
        } ${saving ? 'opacity-50' : ''}`}
    >
      <span className="sr-only">Toggle active status</span>
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${active ? 'translate-x-4' : 'translate-x-0'
          }`}
      />
    </button>
  );
}

function ConfirmDeleteModal({
  title,
  message,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 p-5 text-center">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-zinc-400">{message}</p>
          {error && <div className="text-sm text-rose-500">{error}</div>}
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirm()} disabled={saving}>
              {saving ? <Spinner className="mr-2" /> : null}
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddShopModal({
  onClose,
  onSaved,
  setError,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    shopType: 'REPAIR' as 'REPAIR' | 'BODY',
    addressLine: '',
    city: '',
    state: '',
    postalCode: '',
    phone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api('/v1/admin/flip-engine/shops', {
        method: 'POST',
        body: JSON.stringify(form),
        headers: { 'content-type': 'application/json' },
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold">Add partner shop</h2>
          <Input
            placeholder="Shop name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select
            value={form.shopType}
            onValueChange={(v) => setForm({ ...form, shopType: v as 'REPAIR' | 'BODY' })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Shop type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REPAIR">Repair</SelectItem>
              <SelectItem value="BODY">Body</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Street address"
            value={form.addressLine}
            onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              placeholder="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <Input
              placeholder="ST"
              maxLength={2}
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
            />
            <Input
              placeholder="ZIP"
              value={form.postalCode}
              onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
            />
          </div>
          <Input
            placeholder="Phone (e.g. +16145551212)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Spinner className="mr-2" /> : null}
              Save shop
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EditShopModal({
  shop,
  onClose,
  onSaved,
  setError,
}: {
  shop: AlphaShop;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [form, setForm] = useState({
    name: shop.name || '',
    shopType: shop.shopType as 'REPAIR' | 'BODY',
    addressLine: shop.addressLine || '',
    city: shop.city || '',
    state: shop.state || '',
    postalCode: shop.postalCode || '',
    phone: shop.phone || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api(`/v1/admin/flip-engine/shops/${shop.id}`, {
        method: 'PUT',
        json: form,
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold">Edit partner shop</h2>
          <Input
            placeholder="Shop name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select
            value={form.shopType}
            onValueChange={(v) => setForm({ ...form, shopType: v as 'REPAIR' | 'BODY' })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Shop type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REPAIR">Repair</SelectItem>
              <SelectItem value="BODY">Body</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Street address"
            value={form.addressLine}
            onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              placeholder="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <Input
              placeholder="ST"
              maxLength={2}
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
            />
            <Input
              placeholder="ZIP"
              value={form.postalCode}
              onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
            />
          </div>
          <Input
            placeholder="Phone (e.g. +16145551212)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Spinner className="mr-2" /> : null}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- blocklist tab ----------

function BlocklistTab({
  blocklist,
  reload,
  setError,
}: {
  blocklist: BlocklistEntry[];
  reload: () => Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState<BlocklistEntry | null>(null);
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-400">
            Hard guardrail backing the &quot;never flip a AAA call going to a
            AAA-branded repair location&quot; rule. The flip engine first runs
            the regex /\bAAA\b/i on the destination name; these entries cover
            edge cases the regex misses.
          </p>
          <Button onClick={() => setShowAdd(true)}>+ Add entry</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Match type</TableHead>
              <TableHead>Match value</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocklist.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-500">
                  No custom entries. The hard-coded /\bAAA\b/i regex protects you regardless.
                </TableCell>
              </TableRow>
            )}
            {blocklist.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{b.label}</span>
                    <button
                      onClick={() => setEditEntry(b)}
                      className="text-xs text-emerald-500 hover:text-emerald-400"
                    >
                      (Edit)
                    </button>
                    <button
                      onClick={() => setDeleteEntryId(b.id)}
                      className="text-xs text-rose-500 hover:text-rose-400"
                    >
                      (Delete)
                    </button>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className={MATCH_TYPE_COLOR[b.matchType] ?? 'bg-zinc-700 text-zinc-200'}>
                    {MATCH_TYPE_LABEL[b.matchType] ?? b.matchType}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{b.matchValue}</TableCell>
                <TableCell>
                  <ActiveToggleCell
                    active={!!b.active}
                    endpoint={`/v1/admin/flip-engine/aaa-blocklist/${b.id}`}
                    method="PATCH"
                    reload={reload}
                    setError={setError}
                  />
                </TableCell>
                <TableCell className="text-xs text-zinc-400">{b.notes ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {showAdd && (
        <AddBlocklistModal
          onClose={() => setShowAdd(false)}
          onSaved={async () => {
            setShowAdd(false);
            await reload();
          }}
          setError={setError}
        />
      )}
      {editEntry && (
        <EditBlocklistModal
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={async () => {
            setEditEntry(null);
            await reload();
          }}
          setError={setError}
        />
      )}
      {deleteEntryId && (
        <ConfirmDeleteModal
          title="Delete Blocklist Entry"
          message="Are you sure you want to permanently delete this blocklist entry?"
          onClose={() => setDeleteEntryId(null)}
          onConfirm={async () => {
            await api(`/v1/admin/flip-engine/aaa-blocklist/${deleteEntryId}`, { method: 'DELETE' });
            await reload();
          }}
        />
      )}
    </Card>
  );
}

function AddBlocklistModal({
  onClose,
  onSaved,
  setError,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [form, setForm] = useState({
    matchType: 'NAME_PATTERN' as BlocklistEntry['matchType'],
    matchValue: '',
    label: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api('/v1/admin/flip-engine/aaa-blocklist', {
        method: 'POST',
        json: form,
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold">Add AAA-branded blocklist entry</h2>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700">Rule Type</label>
            <Select
              value={form.matchType}
              onValueChange={(v) => setForm({ ...form, matchType: v as BlocklistEntry['matchType'] })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Match type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDALONE_WORD">Contains word</SelectItem>
                <SelectItem value="NAME_PATTERN">Contains pattern</SelectItem>
                <SelectItem value="EXACT_NAME">Exact business name</SelectItem>
                <SelectItem value="EXACT_ADDRESS">Exact address</SelectItem>
                <SelectItem value="PHONE">Phone number</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700">Value to Match</label>
            <Input
              placeholder="e.g. Firestone or 555-1234"
              value={form.matchValue}
              onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700">Label (For Your Reference)</label>
            <Input
              placeholder="e.g. Firestone Auto"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700">Internal Notes</label>
            <Textarea
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Spinner className="mr-2" /> : null}
              Save entry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EditBlocklistModal({
  entry,
  onClose,
  onSaved,
  setError,
}: {
  entry: BlocklistEntry;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [form, setForm] = useState({
    matchType: entry.matchType,
    matchValue: entry.matchValue,
    label: entry.label,
    notes: entry.notes ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api(`/v1/admin/flip-engine/aaa-blocklist/${entry.id}`, {
        method: 'PUT',
        json: form,
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold">Edit AAA-branded blocklist entry</h2>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700">Rule Type</label>
            <Select
              value={form.matchType}
              onValueChange={(v) => setForm({ ...form, matchType: v as BlocklistEntry['matchType'] })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Match type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDALONE_WORD">Contains word</SelectItem>
                <SelectItem value="NAME_PATTERN">Contains pattern</SelectItem>
                <SelectItem value="EXACT_NAME">Exact business name</SelectItem>
                <SelectItem value="EXACT_ADDRESS">Exact address</SelectItem>
                <SelectItem value="PHONE">Phone number</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700">Value to Match</label>
            <Input
              placeholder="e.g. Firestone or 555-1234"
              value={form.matchValue}
              onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700">Label (For Your Reference)</label>
            <Input
              placeholder="e.g. Firestone Auto"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700">Internal Notes</label>
            <Textarea
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Spinner className="mr-2" /> : null}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- settings tab ----------

function SettingsTab({
  config,
  reload,
  setError,
}: {
  config: FlipEngineConfig;
  reload: () => Promise<void>;
  setError: (s: string | null) => void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [repName, setRepName] = useState<string>((config.config?.rep_name as string) || '');
  const [companyName, setCompanyName] = useState<string>((config.config?.company_name as string) || '');
  const [callbackNumber, setCallbackNumber] = useState<string>((config.config?.callback_number as string) || '');
  const [confidence, setConfidence] = useState<number>(
    Number(config.config?.no_flip_confidence_threshold ?? 0.85),
  );
  const [pollInterval, setPollInterval] = useState<number>(
    Number(config.config?.poll_interval_seconds ?? 60),
  );
  const [batchSize, setBatchSize] = useState<number>(
    Number(config.config?.batch_summary_size ?? 10),
  );
  const [reportHour, setReportHour] = useState<number>(
    Number(config.config?.daily_report_hour_local ?? 21),
  );
  const [maxDistanceMiles, setMaxDistanceMiles] = useState<number>(
    Number(config.config?.max_shop_distance_miles ?? 100),
  );
  const [diagnosticValue, setDiagnosticValue] = useState<number>(
    Number(config.config?.diagnostic_value ?? 89),
  );
  const DEFAULT_AGENT_RULES = `- Be a warm, reassuring dispatcher. One question at a time. Never sound like a telemarketer.
- Disclose that you are CONVINIcar's AI towing assistant at the start of the call. Do not deny being an AI if asked.
- Confirm details first. If the customer corrects something, acknowledge it and move on.
- Do not ask "is now a good time?" The customer already requested service; keep the call brief and useful.
- Only pitch a repair-shop flip when the call is repairable and the destination is not already our shop or a protected destination.
- Do not pitch repair-shop offers for lockout, fuel delivery, single flat tire, jump-start-only, or winch-out-only calls.
- Make flip offers as one objection-handling flow, not three unrelated pitches. STOP the moment one is accepted.
- If the customer gives a hard decline such as "no offers", "just send the tow", "I'm not changing", or "I already know where it is going", stop pitching immediately and keep the original destination.
- ALWAYS send-frame the free CONVINIcar app near the close, unless the customer hung up, opted out, or asked you to stop.
- Never invent prices, times, names, or addresses — use only what's provided here.
- The ONLY phone number you may give the customer is {{callback_number}}.
- When you offer the app, say "I'm texting you the link now" — do not ask permission, do not read the link aloud, and do not ask whether it came through.
- Never mention Google reviews, review incentives, or gift cards during the call.
- If the customer is hostile, in danger, or asks you to stop: end the call politely and immediately.`;

  const defaultOpening = `[STEP 1 — OPENING / IDENTIFICATION]
AI: "Hi, this is {{rep_name}} calling from {{company_name}} about the tow request. I'm the AI assistant helping confirm the details. Am I speaking with {{customer_first_name}}?"
[AGENT: Wait for confirmation.]`;

  const defaultPurpose = `[STEP 2 — PURPOSE OF CALL]
AI: "Thanks. I'll keep this quick and start with your pickup details."
[AGENT: Do not ask whether now is a good time. Proceed directly into pickup confirmation unless the customer interrupts.]`;

  const defaultPickup = `[STEP 3 — CONFIRM PICKUP LOCATION]
AI: "I have your pickup location as {{pickup_location}}. Is that correct?"`;

  const defaultVehicle = `[STEP 4 — CONFIRM VEHICLE DETAILS]
AI: "And I have a {{vehicle}}. Is that right?"`;

  const defaultIssue = `[STEP 5 — CLARIFY THE ISSUE]
AI: "I see the issue is listed as {{issue}}. Can you tell me a little more about what happened?"`;

  const defaultDestination = `[STEP 6 — CONFIRM DELIVERY DESTINATION]
AI: "I have the destination as {{destination}}. Is that still correct, and is it a repair shop, body shop, your home, or somewhere else?"
[AGENT: Confirm the destination and capture what kind of place it is. Use that answer with the issue type to decide whether a repair-shop or body-shop offer is appropriate. On repairable competitor-shop calls, do not verbally lock the destination before the shop offer.]`;

  const defaultClose = `=== WARM CLOSE (all scenarios) ===
AI: "Anything else before you go?"
AI: "Drive safe."`;

  const [mentionRentals, setMentionRentals] = useState<boolean>(
    config.config?.mention_rentals !== false,
  );
  const [smsFlipSuccess, setSmsFlipSuccess] = useState<boolean>(
    config.config?.sms_flip_success !== false,
  );
  const [smsFlipFailure, setSmsFlipFailure] = useState<boolean>(
    config.config?.sms_flip_failure !== false,
  );
  const [smsReport, setSmsReport] = useState<boolean>(
    config.config?.sms_report !== false,
  );
  const [smsConvini, setSmsConvini] = useState<boolean>(
    config.config?.sms_convini !== false,
  );
  const [pitchConvini, setPitchConvini] = useState<boolean>(
    config.config?.pitch_convini !== false,
  );
  const [customAgentRules, setCustomAgentRules] = useState<string>(
    (config.config?.custom_agent_rules as string) || DEFAULT_AGENT_RULES,
  );

  const defaultOffer1 = `Before I confirm the drop-off — just so you know, {{nearest_shop}}, a certified shop just {{nearest_shop_distance}} miles away, can provide a free diagnostic, normally around \${{diagnostic_value}}, plus 10 percent off today's repair. I'd handle the drop-off with the driver if you choose that option. Would you like me to switch the drop-off to {{nearest_shop}}?`;
  const defaultOffer2 = `Totally fair. Here's the difference though — for today's tow, {{nearest_shop}} can look at your car quickly, give you a written estimate before any work, and you still get the free diagnostic plus 10 percent off today's repair. If you want that, I can update the drop-off with the driver. Would you like me to make that change?`;
  const defaultOffer3 = `I can also add a 50 dollar credit on this repair on top of the discount and hold the priority slot at {{nearest_shop}}. Would you like me to switch the drop-off there?`;
  const defaultConvini = `You're all set, {{customer_first_name}}. Your driver is headed to {{destination}} as planned. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;

  const scriptBlocksObj = (config.config?.script_blocks as Record<string, string>) || {};

  const [openingBlock, setOpeningBlock] = useState<string>(scriptBlocksObj.opening ?? defaultOpening);
  const [purposeBlock, setPurposeBlock] = useState<string>(scriptBlocksObj.purpose ?? defaultPurpose);
  const [pickupBlock, setPickupBlock] = useState<string>(scriptBlocksObj.confirm_pickup ?? defaultPickup);
  const [vehicleBlock, setVehicleBlock] = useState<string>(scriptBlocksObj.confirm_vehicle ?? defaultVehicle);
  const [issueBlock, setIssueBlock] = useState<string>(scriptBlocksObj.clarify_issue ?? defaultIssue);
  const [destinationBlock, setDestinationBlock] = useState<string>(scriptBlocksObj.confirm_destination ?? defaultDestination);
  const [closeBlock, setCloseBlock] = useState<string>(scriptBlocksObj.warm_close ?? defaultClose);

  const [offer1, setOffer1] = useState<string>(scriptBlocksObj.offer_1 ?? defaultOffer1);
  const [offer2, setOffer2] = useState<string>(scriptBlocksObj.offer_2 ?? defaultOffer2);
  const [offer3, setOffer3] = useState<string>(scriptBlocksObj.offer_3 ?? defaultOffer3);
  const [conviniPitch, setConviniPitch] = useState<string>(scriptBlocksObj.convini_pitch ?? defaultConvini);

  const [submitting, setSubmitting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const save = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api('/v1/admin/flip-engine/config', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled,
          config: {
            rep_name: repName,
            company_name: companyName,
            callback_number: callbackNumber,
            no_flip_confidence_threshold: confidence,
            poll_interval_seconds: pollInterval,
            batch_summary_size: batchSize,
            daily_report_hour_local: reportHour,
            mention_rentals: mentionRentals,
            sms_flip_success: smsFlipSuccess,
            sms_flip_failure: smsFlipFailure,
            sms_report: smsReport,
            sms_convini: smsConvini,
            pitch_convini: pitchConvini,
            custom_agent_rules: customAgentRules,
            max_shop_distance_miles: maxDistanceMiles,
            diagnostic_value: diagnosticValue,
            script_blocks: {
              opening: openingBlock,
              purpose: purposeBlock,
              confirm_pickup: pickupBlock,
              confirm_vehicle: vehicleBlock,
              clarify_issue: issueBlock,
              confirm_destination: destinationBlock,
              warm_close: closeBlock,
              offer_1: offer1,
              offer_2: offer2,
              offer_3: offer3,
              convini_pitch: conviniPitch,
            },
          },
        }),
        headers: { 'content-type': 'application/json' },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetToDefaults = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api('/v1/admin/flip-engine/config/reset', { method: 'POST' });
      setResetConfirmOpen(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm font-semibold">Flip engine enabled</span>
          </label>
          <p className="ml-7 mt-1 text-xs text-zinc-500">
            When off, the poller skips this tenant entirely. Turn on after
            verifying your shop list and AAA blocklist.
          </p>
        </div>

        <SettingsField
          label="AI Rep Name"
          help="The name the AI uses to introduce itself (e.g., Emily, Ethan)."
        >
          <Input
            value={repName}
            onChange={(e) => setRepName(e.target.value)}
            placeholder="e.g. Emily"
            className="max-w-[300px]"
          />
        </SettingsField>

        <SettingsField
          label="Company Name"
          help="The name the AI uses to identify the company."
        >
          <Input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g. Acme Towing"
            className="max-w-[300px]"
          />
        </SettingsField>

        <SettingsField
          label="Callback number"
          help="The number the AI provides to customers for reaching out directly."
        >
          <Input
            value={callbackNumber}
            onChange={(e) => setCallbackNumber(e.target.value)}
            placeholder="e.g. +18005550199"
            className="max-w-[300px]"
          />
        </SettingsField>

        <SettingsField
          label="No-flip confidence threshold"
          help="If the AI classifies a job as a no-flip category (single tire, jump start, lockout, fuel delivery, winch-out) with confidence ≥ this value, the flip is suppressed. Lower values = stricter exclusion."
        >
          <Input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            className="max-w-[120px]"
          />
        </SettingsField>

        <SettingsField
          label="Max miles to recommend a shop"
          help="The maximum distance in miles from the pickup location to recommend a partner shop. Defaults to 100."
        >
          <Input
            type="number"
            min="1"
            value={maxDistanceMiles}
            onChange={(e) => setMaxDistanceMiles(Number(e.target.value))}
            className="max-w-[120px]"
          />
        </SettingsField>

        <SettingsField
          label="Diagnostic value"
          help="Dollar amount used as the anchor for the free diagnostic offer."
        >
          <Input
            type="number"
            min="0"
            value={diagnosticValue}
            onChange={(e) => setDiagnosticValue(Number(e.target.value))}
            className="max-w-[120px]"
          />
        </SettingsField>

        <SettingsField
          label="Poll interval (seconds)"
          help="How often the engine scans Towbook + AAA for new motor club jobs. Default 60. Min 15."
        >
          <Input
            type="number"
            min="15"
            max="3600"
            value={pollInterval}
            onChange={(e) => setPollInterval(Number(e.target.value))}
            className="max-w-[120px]"
          />
        </SettingsField>

        <SettingsField
          label="Batch summary size"
          help="Send a compact wins/losses recap to managers after every N flip attempts."
        >
          <Input
            type="number"
            min="1"
            max="200"
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value))}
            className="max-w-[120px]"
          />
        </SettingsField>

        <SettingsField
          label="Daily report hour (local)"
          help="When the 24-hour summary text goes out. 0–23, default 21 (9 PM)."
        >
          <Input
            type="number"
            min="0"
            max="23"
            value={reportHour}
            onChange={(e) => setReportHour(Number(e.target.value))}
            className="max-w-[120px]"
          />
        </SettingsField>

        <div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={mentionRentals}
              onChange={(e) => setMentionRentals(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Mention CONVINI rental fleet (35 vehicles)</span>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={smsFlipSuccess}
              onChange={(e) => setSmsFlipSuccess(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Send SMS on Flip Success</span>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={smsFlipFailure}
              onChange={(e) => setSmsFlipFailure(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Send SMS on Flip Failure (Attention Needed)</span>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={smsReport}
              onChange={(e) => setSmsReport(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Send SMS for Batch/Daily Reports</span>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={smsConvini}
              onChange={(e) => setSmsConvini(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Send CONVINI App Link SMS to Customer</span>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={pitchConvini}
              onChange={(e) => setPitchConvini(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Pitch CONVINI App on Calls</span>
          </label>
        </div>

        <div className="pt-6">
          <h3 className="text-lg font-semibold text-zinc-800">Script Builder</h3>
          <p className="text-sm text-zinc-500 mb-4">
            Customize the exact spoken dialogue for each phase of the pitch. Leave a box empty to automatically skip that step.
            Available variables: <span className="font-mono text-xs">{'{{customer_first_name}}'}</span>, <span className="font-mono text-xs">{'{{vehicle}}'}</span>, <span className="font-mono text-xs">{'{{pickup_location}}'}</span>, <span className="font-mono text-xs">{'{{destination}}'}</span>, <span className="font-mono text-xs">{'{{issue}}'}</span>, <span className="font-mono text-xs">{'{{nearest_shop}}'}</span>, <span className="font-mono text-xs">{'{{nearest_shop_distance}}'}</span>, <span className="font-mono text-xs">{'{{diagnostic_value}}'}</span>.
          </p>

          <div className="space-y-6">
            <SettingsField
              label="1. Greeting & Identification"
              help="How the AI answers and introduces itself."
            >
              <Textarea
                value={openingBlock}
                onChange={(e) => setOpeningBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="2. Purpose of Call"
              help="Stating why the AI is calling."
            >
              <Textarea
                value={purposeBlock}
                onChange={(e) => setPurposeBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="3. Confirm Pickup Location"
              help="Confirming where the customer's vehicle is located."
            >
              <Textarea
                value={pickupBlock}
                onChange={(e) => setPickupBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="4. Confirm Vehicle"
              help="Confirming the make/model/year."
            >
              <Textarea
                value={vehicleBlock}
                onChange={(e) => setVehicleBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="5. Clarify Issue"
              help="Asking what went wrong with the vehicle."
            >
              <Textarea
                value={issueBlock}
                onChange={(e) => setIssueBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="6. Confirm Destination"
              help="Confirming where the vehicle is being towed to."
            >
              <Textarea
                value={destinationBlock}
                onChange={(e) => setDestinationBlock(e.target.value)}
              />
            </SettingsField>
            <SettingsField
              label="Offer 1 (Convenience & Value)"
              help="The first pitch made when the destination is a competitor repair shop."
            >
              <Textarea
                value={offer1}
                onChange={(e) => setOffer1(e.target.value)}
                placeholder="Leave empty to skip this offer"
              />
            </SettingsField>

            <SettingsField
              label="Offer 2 (Urgency & Priority)"
              help="The second pitch made if the customer declines Offer 1."
            >
              <Textarea
                value={offer2}
                onChange={(e) => setOffer2(e.target.value)}
                placeholder="Leave empty to skip this offer"
              />
            </SettingsField>

            <SettingsField
              label="Offer 3 (Financial Incentive)"
              help="The final pitch made if the customer declines Offer 2."
            >
              <Textarea
                value={offer3}
                onChange={(e) => setOffer3(e.target.value)}
                placeholder="Leave empty to skip this offer"
              />
            </SettingsField>

            <SettingsField
              label="CONVINI App Pitch (Soft Close)"
              help="The final pivot if all offers are declined or if the destination is an auto body shop."
            >
              <Textarea
                value={conviniPitch}
                onChange={(e) => setConviniPitch(e.target.value)}
                placeholder="Leave empty to skip this pitch"
              />
            </SettingsField>
          </div>
        </div>

        <div className="pt-6">
          <h3 className="text-lg font-semibold text-zinc-800">Advanced Prompt Overrides</h3>
          <p className="text-sm text-zinc-500 mb-4">
            Optional tenant-specific rules appended after the protected default guardrails.
          </p>
        </div>

        <SettingsField
          label="Custom Agent Rules"
          help="Global instructions appended to the protected default AI agent instructions."
        >
          <Textarea
            placeholder="e.g. CRITICAL PARSING RULES: ..."
            value={customAgentRules}
            onChange={(e) => setCustomAgentRules(e.target.value)}
          />
        </SettingsField>

        <SettingsField
          label="Warm Close"
          help="The final goodbye at the very end of the call, after Convini is pitched."
        >
          <Textarea
            value={closeBlock}
            onChange={(e) => setCloseBlock(e.target.value)}
          />
        </SettingsField>

        <div className="flex justify-end pt-2 gap-4">
          <Button
            variant="outline"
            onClick={() => setResetConfirmOpen(true)}
            disabled={submitting}
          >
            Reset to defaults
          </Button>
          <Button onClick={() => void save()} disabled={submitting}>
            {submitting ? <Spinner className="mr-2" /> : null}
            Save settings
          </Button>
        </div>

        {resetConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md bg-white">
              <CardContent className="space-y-4 p-5">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900">Reset tenant settings?</h3>
                  <p className="mt-2 text-sm text-zinc-600">
                    This will remove this tenant&apos;s Flip Engine overrides and fall back to the
                    current global defaults. This cannot be undone.
                  </p>
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setResetConfirmOpen(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => void resetToDefaults()}
                    disabled={submitting}
                  >
                    {submitting ? <Spinner className="mr-2" /> : null}
                    Reset tenant settings
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsField({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:items-center">
      <div className="sm:col-span-1">
        <div className="text-sm font-medium">{label}</div>
        {help && <div className="text-xs text-zinc-500">{help}</div>}
      </div>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}


// ---------- activity tab ----------

const OUTCOME_COLOR: Record<string, string> = {
  WIN: 'bg-emerald-900 text-emerald-200',
  LOSS: 'bg-rose-900 text-rose-200',
  SKIPPED: 'bg-zinc-800 text-zinc-300',
};

const NO_FLIP_REASON_LABELS: Record<string, string> = {
  destination_unknown: 'No business identified',
  destination_residence: 'Residential address',
  destination_auto_body: 'Auto body shop',
  destination_is_our_shop: 'Already our shop',
  aaa_branded_hard_block: 'AAA-branded (blocked)',
  regex_address_no_business_name: 'Address only, no name',
  no_signals_matched: 'No signals matched',
  flip_suppressed_no_nearby_shop_within_max_distance: 'No nearby shop in range',
};

function formatNoFlipReason(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.startsWith('no_flip_category_')) {
    const parts = reason.replace('no_flip_category_', '').split('_conf_');
    const category = (parts[0] ?? '').replace(/_/g, ' ');
    const conf = parts[1] ? ` (${(parseFloat(parts[1]) * 100).toFixed(0)}% conf)` : '';
    return `Non-flip type: ${category}${conf}`;
  }
  return NO_FLIP_REASON_LABELS[reason] ?? reason;
}

function bucketOutcome(r: FlipActivityRow): 'WIN' | 'LOSS' | 'SKIPPED' {
  if (r.flipOutcome && /WIN|ACCEPTED/i.test(r.flipOutcome)) return 'WIN';
  if (!r.flipEligible) return 'SKIPPED';
  return 'LOSS';
}

function ActivityTab({ setError }: { setError: (s: string | null) => void }) {
  const [data, setData] = useState<FlipActivityResponse | null>(null);
  const [outcome, setOutcome] = useState<string>('ALL');
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qp = new URLSearchParams();
      if (outcome) qp.set('outcome', outcome);
      if (source) qp.set('source', source);
      qp.set('limit', '100');
      const res = await api<{ data: FlipActivityResponse }>(
        `/v1/admin/flip-engine/activity?${qp.toString()}`,
      );
      setData(res.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [outcome, source, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Today total" value={String(data?.today.total ?? 0)} />
          <StatCard label="Wins" value={String(data?.today.wins ?? 0)} />
          <StatCard label="Losses" value={String(data?.today.losses ?? 0)} />
          <StatCard label="Win rate" value={`${data?.today.winRate ?? 0}%`} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="max-w-[200px]">
              <SelectValue placeholder="Outcome" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All outcomes</SelectItem>
              <SelectItem value="WIN">Wins</SelectItem>
              <SelectItem value="LOSS">Losses</SelectItem>
              <SelectItem value="SKIPPED">Skipped</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="max-w-[200px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Any source</SelectItem>
              <SelectItem value="towbook">Towbook</SelectItem>
              <SelectItem value="aaa">AAA</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner className="mr-2" /> : null}
            Refresh
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Classification</TableHead>
              <TableHead>Original → Redirected</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>CONVINI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!data || data.items.length === 0) && !loading && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                  No flip activity yet. Once the engine is enabled and the
                  job poller starts feeding new motor club jobs, attempts
                  will land here.
                </TableCell>
              </TableRow>
            )}
            {data?.items.map((r) => {
              const bucket = bucketOutcome(r);
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-zinc-400">
                    {new Date(r.callTime).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{r.customerName}</div>
                    <div className="text-xs text-zinc-500 font-mono">{r.customerPhone}</div>
                  </TableCell>
                  <TableCell className="text-xs">{r.vehicle ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {r.destinationType && (
                        <Badge variant="outline" className="w-fit text-[10px]">{r.destinationType}</Badge>
                      )}
                      {r.issueType && (
                        <Badge variant="outline" className="w-fit text-[10px] bg-zinc-800 text-zinc-300">{r.issueType}</Badge>
                      )}
                      {!r.destinationType && !r.issueType && <span className="text-zinc-500 text-xs">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{r.originalDestination ?? '—'}</div>
                    {r.nearestOurShop && (
                      <div className="text-emerald-300">→ {r.nearestOurShop}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge className={OUTCOME_COLOR[bucket] ?? 'bg-zinc-700 text-zinc-200'}>
                        {bucket}
                      </Badge>
                      {bucket === 'SKIPPED' && r.noFlipReason && (
                        <span className="text-[10px] text-zinc-500 leading-tight">
                          {formatNoFlipReason(r.noFlipReason)}
                        </span>
                      )}
                      {bucket === 'LOSS' && r.flipOutcome && r.flipOutcome !== 'LOSS' && r.flipOutcome !== 'NOT_ATTEMPTED' && r.flipOutcome !== 'DECLINED' && (
                        <span className="text-[10px] text-zinc-500 leading-tight break-all">
                          AI output: {r.flipOutcome}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{r.conviniLinkSent ? 'sent' : '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
