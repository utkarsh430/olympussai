import type { Metadata } from 'next';
import Link from 'next/link';
import { getSession } from '@/lib/auth/server';
import { PROJECT_UPSRTC } from '@/lib/auth/config';
import { sanitizeNext } from '@/lib/auth/redirect';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthenticatedActions } from '@/components/auth/AuthenticatedActions';
import { OlympussMark } from '@/components/shared/OlympussMark';

export const metadata: Metadata = {
  title: 'Authorized Project Access',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNext(params.next);
  const session = await getSession();
  const authenticated = Boolean(session && session.project === PROJECT_UPSRTC);

  return (
    <main className="relative flex min-h-[100dvh] flex-col bg-[#050507] text-[#f2eee7] md:flex-row">
      {/* Left — atmospheric brand field (~55%) */}
      <section
        aria-hidden
        className="relative flex min-h-[38vh] items-center justify-center overflow-hidden border-b border-[rgba(255,255,255,0.06)] px-8 py-14 md:min-h-0 md:w-[55%] md:border-b-0 md:border-r md:px-14"
      >
        {/* Golden halo */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[85vmin] w-[85vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(214,161,58,0.16), rgba(17,24,42,0.10) 42%, transparent 68%)',
          }}
        />
        {/* Radial line texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            background:
              'repeating-conic-gradient(from 0deg at 50% 50%, rgba(214,161,58,0.05) 0deg, transparent 2deg 8deg)',
            maskImage: 'radial-gradient(circle at 50% 50%, black 0%, transparent 62%)',
            WebkitMaskImage: 'radial-gradient(circle at 50% 50%, black 0%, transparent 62%)',
          }}
        />
        <div className="relative z-10 flex flex-col items-center text-center">
          <OlympussMark className="h-40 w-40 md:h-52 md:w-52" />
          <p className="mt-8 max-w-xs text-sm leading-relaxed text-[#a3a7b2]">
            A digital laboratory exploring intelligent systems and the ideas shaping the next era of
            technology.
          </p>
        </div>
      </section>

      {/* Right — authentication interface (~45%) */}
      <section className="relative flex flex-1 items-center justify-center px-6 py-14 md:w-[45%] md:px-12">
        <div className="flex w-full max-w-sm flex-col items-start">
          <div className="mb-10">
            <p className="mb-3 font-serif text-2xl font-light tracking-tight">
              <span className="text-[#f2eee7]">OLYMPUSS</span>{' '}
              <span className="text-[#d6a13a]">AI</span>
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#9d7127]">
              Authorized Project Access
            </p>
            <h1 className="mt-6 text-3xl font-light leading-tight text-[#f2eee7]">
              Enter the project workspace.
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#a3a7b2]">
              {authenticated
                ? 'You are authenticated. Continue to the protected environment or sign out.'
                : 'Use your project credentials to continue to the protected environment.'}
            </p>
          </div>

          {authenticated ? <AuthenticatedActions next={next} /> : <LoginForm next={next} />}

          <div className="mt-10 flex w-full max-w-sm items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#707580]">
              Authorized users only.
            </p>
            <Link
              href="/"
              className="text-[12px] text-[#a3a7b2] underline-offset-4 transition-colors hover:text-[#f2eee7] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a]"
            >
              Return to Olympuss AI
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
