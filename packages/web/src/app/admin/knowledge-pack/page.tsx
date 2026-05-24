'use client';
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ||
  '00000000-0000-0000-0000-000000000001';

interface KpDraft {
  identity: {
    name: string;
    brands: string[];
    slogan: string;
    founded_year: number | null;
    license_numbers: string[];
  };
  services: Array<{
    name: string;
    description: string;
    price_range_disclaimer: string;
    availability_24_7: boolean;
  }>;
  service_areas: Array<{ county: string; cities: string[]; zip_prefixes: string[] }>;
  hours: { regular: { mon_fri: string; sat: string; sun: string }; after_hours_premium: boolean };
  fleet: Array<{ type: 'light-duty' | 'medium-duty' | 'heavy-duty' | 'flatbed' | 'wrecker' | 'rotator'; count: number }>;
  transfer_rules: Array<{ trigger: 'human_request' | 'impound' | 'pricing' | 'after_hours'; phone: string; label: string }>;
  pricing_policy: { quote_at_dispatch: boolean; accepts_motor_clubs: string[]; cash_accepted: boolean; cards_accepted: boolean };
  escalation: { manager_phones: string[]; escalate_after_min_on_hold: number };
}

const EMPTY: KpDraft = {
  identity: { name: '', brands: [''], slogan: '', founded_year: null, license_numbers: [] },
  services: [],
  service_areas: [],
  hours: { regular: { mon_fri: '24/7', sat: '24/7', sun: '24/7' }, after_hours_premium: false },
  fleet: [],
  transfer_rules: [],
  pricing_policy: { quote_at_dispatch: true, accepts_motor_clubs: [], cash_accepted: true, cards_accepted: true },
  escalation: { manager_phones: [], escalate_after_min_on_hold: 5 },
};

