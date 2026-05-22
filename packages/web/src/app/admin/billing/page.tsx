'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/utils';

type Plan = 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';

interface PlanDetails {
  label: string;
  monthlyPriceCents: number;
  includedCalls: number;
  overageCentsPerCall: number;
  features: string[];
}

interface Billing {
  plan: Plan;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  planDetails: PlanDetails;
  usage: {
    calls: number;
    minutes: number;
    seconds: number;
  };
}

const PLAN_ORDER: Plan[] = ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'];

const PLAN_PREVIEW: Record<Plan, PlanDetails> = {
  TRIAL: {
    label: 'Trial',
    monthlyPriceCents: 0,
    includedCalls: 200,
    overageCentsPerCall: 0,
    features: ['200 AI-handled calls / month', 'Single integration', 'Email support'],
  },
  STARTER: {
    label: 'Starter',
    monthlyPriceCents: 19900,
    includedCalls: 1000,
    overageCentsPerCall: 25,
    features: [
      '1,000 AI-handled calls / month',
      'Up to 3 integrations',
      'Standard routing rules',
      'Email support',
    ],
  },
  PRO: {
    label: 'Pro',
    monthlyPriceCents: 49900,
    includedCalls: 5000,
    overageCentsPerCall: 18,
    features: [
      '5,000 AI-handled calls / month',
      'Unlimited integrations',
      'Advanced routing & flip logic',
      'Priority support',
    ],
  },
  ENTERPRISE: {
    label: 'Enterprise',
    monthlyPriceCents: 0,
    includedCalls: 0,
    overageCentsPerCall: 0,
    features: [
      'Custom call volume',
      'Dedicated success engineer',
      'SLA & SSO',
      'Custom contract',
    ],
  },
};

function formatPrice(cents: number, plan: Plan): string {
  if (plan === 'ENTERPRISE') return 'Custom';
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(0)}/mo`;
}

export default function BillingPage() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchBilling();
  }, []);

  async function fetchBilling() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Billing>('/v1/admin/billing');
      setBilling(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function selectPlan(plan: Plan) {
    if (!billing || plan === billing.plan) return;
    setChanging(plan);
    setError(null);
    try {
      const updated = await api<Billing>('/v1/admin/billing/plan', {
        method: 'PUT',
        json: { plan },
      });
      setBilling(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChanging(null);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-zinc-400 mt-1">
          Manage your plan and review usage for the current billing period.
        </p>
      </header>

      {error && <p className="text-sm text-red-400 break-words">{error}</p>}

      {loading || !billing ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Spinner /> Loading billing...
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Current Plan</span>
                <Badge variant={billing.status === 'ACTIVE' ? 'success' : 'destructive'}>
                  ● {billing.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-semibold text-zinc-100">
                  {billing.planDetails.label}
                </span>
                <span className="text-zinc-400">
                  {formatPrice(billing.planDetails.monthlyPriceCents, billing.plan)}
                </span>
              </div>
              <div className="text-sm text-zinc-400">
                Period:{' '}
                {new Date(billing.currentPeriodStart).toLocaleDateString()} –{' '}
                {new Date(billing.currentPeriodEnd).toLocaleDateString()}
              </div>
              {billing.cancelAtPeriodEnd && (
                <p className="text-sm text-amber-400">
                  Subscription will cancel at the end of the current period.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage This Period</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <UsageStat
                  label="Calls"
                  value={billing.usage.calls.toLocaleString()}
                  hint={
                    billing.planDetails.includedCalls > 0
                      ? `of ${billing.planDetails.includedCalls.toLocaleString()} included`
                      : 'Unlimited'
                  }
                />
                <UsageStat
                  label="Minutes"
                  value={billing.usage.minutes.toLocaleString()}
                />
                <UsageStat
                  label="Average Call Length"
                  value={
                    billing.usage.calls > 0
                      ? `${Math.round(billing.usage.seconds / billing.usage.calls)}s`
                      : '—'
                  }
                />
              </div>
              {billing.planDetails.includedCalls > 0 && (
                <UsageBar
                  current={billing.usage.calls}
                  cap={billing.planDetails.includedCalls}
                />
              )}
            </CardContent>
          </Card>

          <div>
            <h2 className="text-xl font-semibold mb-3">Plans</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {PLAN_ORDER.map((plan) => {
                const details = PLAN_PREVIEW[plan];
                const isCurrent = plan === billing.plan;
                return (
                  <Card
                    key={plan}
                    className={
                      isCurrent ? 'border-emerald-500/40 bg-emerald-500/5' : ''
                    }
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>{details.label}</span>
                        {isCurrent && (
                          <Badge variant="success">Current</Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="text-lg font-semibold">
                        {formatPrice(details.monthlyPriceCents, plan)}
                      </div>
                      <ul className="text-sm text-zinc-300 space-y-1 list-disc pl-4">
                        {details.features.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                      <Button
                        className="w-full"
                        variant={isCurrent ? 'outline' : 'default'}
                        disabled={isCurrent || changing !== null}
                        onClick={() => selectPlan(plan)}
                      >
                        {changing === plan ? (
                          <Spinner className="mr-2" />
                        ) : null}
                        {isCurrent
                          ? 'Selected'
                          : plan === 'ENTERPRISE'
                          ? 'Contact Sales'
                          : 'Switch Plan'}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Payment Method</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {billing.stripeCustomerId ? (
                <p className="text-sm text-zinc-300 font-mono">
                  Stripe customer: {billing.stripeCustomerId}
                </p>
              ) : (
                <p className="text-sm text-zinc-400">
                  No payment method on file. Switching to a paid plan will
                  prompt for billing details.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function UsageStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold text-zinc-100 mt-1">{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

function UsageBar({ current, cap }: { current: number; cap: number }) {
  const pct = Math.min(100, Math.round((current / cap) * 100));
  const danger = pct >= 90;
  return (
    <div className="mt-4">
      <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full ${danger ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-zinc-500 mt-1">{pct}% of included calls</div>
    </div>
  );
}
