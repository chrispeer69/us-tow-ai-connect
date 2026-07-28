'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Guided product tour for the public demo.
 *
 * Hand-rolled rather than library-backed because this page is a fixed h-screen
 * shell: the window never scrolls, targets live in four independent
 * overflow containers, and most steps have to drive page state (section,
 * selected job) before their target exists in the DOM.
 */

export type DemoTourController = {
  setSection: (href: string) => void;
  selectJob: (jobId: string) => void;
  closeOverlays: () => void;
};

type TourStep = {
  id: string;
  /** CSS selector. Omit for a centered, target-less step. */
  target?: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
  /** The "why this isn't a generic AI caller" line. */
  proof?: ReactNode;
  padding?: number;
  prepare?: (controller: DemoTourController) => void;
};

const COMMAND_CENTER_HREF = '/admin/command-center';
const FLIP_ENGINE_HREF = '/admin/flip-engine';
const DIGITAL_DISPATCH_HREF = '/admin/digital-dispatch';
const REPORTS_HREF = '/admin/reports';

const STORAGE_KEY = 'ustow.demo.tour.seen.v1';
const CARD_WIDTH = 380;
const EDGE = 12;
const GAP = 16;

function commandCenter(c: DemoTourController) {
  c.setSection(COMMAND_CENTER_HREF);
}

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    eyebrow: 'Guided tour',
    title: 'This is a dispatch board, not a slideshow.',
    body: (
      <>
        The data is seeded, but the screen, the fields and the decision logic are the ones a live tow
        operator works in every day. Sixteen stops, about three minutes. Arrow keys work.
      </>
    ),
    prepare: (c) => {
      c.closeOverlays();
      c.setSection(COMMAND_CENTER_HREF);
      c.selectJob('demo-job-1');
    },
  },
  {
    id: 'stats',
    target: '[data-tour="stats"]',
    eyebrow: 'The board',
    title: 'One queue for every source.',
    body: (
      <>
        Dispatch-software jobs, motor-club jobs and manually-entered jobs land in the same unified
        queue. Status, driver, ETA and the AI call outcome all sit on one row, so dispatchers stop
        tab-hopping between portals.
      </>
    ),
    proof: 'Changes stream in over a websocket — the board reflects a new job without a refresh.',
    prepare: commandCenter,
  },
  {
    id: 'sources',
    target: '[data-tour="jobs-table"]',
    eyebrow: 'The moat',
    title: 'No API? We sign in as you.',
    body: (
      <>
        Look at the <strong className="font-semibold text-zinc-900">Source</strong> column — Towbook,
        AAA, Manual. Most dispatch software has no usable API, so we run a headless browser that logs
        into your account and reads your board every 60 seconds. Credentials are encrypted at rest and
        the login session is cached for an hour instead of re-authenticating on every pass.
      </>
    ),
    proof:
      'Five platforms are wired — Towbook, AAA Club Alliance, TowLogs, Omadi, Dispatch Anywhere. Two are verified against live accounts today.',
    prepare: commandCenter,
  },
  {
    id: 'ai-call-column',
    target: '[data-tour="jobs-table"]',
    eyebrow: 'The difference',
    title: 'The call fires off a real job — not a lead list.',
    body: (
      <>
        Every row carries an <strong className="font-semibold text-zinc-900">AI call</strong> result.
        That call is triggered the moment the job first appears on your board, so the agent already
        knows the caller, the vehicle, the pickup, the drop-off and the ETA. It never opens with
        &ldquo;can I get your information?&rdquo;
      </>
    ),
    proof:
      'A generic AI caller dials a spreadsheet. This one is wired into the dispatch pipeline it just read.',
    prepare: commandCenter,
  },
  {
    id: 'map',
    target: '[data-tour="map"]',
    eyebrow: 'Geography is the product',
    title: 'Distance decides what the AI is allowed to say.',
    body: (
      <>
        Pickup addresses are geocoded and cached. When the system picks a partner shop to recommend,
        it picks the one nearest the <strong className="font-semibold text-zinc-900">pickup</strong> —
        optimizing your driver&rsquo;s detour, not the customer&rsquo;s convenience. If the closest
        shop is past your configured maximum distance, the pitch is suppressed entirely. Go ahead and
        click a pin — it opens that job in the drawer.
      </>
    ),
    proof:
      'A drop-off pin within about 300 m of one of your own shops is reclassified as your shop, so a sloppy address never costs you a job you already had.',
    prepare: commandCenter,
  },
  {
    id: 'filters',
    target: '[data-tour="filters"]',
    eyebrow: 'Dispatcher control',
    title: 'Filters move the map and the table together.',
    body: (
      <>
        Status chips, integration source, priority and free-text search all narrow one shared queue.
        Dispatchers scope the board down to what they are actually working; the automation keeps
        running against everything. Try a status chip — the map and the table react together.
      </>
    ),
    prepare: commandCenter,
  },
  {
    id: 'flip-job',
    target: '[data-tour="drawer-column"]',
    eyebrow: 'The flip',
    title: 'This tow was headed to a competitor.',
    body: (
      <>
        Taylor Morgan&rsquo;s F-150 was routed to Buckeye Auto Repair — a repair shop that is not
        yours. Every dollar of that repair walks out the door attached to a tow you already paid a
        driver to run.
      </>
    ),
    prepare: (c) => {
      c.setSection(COMMAND_CENTER_HREF);
      c.selectJob('demo-job-2');
    },
  },
  {
    id: 'flip-result',
    target: '[data-tour="drawer-ai-result"]',
    eyebrow: 'The flip',
    title: 'The AI redirected it — and showed its work.',
    body: (
      <>
        On the confirmation call the agent worked a three-offer ladder: a free diagnostic with a
        discount, then a fast look with a written estimate before any work, then a repair credit with
        a held priority slot. It stops the moment one lands. Here the customer accepted, and the
        drop-off became Complete Brake Service.
      </>
    ),
    proof:
      'Thirteen structured fields come back from each call — which offer closed, customer sentiment, corrections made, whether the app link actually went out. Fields you can report on, not a summary paragraph.',
    prepare: (c) => {
      c.setSection(COMMAND_CENTER_HREF);
      c.selectJob('demo-job-2');
    },
  },
  {
    id: 'scripts',
    target: '[data-tour="drawer-customer-call"]',
    eyebrow: 'Not a black box',
    title: 'The sales logic lives in code, not in a prompt.',
    body: (
      <>
        Five scripts a dispatcher can fire by hand: auto flip, ETA confirmation, status update,
        winch-out photo reminder, or app link only. The wording, the offer ladder and the branch rules
        are rendered server-side, which is why the voice vendor is swappable without touching the
        sales logic.
      </>
    ),
    proof:
      'Global rules are prepended to every script: disclose the AI, never invent a price or an address, speak only one callback number, stop on a hard decline, end the call if the customer is hostile or in danger.',
    prepare: (c) => {
      c.setSection(COMMAND_CENTER_HREF);
      c.selectJob('demo-job-2');
    },
  },
  {
    id: 'human',
    target: '[data-tour="drawer-assign"]',
    eyebrow: 'Human in the loop',
    title: 'The sales AI never writes to your dispatch software.',
    body: (
      <>
        It classifies, calls, logs the outcome and texts your managers. Assigning the driver and
        moving the status stays right here, with a person. The one place the platform does click a
        button inside your source portal is Digital Dispatch — and only under rules you wrote.
      </>
    ),
    prepare: (c) => {
      c.setSection(COMMAND_CENTER_HREF);
      c.selectJob('demo-job-2');
    },
  },
  {
    id: 'flip-engine',
    target: '[data-tour="section-panel"]',
    eyebrow: 'Guardrails',
    title: 'Whether to pitch is a rule, not a vibe.',
    body: (
      <>
        A deterministic engine decides, in order: an AAA-branded destination is a hard block with no
        override, ever. Your own shop, nothing to flip. A body shop gets no pitch, only a soft mention,
        because insurance picks body shops. A non-repair destination gets no pitch at all. Everything
        else is eligible.
      </>
    ),
    proof:
      'Every outcome carries a machine reason code, so a no-flip is always explainable. Low-value work — jump start, lockout, tire, fuel — is excluded only when the classifier is at least 85% confident.',
    prepare: (c) => c.setSection(FLIP_ENGINE_HREF),
  },
  {
    id: 'sandbox',
    target: '[data-tour="flip-sandbox"]',
    eyebrow: 'Provable',
    title: 'Dry-run the whole pipeline before it ever dials.',
    body: (
      <>
        The sandbox runs destination classification, the proximity override, the issue classifier, the
        flip decision and the nearest-shop pick against a real job, then returns exactly what it would
        have done — without placing a call or writing a row. That output is what you are looking at.
      </>
    ),
    prepare: (c) => c.setSection(FLIP_ENGINE_HREF),
  },
  {
    id: 'digital-dispatch',
    target: '[data-tour="section-panel"]',
    eyebrow: 'Digital Dispatch',
    title: 'Auto-accept the jobs worth taking. Flag the rest.',
    body: (
      <>
        Nine condition types compose into rules: distance to your closest driver, time of day and day
        of week in your timezone, service type, minimum payout, drivers available, job age, caller
        blacklist, plus raw JSON matching on the source payload. First matching rule wins.
      </>
    ),
    proof:
      'If no rule matches, the default is flag — never a silent accept or decline. Every decision writes an audit row with the full per-condition trace, and after the click we store the confirmation text read back off the portal, so you know whether it actually landed.',
    prepare: (c) => c.setSection(DIGITAL_DISPATCH_HREF),
  },
  {
    id: 'notifications',
    target: '[data-tour="section-panel"]',
    eyebrow: 'You will know either way',
    title: 'Wins and misses both text you.',
    body: (
      <>
        A win texts your managers the customer, the vehicle, the original destination, the shop it was
        redirected to, which offer closed, the call length and the recording link. A no-answer or
        failed call sends an &ldquo;AI call needs attention&rdquo; alert instead — once, on the
        transition, not on every retry.
      </>
    ),
    proof:
      'Plus a batch summary every N calls and a daily report at your local hour, broken out by shop, by which offer closed, and by source.',
    prepare: (c) => c.setSection(REPORTS_HREF),
  },
  {
    id: 'safety',
    target: '[data-tour="header-actions"]',
    eyebrow: 'Safety',
    title: 'Nothing dials by accident.',
    body: (
      <>
        Layered gates sit in front of every outbound call: a tenant master switch, a per-service mode
        of auto / manual-only / off, a database-level duplicate check that survives a restart, and a
        15-minute staleness window so a queued call about an old job is dropped instead of placed.
      </>
    ),
    proof: 'In this public demo every one of them is closed — that is what the amber bar is telling you.',
    prepare: commandCenter,
  },
  {
    id: 'finish',
    eyebrow: 'That is the tour',
    title: 'Two engines, one board.',
    body: (
      <>
        Digital Dispatch decides which jobs are worth taking. The Flip Engine turns the jobs you
        already have into repair revenue. Both run off the same dispatch board we read out of the
        software you are already paying for.
      </>
    ),
    prepare: (c) => {
      c.setSection(COMMAND_CENTER_HREF);
      c.selectJob('demo-job-2');
    },
  },
];

