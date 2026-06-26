'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/utils';

type Policy = 'AI_HANDLES' | 'TRANSFER' | 'NOT_OFFERED';
type OutboundCallMode = 'AUTO' | 'MANUAL_ONLY' | 'OFF';
type Service = {
  enabled: boolean;
  classes: Record<string, Policy>;
};

const SERVICES = [
  'Towing',
  'Jump Start',
  'Tire Change',
  'Fuel Delivery',
  'Lockout Service',
  'Winch Out & Recovery',
];

const SERVICE_HELP: Record<string, string> = {
  Towing: 'Standard tow confirmations and repair-shop flip opportunities.',
  'Jump Start': 'Battery or no-start support calls when enabled.',
  'Tire Change': 'Flat tire and spare or tire-change support calls.',
  'Fuel Delivery': 'Out-of-fuel support calls.',
  'Lockout Service': 'Locked-out customer support calls.',
  'Winch Out & Recovery': 'Recovery calls with photo-readiness guidance.',
};

interface AgentConfig {
  greetingMessage: string;
  defaultEtaMins: number;
  impoundEnabled: boolean;
  outboundCallMode?: OutboundCallMode;
  testModeEnabled?: boolean;
  testOverrideNumber?: string | null;
  serviceToggles: Record<string, Service>;
}

export default function AiAgentPage() {
  // Preserve legacy API fields while the UI focuses on active outbound controls.
  const [greeting, setGreeting] = useState('');
  const [defaultEta, setDefaultEta] = useState(45);
  const [impoundEnabled, setImpoundEnabled] = useState(false);
  const [outboundCallMode, setOutboundCallMode] = useState<OutboundCallMode>('AUTO');
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [testOverrideNumber, setTestOverrideNumber] = useState('');
  const [serviceToggles, setServiceToggles] = useState<Record<string, Service>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchConfig();
  }, []);

  async function fetchConfig() {
    setLoading(true);
    try {
      const data = await api<AgentConfig>('/v1/admin/agent-config');
      setGreeting(data.greetingMessage ?? '');
      setDefaultEta(data.defaultEtaMins ?? 45);
      setImpoundEnabled(Boolean(data.impoundEnabled));
      setOutboundCallMode(data.outboundCallMode ?? 'AUTO');
      setTestModeEnabled(data.testModeEnabled === true);
      setTestOverrideNumber(data.testOverrideNumber ?? '');
      setServiceToggles(normalizeToggles(data.serviceToggles ?? {}));
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
      await api('/v1/admin/agent-config', {
        method: 'PUT',
        json: {
          greetingMessage: greeting,
          defaultEtaMins: defaultEta,
          impoundEnabled,
          outboundCallMode,
          testModeEnabled,
          testOverrideNumber: testOverrideNumber.trim() || null,
          serviceToggles,
        },
      });
      setHasChanges(false);
      setSavedMessage('Saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <header>
          <h1 className="text-3xl font-bold">AI Agent Configuration</h1>
          <p className="text-zinc-400 mt-1">
            Control outbound AI calls and which service types the AI can handle.
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

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Spinner /> Loading config...
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Outbound AI Calls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={outboundCallMode}
                onValueChange={(v) => mutate(setOutboundCallMode, v as OutboundCallMode)}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Auto</SelectItem>
                  <SelectItem value="MANUAL_ONLY">Manual only</SelectItem>
                  <SelectItem value="OFF">Off</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-zinc-400">
                Auto allows eligible jobs to be called automatically. Manual only disables automatic
                calls but keeps the Command Center call button available. Off disables outbound AI
                calls for this account.
              </p>

              <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">Test mode</div>
                    <p className="mt-1 text-sm text-zinc-400">
                      Route this tenant's outbound AI calls to a test phone before calling real customers.
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      If this is on without a number, calls fail closed. US 10-digit numbers are saved with +1 automatically.
                    </p>
                  </div>
                  <Switch
                    checked={testModeEnabled}
                    onCheckedChange={(v) => mutate(setTestModeEnabled, v)}
                  />
                </div>

                <div className="mt-3 max-w-sm">
                  <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                    Test phone number
                  </div>
                  <Input
                    value={testOverrideNumber}
                    onChange={(event) => mutate(setTestOverrideNumber, event.target.value)}
                    placeholder="Enter test phone"
                  />
                </div>

                <div className={`mt-3 rounded border p-3 text-sm ${
                  testModeEnabled
                    ? testOverrideNumber.trim()
                      ? 'border-amber-800 bg-amber-950/30 text-amber-100'
                      : 'border-rose-800 bg-rose-950/30 text-rose-100'
                    : 'border-zinc-800 bg-zinc-900/40 text-zinc-300'
                }`}>
                  {testModeEnabled
                    ? testOverrideNumber.trim()
                      ? 'Test mode is ON. Calls will route to this tenant test number.'
                      : 'Test mode is ON but no number is set. Calls will be blocked.'
                    : 'Test mode is OFF. Calls route normally unless the global emergency override is enabled.'}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Services AI Handles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-zinc-400">
                Turn service types on or off for AI customer calls. Manual calls also respect these
                switches.
              </p>
              {SERVICES.map((service) => {
                const cfg = serviceToggles[service] ?? defaultService();
                return (
                  <div
                    key={service}
                    className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{service}</div>
                        <p className="text-xs text-zinc-500 mt-1">{SERVICE_HELP[service]}</p>
                      </div>
                      <Switch
                        checked={cfg.enabled}
                        onCheckedChange={(v) =>
                          mutate(setServiceToggles, {
                            ...serviceToggles,
                            [service]: { ...cfg, enabled: v },
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function defaultService(): Service {
  return {
    enabled: true,
    classes: {
      'Light Duty': 'AI_HANDLES',
      'Medium Duty': 'AI_HANDLES',
      'Heavy Duty': 'AI_HANDLES',
      Motorcycle: 'AI_HANDLES',
    },
  };
}

function normalizeToggles(
  raw: Record<string, Service | Record<string, unknown> | undefined>,
): Record<string, Service> {
  const out: Record<string, Service> = {};
  for (const svc of SERVICES) {
    const candidate = (raw[svc] ?? {}) as Partial<Service> & { classes?: Record<string, string> };
    out[svc] = {
      enabled: candidate.enabled !== false,
      classes: (candidate.classes as Record<string, Policy>) ?? defaultService().classes,
    };
  }
  return out;
}
