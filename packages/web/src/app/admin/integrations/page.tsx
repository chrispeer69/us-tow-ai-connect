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
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/utils';

type Status = 'CONNECTED' | 'DISCONNECTED' | 'TESTING' | 'FAILED';

interface IntegrationStatus {
  softwareType: string;
  hasCredentials: boolean;
  sessionStatus: string;
  lastLoginSuccess: string | null;
}

export default function IntegrationsPage() {
  const [softwareType, setSoftwareType] = useState('TOWBOOK');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('DISCONNECTED');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const data = await api<IntegrationStatus>('/v1/admin/integrations/status');
      setSoftwareType(data.softwareType);
      setLastSynced(data.lastLoginSuccess);
      setStatus(
        data.sessionStatus === 'ACTIVE'
          ? 'CONNECTED'
          : data.sessionStatus === 'FAILED'
          ? 'FAILED'
          : 'DISCONNECTED',
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api('/v1/admin/credentials', {
        method: 'POST',
        json: { username, password, softwareType },
      });
      await handleTest();
    } catch (err) {
      setStatus('FAILED');
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setStatus('TESTING');
    setError(null);
    setSuccess(null);
    try {
      const data = await api<{ success: boolean; message: string; latencyMs: number }>(
        '/v1/admin/credentials/test',
        { method: 'POST' },
      );
      setStatus(data.success ? 'CONNECTED' : 'FAILED');
      if (data.success) setLastSynced(new Date().toISOString());
      else if (data.message) setError(data.message);
    } catch (err) {
      setStatus('FAILED');
      setError((err as Error).message);
    }
  }

  async function handleForceRefresh() {
    setRefreshing(true);
    setError(null);
    setSuccess(null);
    try {
      await api('/v1/admin/credentials/test', { method: 'POST' });
      await loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Towbook? This stops syncing.')) return;
    setDisconnecting(true);
    setError(null);
    setSuccess(null);
    try {
      await api('/v1/admin/credentials', { method: 'DELETE' });
      setStatus('DISCONNECTED');
      setLastSynced(null);
      setSuccess('Disconnected. Syncing has stopped.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        variant="hero"
        eyebrow="Configuration"
        title="Towing Software Integration"
        subtitle="Connect your dispatch software to enable AI-powered ETA lookups."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Connection Status</span>
            <StatusBadge status={status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-zinc-400">
            {lastSynced
              ? `Last synced: ${new Date(lastSynced).toLocaleString()}`
              : 'No session recorded yet.'}
          </p>
          <Button variant="outline" onClick={handleForceRefresh} disabled={refreshing}>
            {refreshing ? <Spinner className="mr-2" /> : null}
            Force Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block text-sm text-zinc-300">
            Software
            <div className="mt-1">
              <Select value={softwareType} onValueChange={setSoftwareType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select software" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TOWBOOK">Towbook</SelectItem>
                  <SelectItem value="TOWLOGS">TowLogs</SelectItem>
                  <SelectItem value="OMADI">Omadi</SelectItem>
                  <SelectItem value="AAA_PORTAL">AAA Portal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </label>

          <label className="block text-sm text-zinc-300">
            Username
            <Input
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="dispatch@yourcompany.com"
              className="mt-1"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            Password
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1"
            />
          </label>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || !username || !password}>
              {saving ? <Spinner className="mr-2" /> : null}
              Save & Encrypt
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={status === 'TESTING'}>
              {status === 'TESTING' ? <Spinner className="mr-2" /> : null}
              Test Connection
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="ml-auto"
            >
              {disconnecting ? <Spinner className="mr-2" /> : null}
              Disconnect
            </Button>
          </div>
          {error && <p className="text-sm text-red-400 break-words">{error}</p>}
          {success && <p className="text-sm text-[var(--alliance-green)] break-words">{success}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'CONNECTED') return <Badge variant="success">● Connected</Badge>;
  if (status === 'FAILED') return <Badge variant="destructive">● Disconnected</Badge>;
  if (status === 'TESTING')
    return (
      <Badge variant="outline" className="text-zinc-200">
        <Spinner className="mr-1" /> Testing
      </Badge>
    );
  return <Badge variant="outline">● Disconnected</Badge>;
}
