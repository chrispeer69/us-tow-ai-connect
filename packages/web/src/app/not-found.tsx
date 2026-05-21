import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center select-none relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-purple-600/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="z-10 max-w-md w-full bg-zinc-900/40 backdrop-blur-md border border-zinc-800/80 p-8 rounded-2xl shadow-xl flex flex-col items-center gap-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">404</h1>
          <h2 className="text-xl font-semibold text-zinc-200">Page Not Found</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            The page you are looking for doesn't exist or has been moved to another URL.
          </p>
        </div>

        <Link
          href="/"
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium py-3 px-6 rounded-xl transition duration-200 shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20 flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Return Home
        </Link>
      </div>
    </div>
  );
}
