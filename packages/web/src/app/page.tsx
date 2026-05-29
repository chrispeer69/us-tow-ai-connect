import Link from "next/link";

export default function Home() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center p-8 text-white"
      style={{ background: "var(--hero-gradient)" }}
    >
      <div className="flex w-full max-w-2xl flex-col items-center gap-4 text-center">
        <span className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-[var(--alliance-amber-light)]">
          Powered by Blue Collar AI
        </span>
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
          US Tow AI-Connect
        </h1>
        <p className="max-w-md text-slate-300">
          Middleware connector bridging Thinkrr.ai with your towing software.
        </p>
        <div className="mt-6 flex gap-4">
          <Link
            href="/admin/integrations"
            className="rounded-[12px] bg-[var(--alliance-blue)] px-6 py-3 font-semibold text-white shadow-[0_4px_16px_rgba(37,99,235,0.35)] transition hover:bg-[var(--alliance-blue-dark)] hover:text-white"
          >
            Go to Admin Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
