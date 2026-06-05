'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CalendarClock,
  Building2,
  MapPin,
  Phone,
  Mail,
  DollarSign,
  Truck,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { submitDemoRequest, type ScheduleDemoResult } from './actions';

const inputClass =
  'w-full h-11 rounded-md bg-background border border-border px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelClass =
  'block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2';

const REVENUE_OPTIONS = [
  'Under $500K',
  '$500K – $1M',
  '$1M – $5M',
  '$5M – $10M',
  '$10M – $25M',
  '$25M+',
  'Prefer not to say',
];

const FLEET_OPTIONS = [
  '1–3 trucks',
  '4–10 trucks',
  '11–25 trucks',
  '26–50 trucks',
  '50+ trucks',
];

export function ScheduleDemoClient() {
  const [result, setResult] = useState<ScheduleDemoResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await submitDemoRequest(formData);
      setResult(r);
      if (r.ok && typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  if (result?.ok) {
    return (
      <div className="max-w-2xl mx-auto py-24 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center mb-6">
          <Check className="w-8 h-8 text-cyan-400" strokeWidth={3} />
        </div>
        <h1 className="text-3xl lg:text-4xl font-black tracking-tight mb-3">
          Demo request received.
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed mb-8">
          Chris will follow up directly to schedule your walkthrough. Typical response
          time is one business day.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-white font-bold">
              Back to home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      action={onSubmit}
      className="grid lg:grid-cols-12 gap-10 max-w-7xl mx-auto"
    >
      {/* Intro */}
      <aside className="lg:col-span-5">
        <Badge className="mb-4 bg-blue-500/15 text-blue-300 border border-blue-500/40 px-3 py-1.5 text-[10px] font-bold tracking-[0.2em] uppercase">
          <CalendarClock className="w-3 h-3 mr-2" />
          Schedule a Demo
        </Badge>
        <h1 className="text-3xl lg:text-5xl font-black tracking-tight mb-6 leading-[1.05]">
          See AI-Connect
          <br />
          <span className="text-gradient-blue">in your dispatch.</span>
        </h1>
        <div className="space-y-4 text-base text-muted-foreground leading-relaxed">
          <p>
            Tell us a little about your business and we'll set up a live walkthrough.
            We'll show you the inbound AI dispatcher, the outbound sales engine, and
            the preferred-shop referral flow — using your real dispatch board if you
            want.
          </p>
          <p>
            Submission goes directly to Chris Peer at{' '}
            <a
              href="tel:+16146337935"
              className="text-cyan-300 hover:underline font-semibold"
            >
              614-633-7935
            </a>
            . He typically responds within one business day.
          </p>
        </div>

        <div className="mt-8 flex items-center gap-3 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <span>No spam. We use your info only to schedule the demo.</span>
        </div>
      </aside>

      {/* Form */}
      <div className="lg:col-span-7">
        <Card className="bg-card/80 border-blue-500/30 backdrop-blur-md">
          <CardContent className="p-7 lg:p-10">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div>
                <label className={labelClass} htmlFor="name">
                  Name <span className="text-cyan-400">*</span>
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  autoComplete="name"
                  className={inputClass}
                  placeholder="Jane Owner"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="businessName">
                  Business name <span className="text-cyan-400">*</span>
                </label>
                <input
                  id="businessName"
                  name="businessName"
                  type="text"
                  required
                  autoComplete="organization"
                  className={inputClass}
                  placeholder="Acme Towing & Recovery"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="city">
                  <MapPin className="inline w-3 h-3 mr-1 -mt-0.5" />
                  City
                </label>
                <input
                  id="city"
                  name="city"
                  type="text"
                  autoComplete="address-level2"
                  className={inputClass}
                  placeholder="Columbus"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="state">
                  State
                </label>
                <input
                  id="state"
                  name="state"
                  type="text"
                  autoComplete="address-level1"
                  className={inputClass}
                  placeholder="OH"
                  maxLength={2}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="phone">
                  <Phone className="inline w-3 h-3 mr-1 -mt-0.5" />
                  Phone <span className="text-cyan-400">*</span>
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  className={inputClass}
                  placeholder="(555) 555-5555"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="email">
                  <Mail className="inline w-3 h-3 mr-1 -mt-0.5" />
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  className={inputClass}
                  placeholder="you@yourcompany.com"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="annualRevenue">
                  <DollarSign className="inline w-3 h-3 mr-1 -mt-0.5" />
                  Annual revenue
                </label>
                <select
                  id="annualRevenue"
                  name="annualRevenue"
                  defaultValue=""
                  className={inputClass}
                >
                  <option value="" disabled>
                    Select a range
                  </option>
                  {REVENUE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="fleetSize">
                  <Truck className="inline w-3 h-3 mr-1 -mt-0.5" />
                  Fleet size
                </label>
                <select
                  id="fleetSize"
                  name="fleetSize"
                  defaultValue=""
                  className={inputClass}
                >
                  <option value="" disabled>
                    Select fleet size
                  </option>
                  {FLEET_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {result && !result.ok && (
              <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {result.error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <Button
                type="submit"
                size="lg"
                disabled={pending}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold h-14 shadow-xl shadow-blue-500/40"
              >
                {pending ? 'Sending…' : 'Send Demo Request'}
                {!pending && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
              <Link href="/">
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="bg-transparent border-border text-foreground hover:bg-card w-full sm:w-auto"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
