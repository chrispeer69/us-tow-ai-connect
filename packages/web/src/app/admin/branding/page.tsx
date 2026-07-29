'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { useBranding, type Branding, DEFAULT_BRANDING } from '@/components/branding/BrandingProvider';
import { api } from '@/lib/utils';

const FONT_OPTIONS = ['Inter', 'Roboto', 'Open Sans', 'Source Sans 3', 'Lato', 'Montserrat', 'System UI'] as const;

export default function BrandingAdminPage() {
  const { branding: live, setBranding } = useBranding();
  const [form, setForm] = useState<Branding>(live);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileLogo = useRef<HTMLInputElement>(null);
  const fileFav = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Branding>('/v1/admin/branding')
      .then((b) => b || DEFAULT_BRANDING)
      .then((b) => {
        setForm({ ...DEFAULT_BRANDING, ...b });
        setBranding(b);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function update<K extends keyof Branding>(k: K, v: Branding[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setBranding({ [k]: v } as Partial<Branding>);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const updated = await api<Branding>('/v1/admin/branding', {
        method: 'PUT',
        json: form,
      });
      setForm(updated);
      setBranding(updated);
      setMsg('Branding saved.');
    } catch (e) {
      setMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function upload(kind: 'logo' | 'favicon', file: File) {
    setSaving(true);
    setMsg(null);
    try {
      const body = await api<{ url: string; branding: Branding }>(`/v1/admin/branding/upload/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      setForm(body.branding);
      setBranding(body.branding);
      setMsg(`${kind} uploaded.`);
    } catch (e) {
      setMsg(`Upload failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Branding"
        subtitle="Per-tenant white-label colors, logo, and copy. Saves apply immediately to the admin, driver, and tracking pages."
      />
      {msg && (
        <div className="rounded-md border border-emerald-700 bg-emerald-950/60 p-3 text-sm text-emerald-200">{msg}</div>
      )}
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Company display name">
              <Input
                data-testid="branding-display-name"
                value={form.companyDisplayName}
                onChange={(e) => update('companyDisplayName', e.target.value)}
              />
            </Field>
            <Field label="Support phone">
              <Input value={form.supportPhone} onChange={(e) => update('supportPhone', e.target.value)} placeholder="+16145551234" />
            </Field>
            <Field label="Support email">
              <Input value={form.supportEmail} onChange={(e) => update('supportEmail', e.target.value)} placeholder="support@example.com" />
            </Field>
            <Field label="Custom domain (optional)">
              <Input value={form.customDomain ?? ''} onChange={(e) => update('customDomain', e.target.value || null)} placeholder="dispatch.yourtowing.com" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.hidePoweredBy}
                onChange={(e) => update('hidePoweredBy', e.target.checked)}
              />
              Hide &quot;Powered by US Tow AI-Connect&quot; on public pages
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ColorField label="Primary color" value={form.primaryColor} onChange={(v) => update('primaryColor', v)} testid="primary-color" />
            <ColorField label="Secondary color" value={form.secondaryColor} onChange={(v) => update('secondaryColor', v)} />
            <ColorField label="Accent color" value={form.accentColor} onChange={(v) => update('accentColor', v)} />
            <Field label="Font family">
              <select
                className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                value={form.fontFamily}
                onChange={(e) => update('fontFamily', e.target.value)}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm text-zinc-300">Logo (PNG/SVG, max 2 MB)</div>
              {form.logoUrl && (
                <img src={form.logoUrl} alt="logo" className="h-12 rounded bg-zinc-800 p-2" />
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={fileLogo}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="text-xs text-zinc-400"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload('logo', f);
                  }}
                />
                <Input value={form.logoUrl} onChange={(e) => update('logoUrl', e.target.value)} placeholder="…or paste an external URL" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-zinc-300">Favicon (ICO/PNG)</div>
              {form.faviconUrl && (
                <img src={form.faviconUrl} alt="favicon" className="h-8 w-8 rounded bg-zinc-800 p-1" />
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={fileFav}
                  type="file"
                  accept="image/png,image/x-icon,image/vnd.microsoft.icon"
                  className="text-xs text-zinc-400"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload('favicon', f);
                  }}
                />
                <Input value={form.faviconUrl} onChange={(e) => update('faviconUrl', e.target.value)} placeholder="…or paste an external URL" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Outbound signatures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Email signature (HTML)">
              <Textarea
                rows={4}
                value={form.emailSignatureHtml}
                onChange={(e) => update('emailSignatureHtml', e.target.value)}
              />
            </Field>
            <Field label="SMS signature (≤160 chars)">
              <Input
                value={form.smsSignature}
                onChange={(e) => update('smsSignature', e.target.value)}
                maxLength={160}
                placeholder="— Roadside Towing"
              />
            </Field>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            data-testid="branding-preview"
            className="rounded-md border border-zinc-800 p-6"
            style={{
              background: form.secondaryColor,
              fontFamily: 'var(--brand-font)',
            }}
          >
            <div className="flex items-center gap-4">
              {form.logoUrl && <img src={form.logoUrl} alt="logo" className="h-10" />}
              <div className="text-xl font-semibold" style={{ color: form.primaryColor }}>
                {form.companyDisplayName || 'Your Company'}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                className="rounded-md px-4 py-2 text-sm text-white"
                style={{ background: form.primaryColor }}
              >
                Primary action
              </button>
              <button
                className="rounded-md px-4 py-2 text-sm"
                style={{ background: form.accentColor, color: '#111' }}
              >
                Accent
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
      <div>
        <Button onClick={save} disabled={saving} data-testid="branding-save">
          {saving ? 'Saving…' : 'Save branding'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-zinc-300">{label}</div>
      {children}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testid?: string;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-zinc-300">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 rounded border border-zinc-700 bg-zinc-900"
        />
        <Input
          data-testid={testid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
      </div>
    </label>
  );
}
