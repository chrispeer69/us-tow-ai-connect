'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type StepNumber = 1 | 2 | 3 | 4;

interface Step1 {
  companyName: string;
  brandNames: string[];
  serviceAreaDescription: string;
  timezone: string;
}
interface Step2 {
  adminEmail: string;
  adminPhone: string;
  billingEmail: string;
}
interface Step3 {
  towbookUsername: string;
  towbookPassword: string;
  aaaUsername: string;
  aaaPassword: string;
  testedAt?: string;
}
interface Step4 {
  greetingMessage: string;
  voicePreference: 'Polly.Joanna' | 'Polly.Matthew' | 'Polly.Amy' | 'Polly.Brian';
  transferNumber: string;
  defaultEtaMins: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: { message?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* noop */
    }
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function OnboardingClient() {
  const [step, setStep] = useState<StepNumber>(1);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<null | {
    tenantId: string;
    apiKey: string;
    knowledgePackUrl: string;
    adminUrl: string;
  }>(null);

  const [step1, setStep1] = useState<Step1>({
    companyName: '',
    brandNames: [''],
    serviceAreaDescription: '',
    timezone: detectTimezone(),
  });
  const [step2, setStep2] = useState<Step2>({
    adminEmail: '',
    adminPhone: '',
    billingEmail: '',
  });
  const [step3, setStep3] = useState<Step3>({
    towbookUsername: '',
    towbookPassword: '',
    aaaUsername: '',
    aaaPassword: '',
  });
  const [step4, setStep4] = useState<Step4>({
    greetingMessage: 'Thank you for calling. How can I help you today?',
    voicePreference: 'Polly.Joanna',
    transferNumber: '',
    defaultEtaMins: 45,
  });
  const [captchaToken, setCaptchaToken] = useState('');

  const greetingPreview = useMemo(() => {
    return step4.greetingMessage.replace(/\{company\}/g, step1.companyName || 'Your Company');
  }, [step4.greetingMessage, step1.companyName]);

  async function ensureDraft(): Promise<string> {
    if (draftId) return draftId;
    const out = await api<{
      draftId: string;
      captchaRequired: boolean;
    }>(`/v1/onboarding/start`, {
      method: 'POST',
      body: JSON.stringify({
        email: step2.adminEmail || `onboarding+${Date.now()}@pending.invalid`,
        companyName: step1.companyName || undefined,
      }),
    });
    setDraftId(out.draftId);
    setCaptchaRequired(out.captchaRequired);
    return out.draftId;
  }

  async function postStep(s: StepNumber, values: unknown) {
    const id = await ensureDraft();
    await api(`/v1/onboarding/step`, {
      method: 'POST',
      body: JSON.stringify({ draftId: id, step: s, values }),
    });
  }

  async function handleNext() {
    setError(null);
    setSubmitting(true);
    try {
      if (step === 1) {
        const values = {
          ...step1,
          brandNames: step1.brandNames.map((s) => s.trim()).filter(Boolean),
        };
        await postStep(1, values);
        setStep(2);
      } else if (step === 2) {
        await postStep(2, step2);
        setStep(3);
      } else if (step === 3) {
        await postStep(3, step3);
        setStep(4);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete() {
    setError(null);
    setSubmitting(true);
    try {
      await postStep(4, step4);
      const id = draftId!;
      const out = await api<{
        tenantId: string;
        apiKey: string;
        knowledgePackUrl: string;
        adminUrl: string;
      }>(`/v1/onboarding/complete`, {
        method: 'POST',
        body: JSON.stringify({ draftId: id, captchaToken: captchaToken || undefined }),
      });
      setResult(out);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestCreds(kind: 'TOWBOOK' | 'AAA_PORTAL') {
    setError(null);
    setSubmitting(true);
    try {
      const id = await ensureDraft();
      const isTowbook = kind === 'TOWBOOK';
      const username = isTowbook ? step3.towbookUsername : step3.aaaUsername;
      const password = isTowbook ? step3.towbookPassword : step3.aaaPassword;
      if (!username || !password) {
        throw new Error('Enter both username and password before testing.');
      }
      const out = await api<{ success: boolean; message: string; latencyMs: number }>(
        `/v1/onboarding/test-credentials`,
        {
          method: 'POST',
          body: JSON.stringify({ draftId: id, softwareType: kind, username, password }),
        },
      );
      if (!out.success) throw new Error(out.message);
      setStep3((s) => ({ ...s, testedAt: new Date().toISOString() }));
      setError(`✓ ${kind} credentials valid (${out.latencyMs} ms)`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (step === 2 && !draftId && step1.companyName) {
      void ensureDraft();
    }
  }, [step, draftId, step1.companyName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (result) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Card>
          <CardHeader>
            <CardTitle>Welcome aboard, {step1.companyName}!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>Your AI dispatcher is provisioned. Save these credentials — the API key is only shown once.</p>
            <pre
              data-testid="onboarding-result"
              className="overflow-x-auto rounded-md bg-zinc-950 p-4 text-xs"
            >{`tenantId:        ${result.tenantId}
apiKey:          ${result.apiKey}
knowledgePack:   ${result.knowledgePackUrl}
adminDashboard:  ${result.adminUrl}`}</pre>
            <div className="flex gap-2">
              <a href={result.adminUrl}>
                <Button>Open admin dashboard</Button>
              </a>
              <a href={result.knowledgePackUrl} target="_blank" rel="noreferrer">
                <Button variant="outline">View Knowledge Pack</Button>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-zinc-100">Create your AI dispatcher</h1>
        <p className="text-sm text-zinc-400">A 4-step setup — under 5 minutes.</p>
      </div>
      <StepIndicator current={step} />
      {error && (
        <div
          className={`rounded-md border p-3 text-sm ${
            error.startsWith('✓')
              ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300'
              : 'border-red-800 bg-red-950/50 text-red-200'
          }`}
        >
          {error}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            Step {step} of 4 —{' '}
            {step === 1
              ? 'Company info'
              : step === 2
                ? 'Contact info'
                : step === 3
                  ? 'Integrations'
                  : 'AI agent config'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === 1 && (
            <div className="space-y-4">
              <Field label="Company name">
                <Input
                  data-testid="company-name"
                  value={step1.companyName}
                  onChange={(e) => setStep1({ ...step1, companyName: e.target.value })}
                  placeholder="Roadside Towing"
                />
              </Field>
              <Field label="Brand names operating under this company">
                {step1.brandNames.map((name, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <Input
                      value={name}
                      onChange={(e) => {
                        const next = [...step1.brandNames];
                        next[idx] = e.target.value;
                        setStep1({ ...step1, brandNames: next });
                      }}
                      placeholder={idx === 0 ? 'Roadside Towing' : 'Optional sister brand'}
                    />
                    {idx === step1.brandNames.length - 1 && (
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() =>
                          setStep1({ ...step1, brandNames: [...step1.brandNames, ''] })
                        }
                      >
                        +
                      </Button>
                    )}
                  </div>
                ))}
              </Field>
              <Field label="Service area description">
                <Textarea
                  value={step1.serviceAreaDescription}
                  onChange={(e) =>
                    setStep1({ ...step1, serviceAreaDescription: e.target.value })
                  }
                  placeholder="e.g., Franklin, Delaware, Licking counties in Central Ohio"
                  rows={3}
                />
              </Field>
              <Field label="Timezone (autodetected — edit if needed)">
                <Input
                  value={step1.timezone}
                  onChange={(e) => setStep1({ ...step1, timezone: e.target.value })}
                  placeholder="America/New_York"
                />
              </Field>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <Field label="Primary admin email">
                <Input
                  type="email"
                  data-testid="admin-email"
                  value={step2.adminEmail}
                  onChange={(e) => setStep2({ ...step2, adminEmail: e.target.value })}
                  placeholder="owner@yourtowing.com"
                />
              </Field>
              <Field label="Admin phone (E.164)">
                <Input
                  value={step2.adminPhone}
                  onChange={(e) => setStep2({ ...step2, adminPhone: e.target.value })}
                  placeholder="+16145551234"
                />
              </Field>
              <Field label="Billing email">
                <Input
                  type="email"
                  value={step2.billingEmail}
                  onChange={(e) => setStep2({ ...step2, billingEmail: e.target.value })}
                  placeholder="billing@yourtowing.com"
                />
              </Field>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-6">
              <p className="text-xs text-zinc-400">
                Optional. Skip if you don&apos;t use either yet — you can add credentials later from
                the admin dashboard.
              </p>
              <div className="space-y-3 rounded-md border border-zinc-800 p-4">
                <div className="text-sm font-medium text-zinc-200">Towbook</div>
                <Input
                  value={step3.towbookUsername}
                  onChange={(e) => setStep3({ ...step3, towbookUsername: e.target.value })}
                  placeholder="Towbook username"
                />
                <Input
                  type="password"
                  value={step3.towbookPassword}
                  onChange={(e) => setStep3({ ...step3, towbookPassword: e.target.value })}
                  placeholder="Towbook password"
                />
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => handleTestCreds('TOWBOOK')}
                  disabled={submitting}
                >
                  Test Towbook credentials
                </Button>
              </div>
              <div className="space-y-3 rounded-md border border-zinc-800 p-4">
                <div className="text-sm font-medium text-zinc-200">AAA Salesforce portal</div>
                <Input
                  value={step3.aaaUsername}
                  onChange={(e) => setStep3({ ...step3, aaaUsername: e.target.value })}
                  placeholder="AAA portal username"
                />
                <Input
                  type="password"
                  value={step3.aaaPassword}
                  onChange={(e) => setStep3({ ...step3, aaaPassword: e.target.value })}
                  placeholder="AAA portal password"
                />
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => handleTestCreds('AAA_PORTAL')}
                  disabled={submitting}
                >
                  Test AAA credentials
                </Button>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4">
              <Field label="Greeting message">
                <Textarea
                  data-testid="greeting"
                  value={step4.greetingMessage}
                  onChange={(e) =>
                    setStep4({ ...step4, greetingMessage: e.target.value })
                  }
                  rows={3}
                />
                <div className="mt-2 rounded-md bg-zinc-950 p-3 text-xs text-zinc-300">
                  Preview: <span className="text-zinc-100">&quot;{greetingPreview}&quot;</span>
                </div>
              </Field>
              <Field label="Voice preference">
                <select
                  data-testid="voice"
                  value={step4.voicePreference}
                  onChange={(e) =>
                    setStep4({ ...step4, voicePreference: e.target.value as Step4['voicePreference'] })
                  }
                  className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                >
                  <option value="Polly.Joanna">Joanna (US female)</option>
                  <option value="Polly.Matthew">Matthew (US male)</option>
                  <option value="Polly.Amy">Amy (UK female)</option>
                  <option value="Polly.Brian">Brian (UK male)</option>
                </select>
              </Field>
              <Field label="Transfer-to-human phone (E.164)">
                <Input
                  data-testid="transfer-number"
                  value={step4.transferNumber}
                  onChange={(e) => setStep4({ ...step4, transferNumber: e.target.value })}
                  placeholder="+16148326197"
                />
              </Field>
              <Field label="Default ETA minutes">
                <Input
                  type="number"
                  min={5}
                  max={600}
                  value={step4.defaultEtaMins}
                  onChange={(e) => setStep4({ ...step4, defaultEtaMins: Number(e.target.value) })}
                />
              </Field>
              {captchaRequired && (
                <Field label="Captcha token (paste from widget)">
                  <Input
                    value={captchaToken}
                    onChange={(e) => setCaptchaToken(e.target.value)}
                    placeholder="cf-turnstile token..."
                  />
                </Field>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-between">
        <Button
          variant="ghost"
          type="button"
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as StepNumber) : s))}
          disabled={submitting || step === 1}
        >
          Back
        </Button>
        {step < 4 ? (
          <Button
            type="button"
            data-testid="next-step"
            onClick={handleNext}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Continue'}
          </Button>
        ) : (
          <Button
            type="button"
            data-testid="complete-onboarding"
            onClick={handleComplete}
            disabled={submitting}
          >
            {submitting ? 'Creating account…' : 'Create my AI dispatcher'}
          </Button>
        )}
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

function StepIndicator({ current }: { current: StepNumber }) {
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4].map((n) => (
        <div
          key={n}
          className={`h-2 flex-1 rounded ${
            n <= current ? 'bg-[var(--brand-primary,#3b82f6)]' : 'bg-zinc-800'
          }`}
          data-testid={`step-indicator-${n}`}
          data-active={n <= current}
        />
      ))}
    </div>
  );
}
