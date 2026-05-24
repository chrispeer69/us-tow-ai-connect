'use client';

import type { ReactNode } from 'react';
import type { TrackBranding } from './types';
import { STATUS_META, type TrackStatus } from './status';

/** Brand-colored status banner shown atop the live states. */
export function StatusBand({ status, eta }: { status: TrackStatus; eta?: number | null }) {
  return (
    <section
      className="rounded-2xl p-5 text-white shadow-sm"
      style={{ backgroundColor: 'var(--brand-primary)' }}
      aria-label="Current status"
    >
      <p className="text-[11px] font-semibold uppercase tracking-widest opacity-80">Status</p>
      <p className="mt-1 text-2xl font-bold">{STATUS_META[status].label}</p>
      {eta != null && (
        <p className="mt-2 text-sm opacity-90">
          {status === 'en_route' ? 'Arriving in about ' : 'ETA '}
          <span className="font-semibold">{eta} min</span>
        </p>
      )}
    </section>
  );
}

/** queued — animated "Finding your driver" placeholder. */
export function QueuedState({ greeting }: { greeting: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="flex items-end gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-3 w-3 animate-bounce rounded-full"
            style={{ backgroundColor: 'var(--brand-primary)', animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{greeting}</h1>
        <p className="mt-2 text-slate-500">
          We&apos;re finding the closest available driver for you. This page updates
          automatically.
        </p>
      </div>
    </div>
  );
}

/** on_scene — full-screen "arrived" state. */
export function OnSceneState({ driverName }: { driverName: string | null }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center text-white"
      style={{ backgroundColor: 'var(--brand-primary)' }}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-3xl">
        ✓
      </div>
      <div>
        <h1 className="text-3xl font-bold">Your driver has arrived</h1>
        <p className="mt-2 text-white/90">
          {driverName ? `${driverName} is on scene.` : 'Your driver is on scene.'} Look for the tow
          truck nearby.
        </p>
      </div>
    </div>
  );
}

/** complete — thank-you screen with optional rating handle. */
export function CompleteState({
  branding,
  ratingUrl,
}: {
  branding: TrackBranding;
  ratingUrl?: string | null;
}) {
  const rateHref =
    ratingUrl ||
    (branding.supportEmail
      ? `mailto:${branding.supportEmail}?subject=${encodeURIComponent('Feedback on my tow')}`
      : null);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full text-3xl text-white"
        style={{ backgroundColor: 'var(--brand-primary)' }}
      >
        ★
      </div>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Thanks for choosing {branding.companyDisplayName}</h1>
        <p className="mt-2 text-slate-500">Your service is complete. We hope you&apos;re back on the road safely.</p>
      </div>
      {rateHref && (
        <a
          href={rateHref}
          className="rounded-xl px-6 py-3 text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--brand-primary)' }}
        >
          Rate your experience
        </a>
      )}
    </div>
  );
}

/** cancelled — service cancelled + optional reason. */
export function CancelledState({ reason }: { reason?: string | null }) {
  return (
    <CenteredNotice
      title="Service cancelled"
      body={reason || 'This tow request was cancelled. If you still need help, please call for assistance.'}
    />
  );
}

/** expired — link no longer active. */
export function ExpiredState() {
  return (
    <CenteredNotice
      title="Link expired"
      body="This tracking page is no longer active. If you still need help, please call for assistance."
    />
  );
}

/** 404 / invalid token — friendly. */
export function NotFoundState() {
  return (
    <CenteredNotice
      title="Link expired or invalid"
      body="We couldn't find this tracking page. The link may have expired or been mistyped."
    />
  );
}

/** transient fetch failure on first load. */
export function FetchErrorState() {
  return (
    <CenteredNotice
      title="Can't load tracking right now"
      body="We're having trouble reaching the server. This page will keep trying automatically."
    />
  );
}

function CenteredNotice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="max-w-xs text-slate-500">{body}</p>
      {children}
    </div>
  );
}
