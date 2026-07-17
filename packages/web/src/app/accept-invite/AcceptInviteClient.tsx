'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from '@/components/onboarding/onboarding.module.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const REDIRECT_DELAY_MS = 1500;
const REDIRECT_TARGET = '/admin/integrations';

type Phase =
  | { kind: 'missing-token' }
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error-invalid' }
  | { kind: 'error-expired' }
  | { kind: 'error-already' }
  | { kind: 'error-email-mismatch' }
  | { kind: 'error-generic'; message: string };

interface ApiError {
  status?: 'error';
  code?: string;
  message?: string;
}

async function postAcceptInvite(token: string, email: string, name: string, password?: string) {
  const res = await fetch(`${API_BASE}/v1/auth/accept-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(password ? { password } : {}),
    }),
  });
  let body: ApiError = {};
  try {
    body = (await res.json()) as ApiError;
  } catch {
    /* non-JSON response — leave body empty */
  }
  return { status: res.status, body };
}

function phaseFromResponse(status: number, code: string | undefined, fallbackMsg: string): Phase {
  if (status === 200 || status === 201) return { kind: 'success' };
  if (status === 410 || code === 'ALREADY_ACCEPTED') return { kind: 'error-already' };
  if (status === 403 && code === 'TOKEN_EXPIRED') return { kind: 'error-expired' };
  if (status === 403 && code === 'EMAIL_MISMATCH') return { kind: 'error-email-mismatch' };
  if (status === 404 || code === 'INVALID_TOKEN') return { kind: 'error-invalid' };
  if (status === 400) return { kind: 'error-invalid' };
  return { kind: 'error-generic', message: fallbackMsg };
}

export function AcceptInviteClient({ token, email }: { token: string; email: string }) {
  const initial: Phase = token ? { kind: 'idle' } : { kind: 'missing-token' };
  const [phase, setPhase] = useState<Phase>(initial);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const isSubmitting = phase.kind === 'submitting';

  useEffect(() => {
    if (phase.kind !== 'success') return;
    const id = window.setTimeout(() => {
      window.location.assign(REDIRECT_TARGET);
    }, REDIRECT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [phase.kind]);

  const maskedEmail = useMemo(() => (email ? email : 'your invited email'), [email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setNameError('Please enter your full name.');
      return;
    }
    if (trimmed.length > 255) {
      setNameError('Name must be 255 characters or fewer.');
      return;
    }
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    setNameError(null);
    setPasswordError(null);
    setPhase({ kind: 'submitting' });
    try {
      const { status, body } = await postAcceptInvite(token, email, trimmed, password);
      const fallback =
        body.message ?? `We couldn't accept your invitation (status ${status}). Try again.`;
      setPhase(phaseFromResponse(status, body.code, fallback));
    } catch (err) {
      setPhase({
        kind: 'error-generic',
        message:
          (err as Error)?.message ??
          "We couldn't reach the server. Check your connection and try again.",
      });
    }
  }

  function resetToForm() {
    setPhase({ kind: 'idle' });
  }

  if (phase.kind === 'missing-token') {
    return (
      <StateLayout
        eyebrow="Invitation"
        title="This invite link is incomplete"
        subtitle="The link you opened is missing its invitation token. Ask your administrator to resend the email."
      >
        <ErrorCard
          headline="Missing token"
          body="The invite URL must include a token query parameter. If you copied the link manually, try opening the original email instead."
        />
      </StateLayout>
    );
  }

  if (phase.kind === 'success') {
    return <SuccessCard />;
  }

  if (phase.kind === 'error-invalid' || phase.kind === 'error-already') {
    const headline =
      phase.kind === 'error-already' ? 'Invite already used' : 'Invite invalid or expired';
    const body =
      phase.kind === 'error-already'
        ? "This invitation has already been accepted. Continue to the dashboard to sign in."
        : 'This invitation is invalid or has already been used. Please contact your administrator for a new one.';
    return (
      <StateLayout eyebrow="Invitation" title="We couldn't accept this invite">
        <ErrorCard
          headline={headline}
          body={body}
          action={
            <a href={REDIRECT_TARGET}>
              <Button variant="secondary" type="button">
                Continue to dashboard
              </Button>
            </a>
          }
        />
      </StateLayout>
    );
  }

  if (phase.kind === 'error-expired') {
    return (
      <StateLayout eyebrow="Invitation" title="This invitation has expired">
        <ErrorCard
          headline="Expired link"
          body="Invitation links are good for 7 days. Ask an owner on your team to send a fresh invite."
        />
      </StateLayout>
    );
  }

  if (phase.kind === 'error-email-mismatch') {
    return (
      <StateLayout eyebrow="Invitation" title="Wrong email for this invite">
        <ErrorCard
          headline="Email mismatch"
          body="This invitation was sent to a different email address. Open the link from the original invite email."
        />
      </StateLayout>
    );
  }

  if (phase.kind === 'error-generic') {
    return (
      <StateLayout eyebrow="Invitation" title="Something went wrong">
        <ErrorCard
          headline="Couldn't accept your invite"
          body={phase.message}
          action={
            <Button variant="secondary" type="button" onClick={resetToForm}>
              Try again
            </Button>
          }
        />
      </StateLayout>
    );
  }

  // idle | submitting
  return (
    <div className="space-y-8">
      <PageHeader
        variant="hero"
        eyebrow="Invitation"
        title="You've been invited"
        subtitle="Accept your invitation to join your team's US Tow AI-Connect workspace."
      />

      <Card>
        <CardHeader>
          <CardTitle>Confirm your details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className={`space-y-5 ${styles.stepEnter}`} noValidate>
            <Field label="Invitation email">
              <Input
                value={email}
                readOnly
                aria-readonly
                data-testid="accept-invite-email"
                className="cursor-not-allowed bg-[var(--surface-low)]"
                placeholder={maskedEmail}
              />
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                {email
                  ? 'This is the address your invite was sent to.'
                  : 'No email was supplied on the link — your administrator can resend if this looks wrong.'}
              </p>
            </Field>

            <Field label="Full name" htmlError={nameError}>
              <Input
                data-testid="accept-invite-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Driver"
                autoComplete="name"
                autoFocus
                maxLength={255}
                aria-invalid={nameError ? 'true' : 'false'}
              />
            </Field>

            <Field label="Create a password" htmlError={passwordError}>
              <Input
                type="password"
                data-testid="accept-invite-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                aria-invalid={passwordError ? 'true' : 'false'}
              />
            </Field>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              <Button
                variant="secondary"
                type="submit"
                data-testid="accept-invite-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Accepting…' : 'Accept invitation'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  htmlError,
  children,
}: {
  label: string;
  htmlError?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1.5 font-medium text-[var(--text-secondary)]">{label}</div>
      {children}
      {htmlError && (
        <div
          role="alert"
          className="mt-1.5 text-xs font-medium text-[var(--alliance-red)]"
        >
          {htmlError}
        </div>
      )}
    </label>
  );
}

function StateLayout({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <PageHeader variant="hero" eyebrow={eyebrow} title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}

function ErrorCard({
  headline,
  body,
  action,
}: {
  headline: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{headline}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">{body}</p>
        {action}
      </CardContent>
    </Card>
  );
}

function SuccessCard() {
  return (
    <div className={`mx-auto max-w-2xl ${styles.fadeUp}`} data-testid="accept-invite-success">
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
            You&apos;re in!
          </h1>
          <p className="mt-2 max-w-md text-sm text-[var(--text-secondary)]">
            Your invitation has been accepted. Taking you to the dashboard…
          </p>
        </div>
        <CardContent className="pt-6">
          <a href={REDIRECT_TARGET} className="block">
            <Button variant="secondary" className="w-full">
              Continue now
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
