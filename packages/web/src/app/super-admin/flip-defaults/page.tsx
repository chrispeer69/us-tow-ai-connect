'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

interface GlobalConfig {
  rep_name?: string;
  company_name?: string;
  callback_number?: string;
  convini_link?: string;
  mention_rentals?: boolean;
  custom_agent_rules?: string;
  max_shop_distance_miles?: number;
  script_blocks?: Record<string, string>;
}

export default function GlobalFlipDefaultsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [repName, setRepName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [callbackNumber, setCallbackNumber] = useState('');
  const [mentionRentals, setMentionRentals] = useState(false);
  const [customAgentRules, setCustomAgentRules] = useState('');
  const [maxDistanceMiles, setMaxDistanceMiles] = useState(100);

  const [openingBlock, setOpeningBlock] = useState('');
  const [purposeBlock, setPurposeBlock] = useState('');
  const [pickupBlock, setPickupBlock] = useState('');
  const [vehicleBlock, setVehicleBlock] = useState('');
  const [issueBlock, setIssueBlock] = useState('');
  const [destinationBlock, setDestinationBlock] = useState('');
  const [closeBlock, setCloseBlock] = useState('');

  const [offer1, setOffer1] = useState('');
  const [offer2, setOffer2] = useState('');
  const [offer3, setOffer3] = useState('');
  const [conviniPitch, setConviniPitch] = useState('');

  const DEFAULT_AGENT_RULES = `- Be a warm, reassuring dispatcher. One question at a time. Never sound like a telemarketer.
- Confirm details first. If the customer corrects something, acknowledge it and move on.
- Make any flip offers strictly in order (1 -> 2 -> 3) and STOP the moment one is accepted. Never pressure.
- ALWAYS end by offering the free CONVINIcar app, unless the customer hung up or asked you to stop.
- Never invent prices, times, names, or addresses — use only what's provided here.
- The ONLY phone number you may give the customer is {{callback_number}}.
- When you offer the app, say "I'll text you the link" — do not read the link aloud.
- If the customer is hostile, in danger, or asks you to stop: end the call politely and immediately.`;

  const defaultOpening = `[STEP 1 — OPENING / IDENTIFICATION]
AI: "Hi, this is {{rep_name}} calling from {{company_name}} about the tow request. I'm the AI assistant helping confirm the details. Am I speaking with {{customer_first_name}}?"
[AGENT: Wait for confirmation.]`;

  const defaultPurpose = `[STEP 2 — PURPOSE OF CALL]
AI: "Thanks. I'll keep this quick and start with your pickup details."
[AGENT: Do not ask whether now is a good time. Proceed directly into pickup confirmation unless the customer interrupts.]`;

  const defaultPickup = `[STEP 3 — CONFIRM PICKUP LOCATION]
AI: "I have your pickup location as {{pickup_location}}. Is that correct?"`;

  const defaultVehicle = `[STEP 4 — CONFIRM VEHICLE DETAILS]
AI: "And I have a {{vehicle}}. Is that right?"`;

  const defaultIssue = `[STEP 5 — CLARIFY THE ISSUE]
AI: "I see the issue is listed as {{issue}}. Can you tell me a little more about what happened?"`;

  const defaultDestination = `[STEP 6 — CONFIRM DELIVERY DESTINATION]
AI: "I have the destination as {{destination}}. Is that still correct, and is it a repair shop, body shop, your home, or somewhere else?"
[AGENT: Confirm the destination and capture what kind of place it is. Use that answer with the issue type to decide whether a repair-shop or body-shop offer is appropriate.]`;

  const defaultClose = `=== WARM CLOSE (all scenarios) ===
AI: "Your driver is on the way and should be there shortly. Is there anything else I can help you with?"
AI: "You're welcome, {{customer_first_name}}. Have a great day and drive safe."`;

  const defaultOffer1 = `I appreciate that, {{customer_first_name}}. I want to let you know — as a thank-you for using our service, we have a certified repair facility just {{nearest_shop_distance}} miles away called {{nearest_shop}}. If you'd like, we can redirect your tow there at no extra charge, and you'd receive a completely free diagnostic and 10 percent off your repair. Would you like me to make that switch?`;
  const defaultOffer2 = `I completely understand loyalty to a good mechanic. Just so you know — our shop offers same-day priority service for tow customers. Your car would be looked at within one hour of arrival, and you'd have a written estimate before any work begins. No appointment needed. Would that change your mind?`;
  const defaultOffer3 = `No problem at all. Last thing I'll mention — we're running a program right now where tow customers who use our shop receive a 50 dollar credit toward their next service. Plus, if you leave a Google review after your visit, that earns you an additional 25 dollar gift card. I just wanted to make sure you had that option. Would you like me to switch it over?`;
  const defaultConvini = `Absolutely, {{customer_first_name}}. Your driver is headed to {{destination}} as planned. One quick thing before I let you go — we have a free app called CONVINIcar that gives you roadside assistance, repair scheduling, car rentals, and exclusive member deals all in one place. Can I text you the download link? It's completely free and takes about 30 seconds to set up.`;

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api<{ data: GlobalConfig }>('/v1/admin/flip-engine/global-config');
      
      setRepName(data.rep_name || '');
      setCompanyName(data.company_name || '');
      setCallbackNumber(data.callback_number || '');
      setMentionRentals(data.mention_rentals !== false);
      setCustomAgentRules(data.custom_agent_rules || DEFAULT_AGENT_RULES);
      setMaxDistanceMiles(data.max_shop_distance_miles ?? 100);

      const blocks = data.script_blocks || {};
      setOpeningBlock(blocks.opening ?? defaultOpening);
      setPurposeBlock(blocks.purpose ?? defaultPurpose);
      setPickupBlock(blocks.confirm_pickup ?? defaultPickup);
      setVehicleBlock(blocks.confirm_vehicle ?? defaultVehicle);
      setIssueBlock(blocks.clarify_issue ?? defaultIssue);
      setDestinationBlock(blocks.confirm_destination ?? defaultDestination);
      setCloseBlock(blocks.warm_close ?? defaultClose);
      setOffer1(blocks.offer_1 ?? defaultOffer1);
      setOffer2(blocks.offer_2 ?? defaultOffer2);
      setOffer3(blocks.offer_3 ?? defaultOffer3);
      setConviniPitch(blocks.convini_pitch ?? defaultConvini);
      
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const save = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api('/v1/admin/flip-engine/global-config', {
        method: 'PATCH',
        body: JSON.stringify({
          config: {
            rep_name: repName,
            company_name: companyName,
            callback_number: callbackNumber,
            mention_rentals: mentionRentals,
            custom_agent_rules: customAgentRules,
            max_shop_distance_miles: maxDistanceMiles,
            script_blocks: {
              opening: openingBlock,
              purpose: purposeBlock,
              confirm_pickup: pickupBlock,
              confirm_vehicle: vehicleBlock,
              clarify_issue: issueBlock,
              confirm_destination: destinationBlock,
              warm_close: closeBlock,
              offer_1: offer1,
              offer_2: offer2,
              offer_3: offer3,
              convini_pitch: conviniPitch,
            },
          },
        }),
        headers: { 'content-type': 'application/json' },
      });
      await loadConfig();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Global Flip Defaults</h1>
          <p className="text-sm text-zinc-400">
            These are the platform-wide fallback prompts. If a tenant doesn't define their own prompt, the AI will use what is defined here.
          </p>
        </div>
        <Link href="/super-admin">
          <Button variant="outline" className="border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Platform Monitor
          </Button>
        </Link>
      </header>

      {error && (
        <div className="rounded border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold">Default Rep Name</label>
              <Input
                placeholder="e.g. Dispatch"
                value={repName}
                onChange={(e) => setRepName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Default Company Name</label>
              <Input
                placeholder="e.g. Roadside Towing"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Default Callback Number</label>
              <Input
                placeholder="e.g. 555-0199"
                value={callbackNumber}
                onChange={(e) => setCallbackNumber(e.target.value)}
              />
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={mentionRentals}
                  onChange={(e) => setMentionRentals(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm font-semibold">Mention rental pickups (if shop supports)</span>
              </label>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Default Max Distance (miles)</label>
              <Input
                type="number"
                min="1"
                placeholder="e.g. 100"
                value={maxDistanceMiles}
                onChange={(e) => setMaxDistanceMiles(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Global Agent Guardrails</label>
            <p className="mb-2 text-xs text-zinc-400">
              System instructions passed to the LLM on every flip call.
            </p>
            <textarea
              className="h-40 w-full rounded border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              value={customAgentRules}
              onChange={(e) => setCustomAgentRules(e.target.value)}
            />
          </div>

          <hr className="border-zinc-800" />
          <h3 className="text-lg font-semibold">Default Call Flow Scripts</h3>
          <p className="text-sm text-zinc-400">
            Edit the exact text spoken by the AI at each step. Use curly braces for variables like{' '}
            <code>{'{customer_first_name}'}</code>. Agent instructions can be written in brackets like{' '}
            <code>[AGENT: ...]</code>.
          </p>

          <div className="grid gap-6">
            <BlockField label="1. Opening" value={openingBlock} onChange={setOpeningBlock} />
            <BlockField label="2. Purpose" value={purposeBlock} onChange={setPurposeBlock} />
            <BlockField label="3. Confirm Pickup" value={pickupBlock} onChange={setPickupBlock} />
            <BlockField label="4. Confirm Vehicle" value={vehicleBlock} onChange={setVehicleBlock} />
            <BlockField label="5. Clarify Issue" value={issueBlock} onChange={setIssueBlock} />
            <BlockField label="6. Confirm Destination" value={destinationBlock} onChange={setDestinationBlock} />
            
            <BlockField label="Flip Offer 1 (Free Diagnostic / Discount)" value={offer1} onChange={setOffer1} />
            <BlockField label="Flip Offer 2 (Same-day Priority)" value={offer2} onChange={setOffer2} />
            <BlockField label="Flip Offer 3 ($50 Service Credit)" value={offer3} onChange={setOffer3} />
            
            <BlockField label="CONVINIcar Pitch" value={conviniPitch} onChange={setConviniPitch} />
            <BlockField label="Warm Close" value={closeBlock} onChange={setCloseBlock} />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button onClick={() => void save()} disabled={submitting}>
              {submitting ? <Spinner className="mr-2" /> : null}
              Save Global Defaults
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BlockField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold">{label}</label>
      <textarea
        className="h-24 w-full rounded border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
