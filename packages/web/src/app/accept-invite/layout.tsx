import React from 'react';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';

export default function AcceptInviteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OnboardingShell>{children}</OnboardingShell>;
}
