'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api, cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function DiagnosticsHubPage() {
  const { setToken } = useAuth();
  const [tenants, setTenants] = useState<{ id: string; companyName: string }[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [loadingTenants, setLoadingTenants] = useState(true);

  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);

  useEffect(() => {
    async function loadTenants() {
      try {
        const res = await api<{ id: string; companyName: string }[]>('/v1/super-admin/tenants');
        setTenants(res);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingTenants(false);
      }
    }
    void loadTenants();
  }, []);

  const handleRunDiagnostics = async () => {
    if (!selectedTenantId) return;
    setRunningDiagnostics(true);
    setResults(null);
    try {
      const res = await api<any>(`/v1/super-admin/diagnostics/run-all?tenantId=${selectedTenantId}`, {
        direct: true,
      });
      if (res.success && res.results) {
        setResults(res.results);
      } else if (!res.success && res.error) {
        setResults([
          {
            name: 'Backend Exception',
            status: 'fail',
            message: 'The diagnostic service crashed internally.',
            details: `${res.error}\n\n${res.stack || ''}`
          }
        ]);
      }
    } catch (err) {
      console.error(err);
      setResults([
        {
          name: 'Critical System Error',
          status: 'fail',
          message: 'The diagnostics runner encountered a fatal error.',
          details: (err as Error).message
        }
      ]);
    } finally {
      setRunningDiagnostics(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-semibold text-white">Diagnostics Hub</h1>
            <Badge variant="destructive" className="bg-red-900/40 text-red-400 border-red-900/50">
              Super Admin Access
            </Badge>
          </div>
          <p className="text-zinc-400 text-sm">
            Super Admin tools to securely diagnose issues for any tenant in the system.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.location.href = '/super-admin'}>
          ← Back to Admin
        </Button>
      </div>

      <Card className="bg-zinc-950 border-zinc-800 shadow-xl">
        <CardHeader>
          <CardTitle className="text-zinc-100">Select Target Tenant</CardTitle>
          <p className="text-sm text-zinc-400 mt-1">Select a tenant to run a full diagnostic health check.</p>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={comboboxOpen}
                className="w-full max-w-md justify-between bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800 hover:text-white"
                disabled={loadingTenants || runningDiagnostics}
              >
                {selectedTenantId
                  ? tenants.find((t) => t.id === selectedTenantId)?.companyName
                  : "Search for a tenant..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0 bg-zinc-950 border-zinc-800">
              <Command className="bg-zinc-950 text-zinc-100">
                <CommandInput placeholder="Search tenants..." className="text-zinc-100" />
                <CommandEmpty>No tenant found.</CommandEmpty>
                <CommandList>
                  <CommandGroup>
                    {tenants.map((t) => (
                      <CommandItem
                        key={t.id}
                        value={t.companyName}
                        onSelect={() => {
                          setSelectedTenantId(t.id);
                          setComboboxOpen(false);
                        }}
                        className="data-[selected=true]:bg-zinc-900 data-[selected=true]:text-white text-zinc-300"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedTenantId === t.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {t.companyName}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          
          <Button onClick={handleRunDiagnostics} disabled={!selectedTenantId || runningDiagnostics} className="px-8">
            {runningDiagnostics ? <Spinner className="mr-2" /> : null}
            Run Full Diagnostics
          </Button>
          <Button 
            variant="secondary"
            onClick={async () => {
              try {
                const res = await api<{ access_token: string }>('/v1/auth/impersonate', {
                  method: 'POST',
                  json: { tenantId: selectedTenantId }
                });
                const currentToken = localStorage.getItem('access_token');
                if (currentToken) {
                  localStorage.setItem('original_access_token', currentToken);
                }
                const tName = tenants.find(t => t.id === selectedTenantId)?.companyName || selectedTenantId;
                sessionStorage.setItem('impersonationBanner', `Impersonating Tenant: ${tName}`);
                sessionStorage.setItem('impersonationReturnUrl', '/super-admin/diagnostics');
                setToken(res.access_token);
                window.location.href = '/admin/command-center';
              } catch (err) {
                console.error(err);
                alert((err as Error).message);
              }
            }} 
            disabled={!selectedTenantId || runningDiagnostics} 
            className="px-8 bg-indigo-900/40 text-indigo-300 hover:bg-indigo-900/60"
          >
            Impersonate Tenant
          </Button>
        </CardContent>
      </Card>

      <div className={`space-y-4 transition-opacity ${selectedTenantId ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        
        {results && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-white mb-4 mt-8">Diagnostic Report</h2>
            {results.map((r, i) => {
              let badgeColor = 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
              if (r.status === 'pass') badgeColor = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
              if (r.status === 'warn') badgeColor = 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
              if (r.status === 'fail') badgeColor = 'bg-red-500/10 text-red-500 border-red-500/20';
              if (r.status === 'info') badgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/20';

              return (
                <div key={i} className={`p-4 rounded-md border bg-zinc-950 border-zinc-800`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Badge className={badgeColor}>
                        {r.status.toUpperCase()}
                      </Badge>
                      <h3 className="font-medium text-white">{r.name}</h3>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-zinc-300">
                    {r.message}
                  </div>
                  {r.details && (
                    <div className="mt-3">
                      <pre className="bg-zinc-900 rounded p-3 text-xs font-mono text-zinc-300 overflow-auto max-h-64 border border-zinc-800">
                        {typeof r.details === 'object' ? JSON.stringify(r.details, null, 2) : r.details}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
