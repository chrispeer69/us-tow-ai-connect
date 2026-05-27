export default function AcceptInviteLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--surface-low)]" />
        <div className="h-8 w-72 animate-pulse rounded bg-[var(--surface-low)]" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-[var(--surface-low)]" />
      </div>
      <div className="h-64 animate-pulse rounded-[16px] bg-[var(--surface-low)]" />
    </div>
  );
}
