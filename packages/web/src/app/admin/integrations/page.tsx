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

type Status = 'CONNECTED' | 'DISCONNECTED' | 'TESTING' | 'FAILED' | 'PAUSED';

interface IntegrationStatus {
  softwareType: string;
  hasCredentials: boolean;
  sessionStatus: string;
  lastLoginSuccess: string | null;
  username: string | null;
}

export default function IntegrationsPage() {
  const [softwareType, setSoftwareType] = useState('TOWBOOK');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('DISCONNECTED');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showCredentialsForm, setShowCredentialsForm] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const data = await api<IntegrationStatus>('/v1/admin/integrations/status');
      setSoftwareType(data.softwareType);
      setLastSynced(data.lastLoginSuccess);
      if (data.username) setUsername(data.username);
      
      const isConnected = data.sessionStatus === 'ACTIVE' || data.sessionStatus === 'PAUSED' || data.sessionStatus === 'FAILED';
      setShowCredentialsForm(!isConnected);

      setStatus(
        data.sessionStatus === 'ACTIVE'
          ? 'CONNECTED'
          : data.sessionStatus === 'PAUSED'
          ? 'PAUSED'
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
      setShowCredentialsForm(false);
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
      if (data.success) {
        setLastSynced(new Date().toISOString());
        setShowCredentialsForm(false);
      } else if (data.message) {
        setError(data.message);
      }
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

  async function handleTogglePause() {
    setPausing(true);
    setError(null);
    setSuccess(null);
    try {
      const endpoint = status === 'PAUSED' ? '/v1/admin/credentials/resume' : '/v1/admin/credentials/pause';
      await api(endpoint, { method: 'POST' });
      await loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPausing(false);
    }
  }

  async function confirmDisconnect() {
    setDisconnecting(true);
    setError(null);
    setSuccess(null);
    try {
      await api('/v1/admin/credentials', { method: 'DELETE' });
      setUsername('');
      setPassword('');
      setStatus('DISCONNECTED');
      setLastSynced(null);
      setSuccess('Disconnected. Syncing has stopped.');
      setShowCredentialsForm(true);
      setShowDisconnectConfirm(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  }

  const softwareLabels: Record<string, string> = {
    TOWBOOK: 'Towbook',
    TOWLOGS: 'TowLogs',
    OMADI: 'Omadi',
    AAA_PORTAL: 'AAA Portal',
  };


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
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-400">
              {lastSynced
                ? `Last synced: ${new Date(lastSynced).toLocaleString()}`
                : 'No session recorded yet.'}
            </p>
            <Button variant="outline" onClick={handleForceRefresh} disabled={refreshing || status === 'PAUSED'}>
              {refreshing ? <Spinner className="mr-2" /> : null}
              Force Refresh
            </Button>
          </div>

          {status !== 'DISCONNECTED' ? (
            <div className="flex gap-2 border-t border-[var(--border-strong)] pt-4">
              <Button 
                variant={status === 'PAUSED' ? 'default' : 'outline'}
                onClick={handleTogglePause} 
                disabled={pausing}
              >
                {pausing ? <Spinner className="mr-2" /> : null}
                {status === 'PAUSED' ? 'Resume Integration' : 'Pause Scraper'}
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => setShowDisconnectConfirm(true)} 
                disabled={disconnecting}
              >
                {disconnecting ? <Spinner className="mr-2" /> : null}
                Disconnect Integration
              </Button>
            </div>
          ) : null}
          {error && <p className="text-sm text-red-400 break-words pt-2">{error}</p>}
          {success && <p className="text-sm text-[var(--alliance-green)] break-words pt-2">{success}</p>}
        </CardContent>
      </Card>

      {!showCredentialsForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Connected Software</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-zinc-400 block mb-1">Software Platform</span>
                <span className="font-semibold text-zinc-200">{softwareLabels[softwareType] || softwareType}</span>
              </div>
              <div>
                <span className="text-zinc-400 block mb-1">Active Account</span>
                <span className="font-semibold text-zinc-200">{username}</span>
              </div>
            </div>

            <div className="flex gap-2 border-t border-[var(--border-strong)] pt-4">
              <Button variant="outline" onClick={() => setShowCredentialsForm(true)}>
                Update Login Credentials
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Credentials</span>
              {status !== 'DISCONNECTED' && (
                <Button variant="ghost" size="sm" onClick={() => setShowCredentialsForm(false)}>
                  Cancel
                </Button>
              )}
            </CardTitle>
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
            </div>
            {error && <p className="text-sm text-red-400 break-words">{error}</p>}
            {success && <p className="text-sm text-[var(--alliance-green)] break-words">{success}</p>}
          </CardContent>
        </Card>
      )}

      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-950/40 border border-red-500/20 rounded-xl text-red-400 shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-zinc-100">Disconnect Integration</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Are you sure you want to disconnect {softwareLabels[softwareType] || softwareType}? This will completely delete saved credentials and stop all background syncing.
                </p>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end pt-4 mt-2 border-t border-zinc-800">
              <Button 
                variant="outline" 
                onClick={() => setShowDisconnectConfirm(false)}
                disabled={disconnecting}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={confirmDisconnect} 
                disabled={disconnecting}
              >
                {disconnecting ? <Spinner className="mr-2" /> : null}
                Yes, Disconnect
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'CONNECTED') return <Badge variant="success">● Connected</Badge>;
  if (status === 'PAUSED') return <Badge variant="warning">● Paused</Badge>;
  if (status === 'FAILED') return <Badge variant="destructive">● Disconnected</Badge>;
  if (status === 'TESTING')
    return (
      <Badge variant="outline" className="text-zinc-200">
        <Spinner className="mr-1" /> Testing
      </Badge>
    );
  return <Badge variant="outline">● Disconnected</Badge>;
}
