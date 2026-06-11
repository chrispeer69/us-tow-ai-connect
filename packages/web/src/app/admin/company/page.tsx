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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/utils';

interface Company {
  id: string;
  companyName: string;
  ownerEmail: string;
  timezone: string;
  targetSoftwareType: string;
  assignedPhoneNumber: string | null;
  thinkrrAgentId: string | null;
  apiKeyPrefix: string;
  managerPhones: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

export default function CompanyPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [managerPhones, setManagerPhones] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchCompany();
  }, []);

  async function fetchCompany() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Company>('/v1/admin/company');
      setCompany(data);
      setCompanyName(data.companyName);
      setOwnerEmail(data.ownerEmail);
      setTimezone(data.timezone);
      setManagerPhones((data.managerPhones ?? []).join(', '));
      setHasChanges(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function mutate<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setHasChanges(true);
    setSavedMessage(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api<Company>('/v1/admin/company', {
        method: 'PUT',
        json: {
          companyName,
          ownerEmail,
          timezone,
          managerPhones: parsePhoneList(managerPhones),
        },
      });
      setCompany(updated);
      setManagerPhones((updated.managerPhones ?? []).join(', '));
      setHasChanges(false);
      setSavedMessage('Saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <header>
          <h1 className="text-3xl font-bold">Company Profile</h1>
          <p className="text-zinc-400 mt-1">
            Your organization details and account identifiers.
          </p>
        </header>
        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          )}
          {savedMessage && !hasChanges && (
            <span className="text-xs text-emerald-400">{savedMessage}</span>
          )}
          <Button onClick={save} disabled={!hasChanges || saving}>
            {saving ? <Spinner className="mr-2" /> : null}
            Save Changes
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 break-words">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Spinner /> Loading company...
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block text-sm text-zinc-300">
                Company Name
                <Input
                  value={companyName}
                  onChange={(e) => mutate(setCompanyName, e.target.value)}
                  placeholder="Roadside Towing and Recovery"
                  className="mt-1"
                />
              </label>

              <label className="block text-sm text-zinc-300">
                Owner Email
                <Input
                  type="email"
                  autoComplete="email"
                  value={ownerEmail}
                  onChange={(e) => mutate(setOwnerEmail, e.target.value)}
                  placeholder="owner@example.com"
                  className="mt-1"
                />
              </label>

              <label className="block text-sm text-zinc-300">
                Timezone
                <div className="mt-1">
                  <Select
                    value={timezone}
                    onValueChange={(v) => mutate(setTimezone, v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz.replace(/_/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </label>

              <label className="block text-sm text-zinc-300">
                Manager report phones
                <Input
                  value={managerPhones}
                  onChange={(e) => mutate(setManagerPhones, e.target.value)}
                  placeholder="+16145550111, +16145550222"
                  className="mt-1"
                />
                <span className="mt-1 block text-xs text-zinc-500">
                  Daily flip reports, batch summaries, and flip-win alerts are texted to these
                  numbers. Use comma, space, or line breaks between numbers.
                </span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Account</span>
                <Badge variant={company?.isActive ? 'success' : 'destructive'}>
                  {company?.isActive ? '● Active' : '● Inactive'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ReadOnlyField label="Tenant ID" value={company?.id ?? ''} mono />
              <ReadOnlyField
                label="Towing Software"
                value={company?.targetSoftwareType ?? ''}
              />
              <ReadOnlyField
                label="Assigned Phone Number"
                value={company?.assignedPhoneNumber || 'Not yet assigned'}
                mono
              />
              <ReadOnlyField
                label="Thinkrr Agent ID"
                value={company?.thinkrrAgentId || 'Not yet assigned'}
                mono
              />
              <ReadOnlyField
                label="API Key Prefix"
                value={company?.apiKeyPrefix ?? ''}
                mono
              />
              <ReadOnlyField
                label="Created"
                value={
                  company?.createdAt
                    ? new Date(company.createdAt).toLocaleString()
                    : ''
                }
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function parsePhoneList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((phone) => phone.trim())
        .filter(Boolean),
    ),
  );
}

function ReadOnlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 pb-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <span
        className={`text-sm text-zinc-200 ${mono ? 'font-mono' : ''} text-right break-all max-w-[60%]`}
      >
        {value}
      </span>
    </div>
  );
}
