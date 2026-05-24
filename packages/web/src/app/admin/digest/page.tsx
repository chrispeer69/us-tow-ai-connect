'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/utils';

interface DigestSettings {
  tenantId: string;
  companyName: string | null;
  digestEmails: string[];
  digestFrequency: 'daily' | 'weekly' | 'off';
}

export default function AdminDigestPage() {
  const [settings, setSettings] = useState<DigestSettings | null>(null);
  const [draft, setDraft] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'off'>('daily');
  const [previewRange, setPreviewRange] = useState<'daily' | 'weekly'>('daily');
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<DigestSettings>('/v1/admin/digest');
      setSettings(data);
      setDraft(data.digestEmails.join(', '));
      setFrequency(data.digestFrequency);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError(null);
    setInfo(null);
    const emails = draft
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    try {
      const updated = await api<DigestSettings>('/v1/admin/digest', {
        method: 'PUT',
        body: JSON.stringify({ digestEmails: emails, digestFrequency: frequency }),
      });
      setSettings({ ...(settings as DigestSettings), ...updated });
      setInfo(`Saved. ${updated.digestEmails.length} recipient(s).`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const sendTest = async () => {
    setError(null);
    setInfo(null);
    try {
      const result = await api<{ sent: number; recipients: string[]; range: string }>(
        `/v1/admin/digest/test?range=${previewRange}`,
        { method: 'POST' },
      );
      setInfo(
        result.sent === 0
          ? `No emails sent — recipient list is empty.`
          : `Sent ${result.sent} email(s) to ${result.recipients.join(', ')}.`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const loadPreview = useCallback(async () => {
    setError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const tenantId = settings?.tenantId ?? '';
      const res = await fetch(`${apiBase}/v1/admin/digest/preview?range=${previewRange}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
      const html = await res.text();
      setPreviewHtml(html);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [previewRange, settings?.tenantId]);

  useEffect(() => {
    if (settings) void loadPreview();
  }, [settings, loadPreview]);

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Admin Digest"
        subtitle={
          <>
            {settings?.companyName ?? 'Loading…'} — daily / weekly summary email of call activity,
            jobs, and reliability signals.
          </>
        }
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {info && <p className="text-sm text-emerald-400">{info}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Recipients & frequency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Recipients (comma or space separated)</label>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="ops@yourshop.com, dispatcher@yourshop.com"
              disabled={loading}
            />
          </div>
          <div className="flex items-end gap-3">
            <div className="w-48">
              <label className="text-xs text-zinc-500 mb-1 block">Frequency</label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as 'daily' | 'weekly' | 'off')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily — 08:00 server time</SelectItem>
                  <SelectItem value="weekly">Weekly — Mondays 08:00</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={save} disabled={loading}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview & test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="w-48">
              <label className="text-xs text-zinc-500 mb-1 block">Preview range</label>
              <Select value={previewRange} onValueChange={(v) => setPreviewRange(v as 'daily' | 'weekly')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Last 24 hours</SelectItem>
                  <SelectItem value="weekly">Last 7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" onClick={loadPreview}>
              Refresh preview
            </Button>
            <Button onClick={sendTest}>Send test email now</Button>
          </div>
          <div className="border border-zinc-800 rounded overflow-hidden bg-white">
            <iframe
              title="Digest preview"
              className="w-full bg-white"
              style={{ height: '720px', border: 'none' }}
              srcDoc={previewHtml || '<p style="padding:24px;font-family:sans-serif;color:#6b7280">Loading preview…</p>'}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
