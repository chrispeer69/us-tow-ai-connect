'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/utils';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface ApiKeyCreated extends ApiKey {
  plaintext: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [justCreated, setJustCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchKeys();
  }, []);

  async function fetchKeys() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<ApiKey[]>('/v1/admin/api-keys');
      setKeys(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }
    setCreating(true);
    setError(null);
    setJustCreated(null);
    try {
      const created = await api<ApiKeyCreated>('/v1/admin/api-keys', {
        method: 'POST',
        json: { name: newName.trim() },
      });
      setJustCreated(created);
      setNewName('');
      await fetchKeys();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`/v1/admin/api-keys/${id}/revoke`, { method: 'POST' });
      await fetchKeys();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/v1/admin/api-keys/${id}`, { method: 'DELETE' });
      await fetchKeys();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copyPlaintext() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard copy failed — select the key manually.');
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-3xl font-bold">API Keys</h1>
        <p className="text-zinc-400 mt-1">
          Create and manage API keys for programmatic access to the US Tow
          AI-Connect API.
        </p>
      </header>

      {error && <p className="text-sm text-red-400 break-words">{error}</p>}

      {justCreated && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-amber-300">
              Save this key — it won&apos;t be shown again
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-zinc-300">
              <span className="font-medium">{justCreated.name}</span> · created{' '}
              {new Date(justCreated.createdAt).toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm font-mono break-all text-zinc-100">
                {justCreated.plaintext}
              </code>
              <Button variant="outline" onClick={copyPlaintext}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setJustCreated(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create New API Key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Key name (e.g. Production Webhook)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button onClick={create} disabled={creating || !newName.trim()}>
            {creating ? <Spinner className="mr-2" /> : null}
            Generate Key
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-400">
              <Spinner /> Loading keys...
            </div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No API keys yet. Generate one above to get started.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{k.name}</div>
                    <div className="text-sm text-zinc-400 font-mono truncate">
                      {k.keyPrefix}…
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Created {new Date(k.createdAt).toLocaleDateString()}
                      {k.lastUsedAt
                        ? ` · Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                        : ' · Never used'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {k.revokedAt ? (
                      <Badge variant="destructive">● Revoked</Badge>
                    ) : (
                      <Badge variant="success">● Active</Badge>
                    )}
                    {!k.revokedAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => revoke(k.id)}
                      >
                        Revoke
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => remove(k.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
