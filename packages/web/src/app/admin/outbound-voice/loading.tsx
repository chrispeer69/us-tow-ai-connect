import { Spinner } from '@/components/ui/spinner';

export default function OutboundVoiceLoading() {
  return (
    <div className="flex h-full items-center justify-center p-12 text-zinc-400">
      <Spinner />
      <span className="ml-3">Loading outbound voice…</span>
    </div>
  );
}
