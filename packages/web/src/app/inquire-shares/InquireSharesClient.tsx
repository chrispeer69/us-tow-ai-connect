'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Mail,
  Phone,
  Building2,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { submitShareInquiry, type InquiryResult } from './actions';

const inputClass =
  'w-full h-11 rounded-md bg-background border border-border px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500';
const textareaClass =
  'w-full min-h-[110px] rounded-md bg-background border border-border px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelClass =
  'block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2';
const sectionLabelClass =
  'text-[10px] uppercase tracking-[0.25em] text-cyan-400 font-bold mb-4 flex items-center gap-2';

const TIMELINE_OPTIONS = [
  { value: 'one_week', label: 'Within one week' },
  { value: 'one_month', label: 'Within one month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
];

const REVENUE_OPTIONS = [
  'Under $500K',
  '$500K – $1M',
  '$1M – $5M',
  '$5M – $10M',
  '$10M – $25M',
  '$25M+',
  'Prefer not to say',
];

export function InquireSharesClient() {
  const [interest, setInterest] = useState(7);
  const [result, setResult] = useState<InquiryResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await submitShareInquiry(formData);
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
          Inquiry received.
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed mb-8">
          Thanks for reaching out. Chris will personally review your information and
          follow up. In the meantime, complete your free Alliance profile to lock in
          member pricing.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="https://www.ustowalliance.com" target="_blank" rel="noreferrer">
            <Button
              size="lg"
              className="bg-cyan-500 hover:bg-cyan-400 text-blue-950 font-black"
            >
              Complete Alliance Profile
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </a>
          <Link href="/">
            <Button size="lg" variant="outline">
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
      {/* Founder message */}
      <aside className="lg:col-span-5">
        <Badge className="mb-4 bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 px-3 py-1.5 text-[10px] font-bold tracking-[0.2em] uppercase">
          <Sparkles className="w-3 h-3 mr-2" />A Note from the Founder
        </Badge>
        <h1 className="text-3xl lg:text-5xl font-black tracking-tight mb-6 leading-[1.05]">
          Tow owners should own
          <br />
          <span className="text-gradient-cyan">what they use.</span>
        </h1>
        <div className="space-y-4 text-base text-muted-foreground leading-relaxed">
          <p>
            Chris Peer, founder of Blue Collar AI and the US Tow Alliance, believes
            towing owners should{' '}
            <span className="text-foreground font-semibold">
              own part of the solutions they use in their businesses
            </span>
            .
          </p>
          <p>
            That's why we put up{' '}
            <span className="text-foreground font-semibold">33% of every solution</span>{' '}
            as shares — to be purchased by towing business owners across America.
            Together, we will own the tools we use in our businesses.
          </p>
          <p>
            Blue Collar AI is committed to leading the AI revolution in the towing
            industry — standing side by side with you, the owners. Why? Because I am an
            owner. AI provides the tools we need to capture and grow our businesses.
            This is why Blue Collar AI was founded, and why I stand with you.
          </p>
        </div>

        <Card className="bg-amber-500/10 border-amber-500/40 mt-8">
          <CardContent className="p-4 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-bold text-amber-300">
                US Tow AI-Connect shares only.
              </span>{' '}
              <span className="text-muted-foreground">
                This inquiry is for AI-Connect shares — not US Tow Alliance, and not
                other Blue Collar AI solutions. Each ecosystem solution has its own
                share offering. Shareholders may purchase shares in additional
                solutions individually.
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 flex items-center gap-3 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <span>
            Submissions go directly to{' '}
            <a
              href="mailto:chris@bluecollarai.online"
              className="text-cyan-300 hover:underline font-semibold"
            >
              chris@bluecollarai.online
            </a>
          </span>
        </div>
      </aside>

      {/* Form */}
      <div className="lg:col-span-7">
        <Card className="bg-card/80 border-cyan-500/30 backdrop-blur-md">
          <CardContent className="p-7 lg:p-10">
            {/* Section 1: Owner */}
            <div className={sectionLabelClass}>
              <Mail className="w-3.5 h-3.5" />
              Owner contact
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
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
                <label className={labelClass} htmlFor="email">
                  Email <span className="text-cyan-400">*</span>
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className={inputClass}
                  placeholder="you@yourcompany.com"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="cellPhone">
                  Cell phone
                </label>
                <input
                  id="cellPhone"
                  name="cellPhone"
                  type="tel"
                  autoComplete="tel"
                  className={inputClass}
                  placeholder="(555) 555-5555"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="companyPhone">
                  Company phone
                </label>
                <input
                  id="companyPhone"
                  name="companyPhone"
                  type="tel"
                  className={inputClass}
                  placeholder="(555) 555-5555"
                />
              </div>
            </div>

            {/* Section 2: Business */}
            <div className={sectionLabelClass}>
              <Building2 className="w-3.5 h-3.5" />
              Business
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="companyName">
                  Company name <span className="text-cyan-400">*</span>
                </label>
                <input
                  id="companyName"
                  name="companyName"
                  type="text"
                  required
                  className={inputClass}
                  placeholder="Acme Towing & Recovery"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="address">
                  Address
                </label>
                <input
                  id="address"
                  name="address"
                  type="text"
                  autoComplete="street-address"
                  className={inputClass}
                  placeholder="123 Main St, Columbus, OH 43215"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="annualRevenue">
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
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="businessDescription">
                  Describe your business and fleet
                </label>
                <textarea
                  id="businessDescription"
                  name="businessDescription"
                  className={textareaClass}
                  placeholder="Markets served, fleet size & mix, motor club contracts, years in business…"
                />
              </div>
            </div>

            {/* Section 3: Managers */}
            <div className={sectionLabelClass + ' mt-4'}>
              <Phone className="w-3.5 h-3.5" />
              Manager contacts
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="managerNames">
                  Manager names
                </label>
                <input
                  id="managerNames"
                  name="managerNames"
                  type="text"
                  className={inputClass}
                  placeholder="e.g. John Smith, Lead Dispatcher"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="managersEmail">
                  Managers' email
                </label>
                <input
                  id="managersEmail"
                  name="managersEmail"
                  type="email"
                  className={inputClass}
                  placeholder="manager@yourcompany.com"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="managersPhone">
                  Managers' phone
                </label>
                <input
                  id="managersPhone"
                  name="managersPhone"
                  type="tel"
                  className={inputClass}
                  placeholder="(555) 555-5555"
                />
              </div>
            </div>

            {/* Section 4: Investment intent */}
            <div className={sectionLabelClass + ' mt-4'}>
              <Sparkles className="w-3.5 h-3.5" />
              Investment intent
            </div>
            <div className="space-y-6 mb-8">
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <label className="text-sm font-semibold" htmlFor="interestLevel">
                    Level of interest in becoming a vested partner
                  </label>
                  <span className="text-2xl font-black tabular-nums text-cyan-300">
                    {interest}
                    <span className="text-xs text-muted-foreground">/10</span>
                  </span>
                </div>
                <input
                  id="interestLevel"
                  name="interestLevel"
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={interest}
                  onChange={(e) => setInterest(Number(e.target.value))}
                  className="w-full accent-cyan-500"
                />
                <div className="flex justify-between mt-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  <span>Just exploring</span>
                  <span>Ready to invest</span>
                </div>
              </div>

              <div>
                <div className={labelClass}>How soon are you interested?</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TIMELINE_OPTIONS.map((opt, i) => (
                    <label
                      key={opt.value}
                      className="cursor-pointer border border-border bg-background hover:border-cyan-500/50 has-[:checked]:border-cyan-500 has-[:checked]:bg-cyan-500/10 rounded-md px-3 py-3 text-center text-xs font-semibold transition-all"
                    >
                      <input
                        type="radio"
                        name="timeline"
                        value={opt.value}
                        defaultChecked={i === 2}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
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
                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-blue-950 font-black h-14 shadow-xl shadow-cyan-500/40"
              >
                {pending ? 'Sending…' : 'Send Inquiry'}
                {!pending && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
              <Link href="/">
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="border-border w-full sm:w-auto"
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
