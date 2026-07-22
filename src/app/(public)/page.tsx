import Link from 'next/link';

/**
 * Placeholder Olympuss landing page.
 *
 * Route migration only — this establishes `/` as a public, scrollable,
 * dashboard-free route that loads none of the UPSRTC code or data. The full
 * cinematic WebGL experience (Sections 17–39) replaces this in a later phase.
 */
export default function LandingPage() {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#050507] px-6 text-center text-[#f2eee7]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(214,161,58,0.16), rgba(17,24,42,0.10) 45%, transparent 70%)',
        }}
      />
      <div className="relative z-10 max-w-[620px]">
        <p className="mb-6 text-[12px] uppercase tracking-[0.24em] text-[#9d7127]">
          Artificial Intelligence · Intelligent Systems · Innovation
        </p>
        <h1 className="text-4xl font-light leading-tight sm:text-6xl">
          <span className="text-[#f2eee7]">OLYMPUSS</span>{' '}
          <span className="text-[#d6a13a]">AI</span>
        </h1>
        <p className="mx-auto mt-6 max-w-[620px] text-base leading-relaxed text-[#a3a7b2]">
          A digital laboratory exploring artificial intelligence, adaptive systems, and the ideas
          shaping the next era of technology.
        </p>
        <div className="mt-10 flex items-center justify-center">
          <Link
            href="/login"
            className="rounded border border-[#d6a13a]/50 px-6 py-3 text-sm uppercase tracking-[0.18em] text-[#f3c86a] transition-colors hover:border-[#d6a13a] hover:bg-[#d6a13a]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a]"
          >
            Project Login
          </Link>
        </div>
      </div>
    </main>
  );
}
