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
- Do not ask "is now a good time?" The customer already requested service; keep the call brief and useful.
- Only pitch a repair-shop flip when the call is repairable and the destination is not already our shop or a protected destination.
- Do not pitch repair-shop offers for lockout, fuel delivery, single flat tire, jump-start-only, or winch-out-only calls.
- Make flip offers as one objection-handling flow, not three unrelated pitches. STOP the moment one is accepted.
- If the customer gives a hard decline such as "no offers", "just send the tow", "I'm not changing", or "I already know where it is going", stop pitching immediately and keep the original destination.
- ALWAYS send-frame the free CONVINIcar app near the close, unless the customer hung up, opted out, or asked you to stop.
- Never invent prices, times, names, or addresses — use only what's provided here.
- The ONLY phone number you may give the customer is {{callback_number}}.
- When you offer the app, say "I'm texting you the link now" — do not ask permission, do not read the link aloud, and do not ask whether it came through.
- Never mention Google reviews, review incentives, or gift cards during the call.
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
AI: "Anything else before you go?"
AI: "Drive safe."`;

  const defaultOffer1 = `Before I confirm the drop-off — just so you know, {{nearest_shop}}, a certified shop just {{nearest_shop_distance}} miles away, can provide a free diagnostic, normally around \${{diagnostic_value}}, plus 10 percent off today's repair. I'd handle the drop-off with the driver if you choose that option. Would you like me to switch the drop-off to {{nearest_shop}}?`;
  const defaultOffer2 = `Totally fair. Here's the difference though — for today's tow, {{nearest_shop}} can look at your car quickly, give you a written estimate before any work, and you still get the free diagnostic plus 10 percent off today's repair. If you want that, I can update the drop-off with the driver. Would you like me to make that change?`;
  const defaultOffer3 = `I can also add a 50 dollar credit on this repair on top of the discount and hold the priority slot at {{nearest_shop}}. Would you like me to switch the drop-off there?`;
  const defaultConvini = `You're all set, {{customer_first_name}}. Your driver is headed to {{destination}} as planned. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;

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

  const latestScriptBlocks = () => ({
    opening: defaultOpening,
    purpose: defaultPurpose,
    confirm_pickup: defaultPickup,
    confirm_vehicle: defaultVehicle,
    clarify_issue: defaultIssue,
    confirm_destination: defaultDestination,
    warm_close: defaultClose,
    offer_1: defaultOffer1,
    offer_2: defaultOffer2,
    offer_3: defaultOffer3,
    convini_pitch: defaultConvini,
  });

  const buildConfigPayload = (scriptBlocks = {
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
  }) => ({
    rep_name: repName,
    company_name: companyName,
    callback_number: callbackNumber,
    mention_rentals: mentionRentals,
    custom_agent_rules: customAgentRules,
    max_shop_distance_miles: maxDistanceMiles,
    script_blocks: scriptBlocks,
  });

  const saveConfig = async (config: Record<string, unknown>) => {
    await api('/v1/admin/flip-engine/global-config', {
      method: 'PATCH',
      body: JSON.stringify({ config }),
      headers: { 'content-type': 'application/json' },
    });
    await loadConfig();
  };

  const save = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await saveConfig(buildConfigPayload());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const pushLatestDefaults = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const scriptBlocks = latestScriptBlocks();
      setCustomAgentRules(DEFAULT_AGENT_RULES);
      setOpeningBlock(scriptBlocks.opening);
      setPurposeBlock(scriptBlocks.purpose);
      setPickupBlock(scriptBlocks.confirm_pickup);
      setVehicleBlock(scriptBlocks.confirm_vehicle);
      setIssueBlock(scriptBlocks.clarify_issue);
      setDestinationBlock(scriptBlocks.confirm_destination);
      setCloseBlock(scriptBlocks.warm_close);
      setOffer1(scriptBlocks.offer_1);
      setOffer2(scriptBlocks.offer_2);
      setOffer3(scriptBlocks.offer_3);
      setConviniPitch(scriptBlocks.convini_pitch);
      await saveConfig({
        ...buildConfigPayload(scriptBlocks),
        custom_agent_rules: DEFAULT_AGENT_RULES,
      });
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
            <Button variant="outline" onClick={() => void pushLatestDefaults()} disabled={submitting}>
              {submitting ? <Spinner className="mr-2" /> : null}
              Push Latest Defaults
            </Button>
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
