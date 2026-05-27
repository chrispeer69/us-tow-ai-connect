'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AcceptInviteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('accept-invite page error', error);
  }, [error]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Something went wrong</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          We hit an unexpected error loading your invitation. The link may have expired, or there
          may be a temporary issue. Please try again in a moment.
        </p>
        <Button variant="secondary" type="button" onClick={reset}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
