'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/ui/PageHeader';
import { StepProgress } from '@/components/onboarding/StepProgress';
import styles from '@/components/onboarding/onboarding.module.css';

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
  voicePreference: 'Polly.Joanna' | 'Polly.Joanna' | 'Polly.Amy' | 'Polly.Brian';
  transferNumber: string;
  defaultEtaMins: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const STEP_META: Record<StepNumber, { eyebrow: string; title: string; subtitle: string }> = {
  1: {
    eyebrow: 'Step 1 of 4',
    title: 'Company info',
    subtitle: 'Tell us who you are so your AI dispatcher answers in your name.',
  },
  2: {
    eyebrow: 'Step 2 of 4',
    title: 'Contact info',
    subtitle: 'Where we reach you for account, billing, and escalation matters.',
  },
  3: {
    eyebrow: 'Step 3 of 4',
    title: 'Integrations',
    subtitle: 'Optional — connect your dispatch software for live ETA lookups.',
  },
  4: {
    eyebrow: 'Step 4 of 4',
    title: 'AI agent config',
    subtitle: 'Shape how your AI greets callers and routes the tough ones.',
  },
};

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
  const { setToken } = useAuth();
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
        access_token?: string;
      }>(`/v1/onboarding/complete`, {
        method: 'POST',
        body: JSON.stringify({ draftId: id, captchaToken: captchaToken || undefined }),
      });
      if (out.access_token) {
        setToken(out.access_token);
      }
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
    return <SuccessState companyName={step1.companyName} result={result} />;
  }

  const meta = STEP_META[step];
  const isSuccessBanner = error?.startsWith('✓') ?? false;

  return (
    <div className="space-y-8">
      {step === 1 ? (
        <PageHeader
          variant="hero"
          eyebrow="Welcome"
          title="Welcome to US Tow AI-Connect"
          subtitle="Stand up your always-on AI dispatcher in four short steps — under five minutes."
        />
      ) : (
        <PageHeader eyebrow={meta.eyebrow} title={meta.title} subtitle={meta.subtitle} />
      )}

      <StepProgress current={step} />

      {error && (
        <div
          role="status"
          className={`rounded-[12px] border p-3 text-sm ${
            isSuccessBanner
              ? 'border-[var(--alliance-green)] bg-[#ecfdf5] text-[#065f46]'
              : 'border-[var(--alliance-red)] bg-[#fef2f2] text-[#991b1b]'
          }`}
        >
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {step === 1 ? meta.title : `${meta.eyebrow} — ${meta.title}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div key={step} className={styles.stepEnter}>
            {step === 1 && (
              <div className="space-y-5">
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
                    <div key={idx} className="mb-2 flex gap-2">
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
                          size="icon"
                          type="button"
                          aria-label="Add another brand name"
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
              <div className="space-y-5">
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
              <div className="space-y-5">
                <p className="text-sm text-[var(--text-muted)]">
                  Optional. Skip if you don&apos;t use either yet — you can add credentials later
                  from the admin dashboard.
                </p>
                <div className="space-y-3 rounded-[12px] border border-[var(--border-color)] bg-[var(--surface-low)] p-4">
                  <div className="font-display text-sm font-bold text-[var(--text-main)]">
                    Towbook
                  </div>
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
                <div className="space-y-3 rounded-[12px] border border-[var(--border-color)] bg-[var(--surface-low)] p-4">
                  <div className="font-display text-sm font-bold text-[var(--text-main)]">
                    AAA Salesforce portal
                  </div>
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
              <div className="space-y-5">
                <Field label="Greeting message">
                  <Textarea
                    data-testid="greeting"
                    value={step4.greetingMessage}
                    onChange={(e) => setStep4({ ...step4, greetingMessage: e.target.value })}
                    rows={3}
                  />
                  <div className="mt-2 rounded-[12px] border border-[var(--border-color)] bg-[var(--surface-low)] p-3 text-xs text-[var(--text-secondary)]">
                    Preview:{' '}
                    <span className="text-[var(--text-main)]">&quot;{greetingPreview}&quot;</span>
                  </div>
                </Field>
                <Field label="Voice preference">
                  <Select
                    value={step4.voicePreference}
                    onValueChange={(v) =>
                      setStep4({ ...step4, voicePreference: v as Step4['voicePreference'] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a voice" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Polly.Joanna">Joanna (US female)</SelectItem>
                      <SelectItem value="Polly.Amy">Amy (UK female)</SelectItem>
                      <SelectItem value="Polly.Brian">Brian (UK male)</SelectItem>
                    </SelectContent>
                  </Select>
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
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
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
            variant="secondary"
            type="button"
            data-testid="next-step"
            onClick={handleNext}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Continue'}
          </Button>
        ) : (
          <Button
            variant="secondary"
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

function SuccessState({
  companyName,
  result,
}: {
  companyName: string;
  result: { tenantId: string; apiKey: string; knowledgePackUrl: string; adminUrl: string };
}) {
  return (
    <div className={`mx-auto max-w-2xl ${styles.fadeUp}`}>
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center px-6 pt-10 text-center">
          <span
            className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-[var(--shadow-lg)] ${styles.checkPop}`}
            style={{ background: 'var(--alliance-green)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10" aria-hidden>
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h1 className="mt-6 font-display text-2xl font-extrabold text-[var(--text-main)] sm:text-3xl">
            You&apos;re all set{companyName ? `, ${companyName}` : ''}!
          </h1>
          <p className="mt-2 max-w-md text-sm text-[var(--text-secondary)]">
            Your AI dispatcher is provisioned. Save these credentials now — the API key is shown
            only once.
          </p>
        </div>
        <CardContent className="space-y-5 pt-6">
          <pre
            data-testid="onboarding-result"
            className="overflow-x-auto rounded-[12px] border border-[var(--border-color)] bg-[var(--surface-low)] p-4 text-xs leading-relaxed text-[var(--text-main)]"
          >{`tenantId:        ${result.tenantId}
apiKey:          ${result.apiKey}
knowledgePack:   ${result.knowledgePackUrl}
adminDashboard:  ${result.adminUrl}`}</pre>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={result.adminUrl} className="sm:flex-1">
              <Button variant="secondary" className="w-full">
                Open admin dashboard
              </Button>
            </a>
            <a
              href={result.knowledgePackUrl}
              target="_blank"
              rel="noreferrer"
              className="sm:flex-1"
            >
              <Button variant="outline" className="w-full">
                View Knowledge Pack
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1.5 font-medium text-[var(--text-secondary)]">{label}</div>
      {children}
    </label>
  );
}