export default function KnowledgePackAdminPage() {
  const [data, setData] = useState<{
    draft: KpDraft;
    content: KpDraft | Record<string, never>;
    version: number;
    published: boolean;
    lastPublishedAt: string | null;
  } | null>(null);
  const [draft, setDraft] = useState<KpDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/v1/admin/knowledge-pack`, {
      headers: { 'x-tenant-id': DEFAULT_TENANT_ID },
    })
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        const initial: KpDraft =
          d.draft && Object.keys(d.draft).length > 0
            ? d.draft
            : Object.keys(d.content ?? {}).length > 0
              ? (d.content as KpDraft)
              : EMPTY;
        setDraft(initial);
      })
      .catch(() => setMsg('Failed to load Knowledge Pack'));
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/v1/admin/knowledge-pack/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': DEFAULT_TENANT_ID },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? `HTTP ${res.status}`);
      setData(await res.json());
      setMsg('Draft saved.');
    } catch (err) {
      setMsg(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!confirm('Publish the current draft? It replaces the live Knowledge Pack served to Thinkrr.')) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/v1/admin/knowledge-pack/publish`, {
        method: 'POST',
        headers: { 'x-tenant-id': DEFAULT_TENANT_ID },
      });
      if (!res.ok) throw new Error((await res.json()).message ?? `HTTP ${res.status}`);
      setData(await res.json());
      setMsg('Published.');
    } catch (err) {
      setMsg(`Publish failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const updateIdentity = <K extends keyof KpDraft['identity']>(k: K, v: KpDraft['identity'][K]) =>
    setDraft((d) => ({ ...d, identity: { ...d.identity, [k]: v } }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <PageHeader
          title="Knowledge Pack (v2)"
          subtitle={
            <>
              The richer, sectioned profile served at <code>/public/knowledge/:id/profile.v2.md</code>
              {' '}and <code>/profile.json</code>. Edits go to the <b>draft</b>; <b>Publish</b> swaps
              it into <code>content</code>.
            </>
          }
        />
        {data && (
          <div className="mt-2 text-xs text-zinc-500">
            Version: {data.version} • Published: {data.published ? 'yes' : 'no'}
            {data.lastPublishedAt && ` • Last published ${new Date(data.lastPublishedAt).toLocaleString()}`}
          </div>
        )}
      </div>
      {msg && (
        <div className="rounded-md border border-emerald-700 bg-emerald-950/60 p-3 text-sm text-emerald-200">{msg}</div>
      )}
      <Card>
        <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Name"><Input data-testid="kp-name" value={draft.identity.name} onChange={(e) => updateIdentity('name', e.target.value)} /></Field>
          <Field label="Slogan"><Input value={draft.identity.slogan} onChange={(e) => updateIdentity('slogan', e.target.value)} /></Field>
          <Field label="Brands (comma-separated)">
            <Input value={draft.identity.brands.join(', ')} onChange={(e) => updateIdentity('brands', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
          </Field>
          <Field label="Founded year">
            <Input type="number" value={draft.identity.founded_year ?? ''} onChange={(e) => updateIdentity('founded_year', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="License numbers (comma-separated)">
            <Input value={draft.identity.license_numbers.join(', ')} onChange={(e) => updateIdentity('license_numbers', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Hours</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <Field label="Mon–Fri"><Input value={draft.hours.regular.mon_fri} onChange={(e) => setDraft({ ...draft, hours: { ...draft.hours, regular: { ...draft.hours.regular, mon_fri: e.target.value } } })} /></Field>
          <Field label="Sat"><Input value={draft.hours.regular.sat} onChange={(e) => setDraft({ ...draft, hours: { ...draft.hours, regular: { ...draft.hours.regular, sat: e.target.value } } })} /></Field>
          <Field label="Sun"><Input value={draft.hours.regular.sun} onChange={(e) => setDraft({ ...draft, hours: { ...draft.hours, regular: { ...draft.hours.regular, sun: e.target.value } } })} /></Field>
          <label className="col-span-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.hours.after_hours_premium} onChange={(e) => setDraft({ ...draft, hours: { ...draft.hours, after_hours_premium: e.target.checked } })} />
            Charge premium after-hours rates
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Services</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {draft.services.map((s, idx) => (
            <div key={idx} className="grid grid-cols-3 gap-2 rounded-md border border-zinc-800 p-3">
              <Input className="col-span-1" placeholder="Name" value={s.name} onChange={(e) => updateService(idx, { ...s, name: e.target.value })} />
              <Input className="col-span-2" placeholder="Description" value={s.description} onChange={(e) => updateService(idx, { ...s, description: e.target.value })} />
              <Input className="col-span-2" placeholder="Price disclaimer" value={s.price_range_disclaimer} onChange={(e) => updateService(idx, { ...s, price_range_disclaimer: e.target.value })} />
              <label className="col-span-1 flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={s.availability_24_7} onChange={(e) => updateService(idx, { ...s, availability_24_7: e.target.checked })} />
                24/7
              </label>
              <Button className="col-span-3" variant="ghost" type="button" onClick={() => setDraft({ ...draft, services: draft.services.filter((_, i) => i !== idx) })}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" type="button" onClick={() => setDraft({ ...draft, services: [...draft.services, { name: '', description: '', price_range_disclaimer: '', availability_24_7: true }] })}>
            + Add service
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Service areas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {draft.service_areas.map((a, idx) => (
            <div key={idx} className="grid grid-cols-3 gap-2 rounded-md border border-zinc-800 p-3">
              <Input className="col-span-1" placeholder="County" value={a.county} onChange={(e) => updateArea(idx, { ...a, county: e.target.value })} />
              <Input className="col-span-1" placeholder="Cities (comma)" value={a.cities.join(', ')} onChange={(e) => updateArea(idx, { ...a, cities: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              <Input className="col-span-1" placeholder="Zip prefixes" value={a.zip_prefixes.join(', ')} onChange={(e) => updateArea(idx, { ...a, zip_prefixes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              <Button className="col-span-3" variant="ghost" type="button" onClick={() => setDraft({ ...draft, service_areas: draft.service_areas.filter((_, i) => i !== idx) })}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" type="button" onClick={() => setDraft({ ...draft, service_areas: [...draft.service_areas, { county: '', cities: [], zip_prefixes: [] }] })}>
            + Add area
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Fleet</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {draft.fleet.map((f, idx) => (
            <div key={idx} className="grid grid-cols-3 gap-2">
              <select className="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100" value={f.type} onChange={(e) => updateFleet(idx, { ...f, type: e.target.value as KpDraft['fleet'][number]['type'] })}>
                <option value="light-duty">light-duty</option>
                <option value="medium-duty">medium-duty</option>
                <option value="heavy-duty">heavy-duty</option>
                <option value="flatbed">flatbed</option>
                <option value="wrecker">wrecker</option>
                <option value="rotator">rotator</option>
              </select>
              <Input type="number" min={0} value={f.count} onChange={(e) => updateFleet(idx, { ...f, count: Number(e.target.value) })} />
              <Button variant="ghost" type="button" onClick={() => setDraft({ ...draft, fleet: draft.fleet.filter((_, i) => i !== idx) })}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" type="button" onClick={() => setDraft({ ...draft, fleet: [...draft.fleet, { type: 'medium-duty', count: 1 }] })}>+ Add vehicle</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Transfer rules</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {draft.transfer_rules.map((r, idx) => (
            <div key={idx} className="grid grid-cols-4 gap-2">
              <select className="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100" value={r.trigger} onChange={(e) => updateRule(idx, { ...r, trigger: e.target.value as KpDraft['transfer_rules'][number]['trigger'] })}>
                <option value="human_request">human_request</option>
                <option value="impound">impound</option>
                <option value="pricing">pricing</option>
                <option value="after_hours">after_hours</option>
              </select>
              <Input placeholder="+16145551234" value={r.phone} onChange={(e) => updateRule(idx, { ...r, phone: e.target.value })} />
              <Input placeholder="Label" value={r.label} onChange={(e) => updateRule(idx, { ...r, label: e.target.value })} />
              <Button variant="ghost" type="button" onClick={() => setDraft({ ...draft, transfer_rules: draft.transfer_rules.filter((_, i) => i !== idx) })}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" type="button" onClick={() => setDraft({ ...draft, transfer_rules: [...draft.transfer_rules, { trigger: 'human_request', phone: '', label: '' }] })}>+ Add transfer rule</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Pricing policy</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.pricing_policy.quote_at_dispatch} onChange={(e) => setDraft({ ...draft, pricing_policy: { ...draft.pricing_policy, quote_at_dispatch: e.target.checked } })} />
            Quote price at dispatch
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.pricing_policy.cash_accepted} onChange={(e) => setDraft({ ...draft, pricing_policy: { ...draft.pricing_policy, cash_accepted: e.target.checked } })} />
            Cash accepted
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.pricing_policy.cards_accepted} onChange={(e) => setDraft({ ...draft, pricing_policy: { ...draft.pricing_policy, cards_accepted: e.target.checked } })} />
            Cards accepted
          </label>
          <Field label="Accepted motor clubs (comma-separated)">
            <Input value={draft.pricing_policy.accepts_motor_clubs.join(', ')} onChange={(e) => setDraft({ ...draft, pricing_policy: { ...draft.pricing_policy, accepts_motor_clubs: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} placeholder="AAA, Allstate, GEICO" />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Escalation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Manager phones (comma-separated, E.164)">
            <Input value={draft.escalation.manager_phones.join(', ')} onChange={(e) => setDraft({ ...draft, escalation: { ...draft.escalation, manager_phones: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} />
          </Field>
          <Field label="Escalate after N minutes on hold">
            <Input type="number" min={0} max={60} value={draft.escalation.escalate_after_min_on_hold} onChange={(e) => setDraft({ ...draft, escalation: { ...draft.escalation, escalate_after_min_on_hold: Number(e.target.value) } })} />
          </Field>
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Button data-testid="kp-save" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</Button>
        <Button data-testid="kp-publish" variant="outline" onClick={publish} disabled={busy}>{busy ? 'Working…' : 'Publish'}</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>Live URLs (after publish)</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs text-zinc-300">
          <div>Markdown: <code>{API_BASE}/public/knowledge/{DEFAULT_TENANT_ID}/profile.v2.md</code></div>
          <div>JSON:     <code>{API_BASE}/public/knowledge/{DEFAULT_TENANT_ID}/profile.json</code></div>
          <div className="text-zinc-500">The legacy <code>/profile.md</code> route auto-prefers v2 when published.</div>
        </CardContent>
      </Card>
    </div>
  );

  function updateService(idx: number, next: KpDraft['services'][number]) {
    setDraft((d) => ({ ...d, services: d.services.map((x, i) => (i === idx ? next : x)) }));
  }
  function updateArea(idx: number, next: KpDraft['service_areas'][number]) {
    setDraft((d) => ({ ...d, service_areas: d.service_areas.map((x, i) => (i === idx ? next : x)) }));
  }
  function updateFleet(idx: number, next: KpDraft['fleet'][number]) {
    setDraft((d) => ({ ...d, fleet: d.fleet.map((x, i) => (i === idx ? next : x)) }));
  }
  function updateRule(idx: number, next: KpDraft['transfer_rules'][number]) {
    setDraft((d) => ({ ...d, transfer_rules: d.transfer_rules.map((x, i) => (i === idx ? next : x)) }));
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-zinc-300">{label}</div>
      {children}
    </label>
  );
}
