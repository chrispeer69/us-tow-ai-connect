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
  failureReason: string | null;
}

const softwareLabels: Record<string, string> = {
  TOWBOOK: 'Towbook',
  TOWLOGS: 'TowLogs',
  OMADI: 'Omadi',
  AAA_PORTAL: 'AAA Portal',
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [softwareType, setSoftwareType] = useState('TOWBOOK');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [pausing, setPausing] = useState<Record<string, boolean>>({});
  const [disconnecting, setDisconnecting] = useState<Record<string, boolean>>({});
  
  const [showCredentialsForm, setShowCredentialsForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [disconnectConfirmFor, setDisconnectConfirmFor] = useState<string | null>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const data = await api<IntegrationStatus[]>('/v1/admin/integrations/status');
      setIntegrations(data);
      if (data.length === 0) {
        setShowCredentialsForm(true);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api<{ warning?: string }>('/v1/admin/credentials', {
        method: 'POST',
        json: { username, password, softwareType },
      });
      await handleForceRefresh(softwareType);
      setShowCredentialsForm(false);
      setUsername('');
      setPassword('');
      if (response && response.warning) {
        setSuccess(response.warning);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleForceRefresh(type: string) {
    setRefreshing(prev => ({ ...prev, [type]: true }));
    setError(null);
    setSuccess(null);
    try {
      await api('/v1/admin/credentials/test', { method: 'POST', json: { softwareType: type } });
      await loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(prev => ({ ...prev, [type]: false }));
    }
  }

  async function handleTogglePause(type: string, currentStatus: string) {
    setPausing(prev => ({ ...prev, [type]: true }));
    setError(null);
    setSuccess(null);
    try {
      const endpoint = currentStatus === 'PAUSED' ? '/v1/admin/credentials/resume' : '/v1/admin/credentials/pause';
      await api(endpoint, { method: 'POST', json: { softwareType: type } });
      await loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPausing(prev => ({ ...prev, [type]: false }));
    }
  }

  async function confirmDisconnect() {
    if (!disconnectConfirmFor) return;
    setDisconnecting(prev => ({ ...prev, [disconnectConfirmFor]: true }));
    setError(null);
    setSuccess(null);
    try {
      await api(`/v1/admin/credentials?softwareType=${disconnectConfirmFor}`, { method: 'DELETE' });
      await loadStatus();
      setSuccess(`Disconnected ${softwareLabels[disconnectConfirmFor] || disconnectConfirmFor}.`);
      setDisconnectConfirmFor(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDisconnecting(prev => ({ ...prev, [disconnectConfirmFor!]: false }));
    }
  }

  function getStatusType(sessionStatus: string): Status {
    if (sessionStatus === 'ACTIVE') return 'CONNECTED';
    if (sessionStatus === 'PAUSED') return 'PAUSED';
    if (sessionStatus === 'FAILED') return 'FAILED';
    return 'DISCONNECTED';
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        variant="hero"
        eyebrow="Configuration"
        title="Towing Software Integration"
        subtitle="Connect your dispatch software to enable AI-powered ETA lookups."
      />

      {error && <p className="text-sm text-red-400 break-words">{error}</p>}
      {success && <p className="text-sm text-[var(--alliance-green)] break-words">{success}</p>}

      {integrations.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-100">Connected Integrations</h2>
          {integrations.map((integration) => {
            const statusType = getStatusType(integration.sessionStatus);
            return (
              <Card key={integration.softwareType}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      {softwareLabels[integration.softwareType] || integration.softwareType}
                      <span className="text-sm text-zinc-400 font-normal">({integration.username})</span>
                    </span>
                    <StatusBadge status={statusType} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-zinc-400">
                      {integration.lastLoginSuccess
                        ? `Last synced: ${new Date(integration.lastLoginSuccess).toLocaleString()}`
                        : 'No session recorded yet.'}
                    </p>
                    <Button variant="outline" onClick={() => handleForceRefresh(integration.softwareType)} disabled={refreshing[integration.softwareType] || statusType === 'PAUSED'}>
                      {refreshing[integration.softwareType] ? <Spinner className="mr-2" /> : null}
                      Force Refresh
                    </Button>
                  </div>

                  {integration.failureReason && statusType === 'FAILED' && (
                    <div className="p-3 bg-red-950/20 border border-red-900/50 rounded-lg">
                      <p className="text-sm text-red-400">Connection Failed: {integration.failureReason}</p>
                    </div>
                  )}

                  <div className="flex gap-2 border-t border-[var(--border-strong)] pt-4">
                    <Button 
                      variant={statusType === 'PAUSED' ? 'default' : 'outline'}
                      onClick={() => handleTogglePause(integration.softwareType, integration.sessionStatus)} 
                      disabled={pausing[integration.softwareType]}
                    >
                      {pausing[integration.softwareType] ? <Spinner className="mr-2" /> : null}
                      {statusType === 'PAUSED' ? 'Resume Integration' : 'Pause Scraper'}
                    </Button>
                    <Button 
                      variant="destructive" 
                      onClick={() => setDisconnectConfirmFor(integration.softwareType)} 
                      disabled={disconnecting[integration.softwareType]}
                    >
                      {disconnecting[integration.softwareType] ? <Spinner className="mr-2" /> : null}
                      Disconnect
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          
          {!showCredentialsForm && (
            <Button variant="outline" onClick={() => setShowCredentialsForm(true)} className="w-full border-dashed">
              + Connect Another Integration
            </Button>
          )}
        </div>
      )}

      {showCredentialsForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{integrations.length > 0 ? 'Add New Integration' : 'Connect Integration'}</span>
              {integrations.length > 0 && (
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
                Save & Connect
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {disconnectConfirmFor && (
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
                  Are you sure you want to disconnect {softwareLabels[disconnectConfirmFor] || disconnectConfirmFor}? This will completely delete saved credentials and stop all background syncing.
                </p>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end pt-4 mt-2 border-t border-zinc-800">
              <Button 
                variant="outline" 
                onClick={() => setDisconnectConfirmFor(null)}
                disabled={disconnecting[disconnectConfirmFor]}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={confirmDisconnect} 
                disabled={disconnecting[disconnectConfirmFor]}
              >
                {disconnecting[disconnectConfirmFor] ? <Spinner className="mr-2" /> : null}
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
