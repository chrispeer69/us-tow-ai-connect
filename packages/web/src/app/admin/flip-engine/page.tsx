'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  tenant_id: string;
  match_type: 'NAME_PATTERN' | 'EXACT_NAME' | 'EXACT_ADDRESS' | 'PHONE';
  match_value: string;
  label: string;
  notes: string | null;
  active: boolean;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

interface FlipEngineConfig {
  enabled: boolean;
  config: Record<string, unknown>;
}

type Tab = 'shops' | 'blocklist' | 'settings' | 'activity';

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

const MATCH_TYPE_COLOR: Record<string, string> = {
  NAME_PATTERN: 'bg-amber-900 text-amber-200',
  EXACT_NAME: 'bg-violet-900 text-violet-200',
  EXACT_ADDRESS: 'bg-cyan-900 text-cyan-200',
  PHONE: 'bg-pink-900 text-pink-200',
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
                  <div className="font-medium">{s.name}</div>
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
                  {s.active ? (
                    <Badge className="bg-emerald-900 text-emerald-200">Active</Badge>
                  ) : (
                    <Badge className="bg-zinc-800 text-zinc-400">Inactive</Badge>
                  )}
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
                <TableCell>{b.label}</TableCell>
                <TableCell>
                  <Badge className={MATCH_TYPE_COLOR[b.match_type] ?? 'bg-zinc-700 text-zinc-200'}>
                    {b.match_type}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{b.match_value}</TableCell>
                <TableCell>
                  {b.active ? (
                    <Badge className="bg-emerald-900 text-emerald-200">Active</Badge>
                  ) : (
                    <Badge className="bg-zinc-800 text-zinc-400">Inactive</Badge>
                  )}
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
    matchType: 'NAME_PATTERN' as BlocklistEntry['match_type'],
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
          <h2 className="text-lg font-semibold">Add AAA-branded blocklist entry</h2>
          <Select
            value={form.matchType}
            onValueChange={(v) => setForm({ ...form, matchType: v as BlocklistEntry['match_type'] })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Match type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NAME_PATTERN">Name pattern (substring)</SelectItem>
              <SelectItem value="EXACT_NAME">Exact business name</SelectItem>
              <SelectItem value="EXACT_ADDRESS">Exact address</SelectItem>
              <SelectItem value="PHONE">Phone number</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Match value"
            value={form.matchValue}
            onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
          />
          <Input
            placeholder="Human-readable label"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <textarea
            className="h-20 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
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
  const DEFAULT_AGENT_RULES = `- Be a warm, reassuring dispatcher. One question at a time. Never sound like a telemarketer.
- Confirm details first. If the customer corrects something, acknowledge it and move on.
- Make any flip offers strictly in order (1 -> 2 -> 3) and STOP the moment one is accepted. Never pressure.
- ALWAYS end by offering the free CONVINIcar app, unless the customer hung up or asked you to stop.
- Never invent prices, times, names, or addresses — use only what's provided here.
- The ONLY phone number you may give the customer is {{callback_number}}.
- When you offer the app, say "I'll text you the link" — do not read the link aloud.
- If the customer is hostile, in danger, or asks you to stop: end the call politely and immediately.`;

  const defaultOpening = `[STEP 1 — OPENING / IDENTIFICATION]
AI: "Hi, this is {{rep_name}} calling from {{company_name}}. Am I speaking with {{customer_first_name}}?"
[AGENT: Wait for confirmation.]`;

  const defaultPurpose = `[STEP 2 — PURPOSE OF CALL]
AI: "Great, {{customer_first_name}}. I'm calling to confirm the details of your tow request so we can get a driver to you as quickly as possible. This will only take about a minute — is now a good time?"`;

  const defaultPickup = `[STEP 3 — CONFIRM PICKUP LOCATION]
AI: "I have your pickup location as {{pickup_location}}. Is that correct?"`;

  const defaultVehicle = `[STEP 4 — CONFIRM VEHICLE DETAILS]
AI: "And I have a {{vehicle}}. Is that right?"`;

  const defaultIssue = `[STEP 5 — CLARIFY THE ISSUE]
AI: "I see the issue is listed as {{issue}}. Can you tell me a little more about what happened?"`;

  const defaultDestination = `[STEP 6 — CONFIRM DELIVERY DESTINATION]
AI: "And I have your vehicle being towed to {{destination}}. Is that where you'd like it to go?"`;

  const defaultClose = `=== WARM CLOSE (all scenarios) ===
AI: "Your driver is on the way and should be there shortly. Is there anything else I can help you with?"
AI: "You're welcome, {{customer_first_name}}. Have a great day and drive safe."`;

  const [mentionRentals, setMentionRentals] = useState<boolean>(
    config.config?.mention_rentals !== false,
  );
  const [customAgentRules, setCustomAgentRules] = useState<string>(
    (config.config?.custom_agent_rules as string) || DEFAULT_AGENT_RULES,
  );

  const defaultOffer1 = `I appreciate that, {{customer_first_name}}. I want to let you know — as a thank-you for using our service, we have a certified repair facility just {{nearest_shop_distance}} miles away called {{nearest_shop}}. If you'd like, we can redirect your tow there at no extra charge, and you'd receive a completely free diagnostic and 10 percent off your repair. Would you like me to make that switch?`;
  const defaultOffer2 = `I completely understand loyalty to a good mechanic. Just so you know — our shop offers same-day priority service for tow customers. Your car would be looked at within one hour of arrival, and you'd have a written estimate before any work begins. No appointment needed. Would that change your mind?`;
  const defaultOffer3 = `No problem at all. Last thing I'll mention — we're running a program right now where tow customers who use our shop receive a 50 dollar credit toward their next service. Plus, if you leave a Google review after your visit, that earns you an additional 25 dollar gift card. I just wanted to make sure you had that option. Would you like me to switch it over?`;
  const defaultConvini = `Absolutely, {{customer_first_name}}. Your driver is headed to {{destination}} as planned. One quick thing before I let you go — we have a free app called CONVINIcar that gives you roadside assistance, repair scheduling, car rentals, and exclusive member deals all in one place. Can I text you the download link? It's completely free and takes about 30 seconds to set up.`;

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
            custom_agent_rules: customAgentRules,
            max_shop_distance_miles: maxDistanceMiles,
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

        <div className="pt-6">
          <h3 className="text-lg font-semibold text-zinc-800">Script Builder</h3>
          <p className="text-sm text-zinc-500 mb-4">
            Customize the exact spoken dialogue for each phase of the pitch. Leave a box empty to automatically skip that step.
            Available variables: <span className="font-mono text-xs">{'{{customer_first_name}}'}</span>, <span className="font-mono text-xs">{'{{vehicle}}'}</span>, <span className="font-mono text-xs">{'{{pickup_location}}'}</span>, <span className="font-mono text-xs">{'{{destination}}'}</span>, <span className="font-mono text-xs">{'{{issue}}'}</span>, <span className="font-mono text-xs">{'{{nearest_shop}}'}</span>, <span className="font-mono text-xs">{'{{nearest_shop_distance}}'}</span>.
          </p>

          <div className="space-y-6">
            <SettingsField
              label="1. Greeting & Identification"
              help="How the AI answers and introduces itself."
            >
              <textarea
                className="h-24 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={openingBlock}
                onChange={(e) => setOpeningBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="2. Purpose of Call"
              help="Stating why the AI is calling."
            >
              <textarea
                className="h-24 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={purposeBlock}
                onChange={(e) => setPurposeBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="3. Confirm Pickup Location"
              help="Confirming where the customer's vehicle is located."
            >
              <textarea
                className="h-20 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={pickupBlock}
                onChange={(e) => setPickupBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="4. Confirm Vehicle"
              help="Confirming the make/model/year."
            >
              <textarea
                className="h-20 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={vehicleBlock}
                onChange={(e) => setVehicleBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="5. Clarify Issue"
              help="Asking what went wrong with the vehicle."
            >
              <textarea
                className="h-20 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={issueBlock}
                onChange={(e) => setIssueBlock(e.target.value)}
              />
            </SettingsField>

            <SettingsField
              label="6. Confirm Destination"
              help="Confirming where the vehicle is being towed to."
            >
              <textarea
                className="h-20 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={destinationBlock}
                onChange={(e) => setDestinationBlock(e.target.value)}
              />
            </SettingsField>
            <SettingsField
              label="Offer 1 (Convenience & Value)"
              help="The first pitch made when the destination is a competitor repair shop."
            >
              <textarea
                className="h-28 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={offer1}
                onChange={(e) => setOffer1(e.target.value)}
                placeholder="Leave empty to skip this offer"
              />
            </SettingsField>

            <SettingsField
              label="Offer 2 (Urgency & Priority)"
              help="The second pitch made if the customer declines Offer 1."
            >
              <textarea
                className="h-28 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={offer2}
                onChange={(e) => setOffer2(e.target.value)}
                placeholder="Leave empty to skip this offer"
              />
            </SettingsField>

            <SettingsField
              label="Offer 3 (Financial Incentive)"
              help="The final pitch made if the customer declines Offer 2."
            >
              <textarea
                className="h-28 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                value={offer3}
                onChange={(e) => setOffer3(e.target.value)}
                placeholder="Leave empty to skip this offer"
              />
            </SettingsField>

            <SettingsField
              label="CONVINI App Pitch (Soft Close)"
              help="The final pivot if all offers are declined or if the destination is an auto body shop."
            >
              <textarea
                className="h-28 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
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
            Only modify these if you want to completely replace the underlying AI system prompt logic.
          </p>
        </div>

        <SettingsField
          label="Custom Agent Rules"
          help="Global instructions appended to the system prompt. Overrides the default AI agent instructions."
        >
          <textarea
            className="h-32 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g. CRITICAL PARSING RULES: ..."
            value={customAgentRules}
            onChange={(e) => setCustomAgentRules(e.target.value)}
          />
        </SettingsField>

        <SettingsField
          label="Warm Close"
          help="The final goodbye at the very end of the call, after Convini is pitched."
        >
          <textarea
            className="h-28 w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            value={closeBlock}
            onChange={(e) => setCloseBlock(e.target.value)}
          />
        </SettingsField>

        <div className="flex justify-end pt-2 gap-4">
          <Button
            variant="outline"
            onClick={async () => {
              if (confirm("Are you sure you want to reset all configurations to their defaults? This cannot be undone.")) {
                setSubmitting(true);
                try {
                  await api('/v1/admin/flip-engine/config/reset', { method: 'POST' });
                  await reload();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setSubmitting(false);
                }
              }
            }}
            disabled={submitting}
          >
            Reset to defaults
          </Button>
          <Button onClick={() => void save()} disabled={submitting}>
            {submitting ? <Spinner className="mr-2" /> : null}
            Save settings
          </Button>
        </div>
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
                    <Badge className={OUTCOME_COLOR[bucket] ?? 'bg-zinc-700 text-zinc-200'}>
                      {bucket}
                    </Badge>
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
