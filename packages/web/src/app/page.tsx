import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm flex flex-col gap-4">
        <h1 className="text-4xl font-bold tracking-tight text-blue-500">US Tow AI-Connect</h1>
        <p className="text-zinc-400">Middleware connector bridging Thinkrr.ai with towing software.</p>
        <div className="flex gap-4 mt-8">
          <Link href="/admin/integrations" className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition">
            Go to Admin Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
