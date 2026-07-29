'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Switch } from '@/components/ui/switch';
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
  managerPhones: string[];
  dailySmsEnabled: boolean;
  dailySmsHourLocal: number;
}

export default function AdminDigestPage() {
  const [settings, setSettings] = useState<DigestSettings | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'off'>('daily');
  const [dailySmsEnabled, setDailySmsEnabled] = useState(true);
  const [dailySmsHourLocal, setDailySmsHourLocal] = useState(21);
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
      setEmailDraft(data.digestEmails.join(', '));
      setPhoneDraft((data.managerPhones ?? []).join(', '));
      setFrequency(data.digestFrequency);
      setDailySmsEnabled(data.dailySmsEnabled);
      setDailySmsHourLocal(data.dailySmsHourLocal ?? 21);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (): Promise<DigestSettings> => {
    const emails = emailDraft
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const phones = parsePhoneList(phoneDraft);
    const updated = await api<DigestSettings>('/v1/admin/digest', {
      method: 'PUT',
      json: {
        digestEmails: emails,
        digestFrequency: frequency,
        managerPhones: phones,
        dailySmsEnabled,
        dailySmsHourLocal,
      },
    });
    setSettings({ ...(settings as DigestSettings), ...updated });
    setPhoneDraft((updated.managerPhones ?? []).join(', '));
    return updated;
  };

  const save = async () => {
    setError(null);
    setInfo(null);
    try {
      const updated = await saveSettings();
      setInfo(
        `Saved. ${updated.digestEmails.length} email recipient(s), ${(updated.managerPhones ?? []).length} SMS recipient(s).`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const sendTest = async (channel: 'email' | 'sms' | 'all') => {
    setError(null);
    setInfo(null);
    try {
      await saveSettings();
      const result = await api<{
        range: string;
        email: { sent: number; recipients: string[] };
        sms: { sent: number; recipients: string[] };
      }>(
        `/v1/admin/digest/test?range=${previewRange}&channel=${channel}`,
        { method: 'POST' },
      );
      const parts = [];
      if (channel === 'email' || channel === 'all') {
        parts.push(
          result.email.sent === 0
            ? 'No email sent'
            : `Sent ${result.email.sent} email(s) to ${result.email.recipients.join(', ')}`,
        );
      }
      if (channel === 'sms' || channel === 'all') {
        parts.push(
          result.sms.sent === 0
            ? 'No SMS sent'
            : `Sent ${result.sms.sent} SMS message(s) to ${result.sms.recipients.join(', ')}`,
        );
      }
      setInfo(`${parts.join('. ')}.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const loadPreview = useCallback(async () => {
    setError(null);
    try {
      const html = await api<string>(`/v1/admin/digest/preview?range=${previewRange}`, {
        headers: { 
          'x-tenant-id': settings?.tenantId ?? '',
          Accept: 'text/html'
        },
      });
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
            {settings?.companyName ?? 'Loading…'} — daily / weekly summary by email and daily
            flip report by SMS.
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
            <label className="text-xs text-zinc-500 mb-1 block">Email recipients</label>
            <Input
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              placeholder="ops@yourshop.com, dispatcher@yourshop.com"
              disabled={loading}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">SMS report phones</label>
            <Input
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder="+16145550111, +16145550222"
              disabled={loading}
            />
            <p className="mt-1 text-xs text-zinc-500">
              Use E.164 format when possible. These numbers receive daily flip reports,
              batch summaries, and flip-win alerts.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div className="w-48">
              <label className="text-xs text-zinc-500 mb-1 block">Email automation</label>
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
            <label className="flex items-center gap-3 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300">
              <Switch checked={dailySmsEnabled} onCheckedChange={setDailySmsEnabled} disabled={loading} />
              Daily SMS report
            </label>
            <div className="w-40">
              <label className="text-xs text-zinc-500 mb-1 block">SMS hour local</label>
              <Input
                type="number"
                min={0}
                max={23}
                value={dailySmsHourLocal}
                onChange={(e) => setDailySmsHourLocal(Number(e.target.value))}
                disabled={loading}
              />
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
            <Button onClick={() => sendTest('email')}>Send email now</Button>
            <Button onClick={() => sendTest('sms')}>Send SMS now</Button>
            <Button onClick={() => sendTest('all')}>Send both now</Button>
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

function parsePhoneList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((phone) => {
          const trimmed = phone.trim();
          if (!trimmed) return '';
          if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
          return trimmed.replace(/\D/g, '');
        })
        .filter(Boolean),
    ),
  );
}
