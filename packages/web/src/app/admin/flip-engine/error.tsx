'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function FlipEngineError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-6">
      <Card className="border-rose-700 bg-rose-950/40">
        <CardContent className="space-y-3 p-6 text-rose-100">
          <h2 className="text-lg font-semibold">Flip engine could not load</h2>
          <p className="text-sm text-rose-200">
            {error.message || 'An unexpected error occurred.'}
          </p>
          {error.digest && (
            <p className="text-xs text-rose-300/80">trace: {error.digest}</p>
          )}
          <div>
            <Button variant="outline" onClick={() => reset()}>
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
