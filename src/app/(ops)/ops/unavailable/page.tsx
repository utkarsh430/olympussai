import type { Metadata } from 'next';
import Link from 'next/link';
import { sanitizeNextOrNull } from '@/lib/auth/redirect';

export const metadata: Metadata = {
  title: 'Operations Console Unavailable',
  robots: { index: false, follow: false },
};

/**
 * Shown when the ops profile database — the authority every ops page AND
 * every `/project/*` page now checks against — could not be read at all.
 *
 * A SEPARATE DESTINATION FROM THE SIGN-IN PAGE, ON PURPOSE. Before this,
 * every refusal from `resolveOpsSession()` looked the same by the time it
 * reached an operator, so a transient ops-database failure presented as
 * "you are signed out". On an operations console that is the wrong failure
 * mode twice over: it blames the person on shift for a service problem, and
 * it sends them to re-enter credentials into a flow that reads the very
 * authority that is down, so the attempt cannot succeed and the real cause is
 * never surfaced to anyone. This page says what actually happened and what to
 * do about it.
 *
 * Deliberately reads NOTHING. No session, no profile, no database: it is the
 * page shown precisely when those reads are failing, so any read here would
 * turn the outage explanation into a second outage.
 *
 * Not role-gated: `roleForSegment('unavailable')` is null, so middleware
 * treats it as a public ops page (src/middleware.ts) and no layout guard
 * stands in front of it. That is required — a guarded outage page is
 * unreachable exactly when it is needed.
 *
 * IT SERVES BOTH SURFACES, which is why the retry target is sanitized with
 * the whole-app allowlist rather than the ops-only one. The project surface
 * is gated on the same `ops_users` row (src/lib/auth/projectPageGuard.ts), so
 * one outage takes both down and there is one honest thing to say about it.
 * Sanitizing with the ops-only rule here would have silently dropped the
 * retry link for exactly the half of the product that was added last.
 */
export default async function OpsUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  // Sanitized, never echoed raw: this page is reachable by anyone, so an
  // attacker-supplied `next` must not become a link off this origin.
  const retryTo = sanitizeNextOrNull(params.next);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#6f7684]">Olympuss AI</p>
      <h1 className="text-2xl font-semibold text-[#e6e9ef]">
        Temporarily unavailable
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-[#9aa0ad]">
        Your account is fine — this service could not reach the operations directory it checks
        every screen against, so it cannot confirm what you are permitted to see. Nothing has been
        changed and nothing is lost.
      </p>
      <p className="max-w-md text-[12px] leading-relaxed text-[#6f7684]">
        Retry in a moment. If it persists, report it as a service outage rather than a sign-in
        problem — signing in again will not help while this is happening.
      </p>
      {retryTo && (
        <Link
          href={retryTo}
          className="bg-[#4f8cff]/12 mt-2 rounded-md border border-[#4f8cff]/60 px-5 py-2.5 font-mono text-[13px] uppercase tracking-[0.2em] text-[#8fb4ff] hover:bg-[#4f8cff]/20"
        >
          Try again
        </Link>
      )}
    </main>
  );
}