export const DEMO_TOUR_STEP_COUNT = STEPS.length;

function clamp(value: number, lo: number, hi: number) {
  return Math.min(Math.max(value, lo), Math.max(lo, hi));
}

export function DemoTour({
  open,
  onOpenChange,
  controller,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: DemoTourController;
}) {
  const [index, setIndex] = useState(0);
  const targetRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);
  const maskTopRef = useRef<HTMLDivElement | null>(null);
  const maskBottomRef = useRef<HTMLDivElement | null>(null);
  const maskLeftRef = useRef<HTMLDivElement | null>(null);
  const maskRightRef = useRef<HTMLDivElement | null>(null);
  const autoStarted = useRef(false);

  const step = STEPS[Math.min(index, STEPS.length - 1)];
  const isLast = index >= STEPS.length - 1;

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* private mode — the tour just offers itself again next visit */
    }
    onOpenChange(false);
  }, [onOpenChange]);

  const next = useCallback(() => {
    if (index >= STEPS.length - 1) {
      finish();
      return;
    }
    setIndex(index + 1);
  }, [index, finish]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // First visit (or ?tour=1) opens the tour on its own.
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;

    let forced = false;
    try {
      forced = new URLSearchParams(window.location.search).get('tour') === '1';
    } catch {
      forced = false;
    }
    let seen = false;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      seen = false;
    }
    if (!forced && seen) return;

    const timer = window.setTimeout(() => onOpenChange(true), forced ? 250 : 900);
    return () => window.clearTimeout(timer);
  }, [onOpenChange]);

  // Restart from the top every time the tour is opened.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Put the page into the state this step describes, then wait for its target.
  useEffect(() => {
    if (!open) return;
    step.prepare?.(controller);
    targetRef.current = null;
    if (!step.target) return;

    let cancelled = false;
    let attempts = 0;
    let timer = 0;

    const find = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(step.target as string);
      if (el) {
        targetRef.current = el;
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        return;
      }
      if (attempts++ < 40) timer = window.setTimeout(find, 50);
    };
    find();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, step, controller]);

  // Position the spotlight and the card imperatively. A frame loop keeps them
  // pinned through smooth scrolling, internal scroll containers and layout
  // shifts without re-rendering the card on every frame.
  useEffect(() => {
    if (!open) return;
    let frame = 0;

    const place = () => {
      frame = window.requestAnimationFrame(place);
      const card = cardRef.current;
      const spot = spotRef.current;
      if (!card) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const el = targetRef.current;

      let rect: { top: number; left: number; width: number; height: number } | null = null;
      if (el?.isConnected) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const pad = step.padding ?? 8;
          rect = {
            top: r.top - pad,
            left: r.left - pad,
            width: r.width + pad * 2,
            height: r.height + pad * 2,
          };
        }
      }

      if (spot) {
        if (rect) {
          spot.style.opacity = '1';
          spot.style.transform = `translate3d(${Math.round(rect.left)}px, ${Math.round(rect.top)}px, 0)`;
          spot.style.width = `${Math.round(rect.width)}px`;
          spot.style.height = `${Math.round(rect.height)}px`;
        } else {
          spot.style.opacity = '0';
          spot.style.width = '0px';
          spot.style.height = '0px';
        }
      }

      // Four mask bands around the spotlight. The gap they leave keeps the
      // highlighted element clickable while the rest of the page stays inert,
      // so a stray click cannot desync the tour from the state a step set up.
      const hole = rect ?? { top: vh, left: 0, width: 0, height: 0 };
      const holeBottom = hole.top + hole.height;
      const holeRight = hole.left + hole.width;
      const bandTop = Math.max(0, hole.top);
      const bandHeight = Math.min(holeBottom, vh) - bandTop;
      const setBand = (
        node: HTMLDivElement | null,
        left: number,
        top: number,
        width: number,
        height: number,
      ) => {
        if (!node) return;
        node.style.left = `${Math.round(left)}px`;
        node.style.top = `${Math.round(top)}px`;
        node.style.width = `${Math.round(Math.max(0, width))}px`;
        node.style.height = `${Math.round(Math.max(0, height))}px`;
      };
      setBand(maskTopRef.current, 0, 0, vw, hole.top);
      setBand(maskBottomRef.current, 0, holeBottom, vw, vh - holeBottom);
      setBand(maskLeftRef.current, 0, bandTop, hole.left, bandHeight);
      setBand(maskRightRef.current, holeRight, bandTop, vw - holeRight, bandHeight);

      const ch = card.offsetHeight;

      // Narrow viewports: the card becomes a bottom sheet.
      if (vw < 640) {
        card.style.width = `${vw - EDGE * 2}px`;
        card.style.left = `${EDGE}px`;
        card.style.top = `${Math.max(EDGE, vh - ch - EDGE)}px`;
        return;
      }

      card.style.width = `${CARD_WIDTH}px`;
      const cw = card.offsetWidth;

      if (!rect) {
        card.style.left = `${Math.round((vw - cw) / 2)}px`;
        card.style.top = `${Math.round((vh - ch) / 2)}px`;
        return;
      }

      const roomBelow = vh - (rect.top + rect.height) - GAP - EDGE;
      const roomAbove = rect.top - GAP - EDGE;
      const roomLeft = rect.left - GAP - EDGE;
      const roomRight = vw - (rect.left + rect.width) - GAP - EDGE;

      let left: number;
      let top: number;

      if (roomBelow >= ch) {
        top = rect.top + rect.height + GAP;
        left = rect.left + rect.width / 2 - cw / 2;
      } else if (roomAbove >= ch) {
        top = rect.top - GAP - ch;
        left = rect.left + rect.width / 2 - cw / 2;
      } else if (roomLeft >= cw) {
        left = rect.left - GAP - cw;
        top = rect.top + rect.height / 2 - ch / 2;
      } else if (roomRight >= cw) {
        left = rect.left + rect.width + GAP;
        top = rect.top + rect.height / 2 - ch / 2;
      } else {
        // Target fills the viewport (a whole panel). Sit at the bottom, centered.
        left = (vw - cw) / 2;
        top = vh - ch - EDGE;
      }

      card.style.left = `${Math.round(clamp(left, EDGE, vw - cw - EDGE))}px`;
      card.style.top = `${Math.round(clamp(top, EDGE, vh - ch - EDGE))}px`;
    };

    frame = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(frame);
  }, [open, step]);

  // Keyboard controls.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, finish]);

  // Move focus to the card so screen readers and the keyboard follow along.
  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus({ preventScroll: true });
  }, [open, index]);

  if (!open) return null;

  const progress = ((index + 1) / STEPS.length) * 100;

  return (
    <div className="pointer-events-none fixed inset-0 z-[90]" aria-live="polite">
      {/* Everything except the spotlit element is inert. Positioned in the
          frame loop below. */}
      <div ref={maskTopRef} aria-hidden="true" className="pointer-events-auto absolute" />
      <div ref={maskBottomRef} aria-hidden="true" className="pointer-events-auto absolute" />
      <div ref={maskLeftRef} aria-hidden="true" className="pointer-events-auto absolute" />
      <div ref={maskRightRef} aria-hidden="true" className="pointer-events-auto absolute" />

      <div
        ref={spotRef}
        aria-hidden="true"
        className="absolute left-0 top-0 rounded-xl opacity-0 shadow-[0_0_0_9999px_rgba(9,9,11,0.66)] outline outline-2 outline-offset-2 outline-blue-500 transition-opacity duration-200"
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-tour-title"
        tabIndex={-1}
        className={cn(
          'pointer-events-auto absolute flex max-h-[calc(100vh-24px)] flex-col overflow-y-auto',
          'rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl ring-1 ring-zinc-950/5 focus:outline-none',
        )}
        style={{ width: CARD_WIDTH }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="font-label text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">
            {step.eyebrow}
          </span>
          <button
            type="button"
            onClick={finish}
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            aria-label="End tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2
          id="demo-tour-title"
          className="mt-1 font-display text-lg font-extrabold leading-snug text-zinc-900"
        >
          {step.title}
        </h2>

        <p className="mt-2 text-sm leading-6 text-zinc-600">{step.body}</p>

        {step.proof && (
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
            <div className="font-label text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">
              Why that is different
            </div>
            <p className="mt-1 text-xs leading-5 text-blue-900">{step.proof}</p>
          </div>
        )}

        {isLast && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/schedule-demo" className="shrink-0">
              <Button className="shrink-0">Book a live demo</Button>
            </Link>
            <Button variant="outline" className="shrink-0" onClick={finish}>
              Keep exploring
            </Button>
          </div>
        )}

        <div className="mt-4 border-t border-zinc-100 pt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="font-label text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              {index + 1} / {STEPS.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={finish}
                className="text-zinc-500"
              >
                {isLast ? 'Close' : 'Skip'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={back}
                disabled={index === 0}
                aria-label="Previous step"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              {!isLast && (
                <Button type="button" size="sm" onClick={next} className="gap-1">
                  Next
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
