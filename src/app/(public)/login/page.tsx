import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSupabaseUser } from '@/lib/supabase/server';
import { sanitizeNextOrNull } from '@/lib/auth/redirect';
import { isAuthDisabled, PREVIEW_DEFAULT_ROLE } from '@/lib/auth/publicPreview';
import {
  NO_OPS_ACCESS_NOTICE,
  OPS_ACCESS_PENDING_NOTICE,
  opsHomePath,
  resolveLanding,
} from '@/lib/auth/landing';
import { currentOpsAccess } from '@/lib/auth/opsAccess';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthenticatedActions } from '@/components/auth/AuthenticatedActions';
import { NoOpsAccessNotice } from '@/components/auth/NoOpsAccessNotice';
import { OpsAccessPendingNotice } from '@/components/auth/OpsAccessPendingNotice';
import { OlympussWordmark } from '@/components/shared/OlympussWordmark';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export const metadata: Metadata = {
  title: 'Authorized Project Access',
  robots: { index: false, follow: false },
};

/**
 * The single front door, for the project surface and the ops console alike.
 *
 * THIS PAGE NEVER CALLS `redirect()`, and that is a safety property rather
 * than an oversight — see the long note in src/lib/auth/landing.ts. Every
 * path that bounces someone to sign in eventually arrives here, so if this
 * page also bounced, the two would chase each other forever. It renders, and
 * every outcome below is a terminal state with a visible way out. Post-
 * sign-in navigation happens in the form, once, after credentials are
 * accepted.
 *
 * THE ONE EXCEPTION IS PUBLIC PREVIEW, and it does not weaken that property.
 * The loop the rule prevents is built out of things that BOUNCE BACK here —
 * the edge gate, the page guards, the API guards. With `isAuthDisabled()`
 * none of them refuses anything (src/lib/auth/publicPreview.ts), so there is
 * nothing left to chase: the forward below is one hop into a destination that
 * renders. It is also the only honest answer, since a sign-in form on a
 * deployment with no sign-in is a control that cannot do anything.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; notice?: string }>;
}) {
  const params = await searchParams;

  // PUBLIC PREVIEW: skip the form entirely. Ahead of `getSupabaseUser()` on
  // purpose — a preview deployment need not have Supabase configured, and
  // this page is reachable from the landing header, so it must not be the one
  // surface that 500s.
  if (isAuthDisabled()) {
    redirect(sanitizeNextOrNull(params.next) ?? opsHomePath(PREVIEW_DEFAULT_ROLE));
  }

  // `sanitizeNextOrNull`, NOT `sanitizeNext`, and the difference is the whole
  // of role-correct landing.
  //
  // `sanitizeNext` collapses "asked for nothing" into `/project/upsrtc`. Handed
  // to the form, that default became an explicit request on every ordinary
  // sign-in, and `resolveLanding` honours an explicit request - so all seven
  // ops roles were routed to the project surface and none of them ever reached
  // their own dashboard. The role-correct branch only runs when nothing was
  // asked for, so "nothing" has to survive the trip to the server as null.
  const next = sanitizeNextOrNull(params.next);
  const user = await getSupabaseUser();
  const authenticated = Boolean(user);

  // Only asked once the visitor is actually signed in: an anonymous visitor
  // has no ops profile to find, and this is a database read on a public page.
  //
  // The claim half matters as much as the role half. Reading the role alone
  // made this page offer "Continue to Operations" to a linked operator whose
  // token does not carry their role yet — a button that bounces off the edge
  // gate and lands back here, which is a loop the user drives by hand.
  const { role: opsRole, claimReady: opsClaimReady } = authenticated
    ? await currentOpsAccess()
    : { role: null, claimReady: true };
  const decision = resolveLanding({
    requestedNext: params.next,
    opsRole,
    opsClaimReady,
  });

  // Two ways to reach the explanation: arriving with an ops `next` this
  // account cannot use, or being sent back here by POST /api/auth/login,
  // which made the same call at the moment of sign-in and has no `next` to
  // pass on.
  // `!opsRole` guards the notice-parameter branch: a stale or hand-typed
  // ?notice must not accuse an account that demonstrably does have a role.
  const deniedOps =
    authenticated &&
    !opsRole &&
    (decision.kind === 'no-ops-access' || params.notice === NO_OPS_ACCESS_NOTICE);

  // The opposite state, and it gets the opposite explanation: an account that
  // DOES hold a role the edge gate cannot see yet. Guarded on the live
  // readings rather than the parameter alone, so a hand-typed ?notice cannot
  // tell a fully working operator that their access is pending.
  const opsAccessPending =
    authenticated &&
    Boolean(opsRole) &&
    !opsClaimReady &&
    (decision.kind === 'ops-access-pending' || params.notice === OPS_ACCESS_PENDING_NOTICE);

  // Never a path when access was refused. There is no longer any surface a
  // profile-less account may enter (`/project/*` is gated on the same active
  // ops profile as `/ops/*`), so offering a "Continue" button at all would be
  // the loop, hand-built one click at a time: every destination bounces
  // straight back to this page. The pending case is refused for the narrower
  // reason: the console it would point at is the one place that bounces.
  const continueTo = decision.kind === 'go' ? decision.path : null;

  return (
    /*
      ─── THE FRONT DOOR IS BUILT PHONE-FIRST ──────────────────────────────

      It used to be a fixed 55/45 split with the brand field FIRST in the
      document. On a desktop that is a handsome composition; on a phone it
      meant 38vh of decorative halo above the fold and the email field pushed
      off the bottom of the screen. A driver opening this at a depot gate had
      to scroll past a logo to sign in.

      So the order is inverted: the FORM is the first thing in the document
      and the first thing on a phone, and the brand field is `order-first`
      only from `md` up, where there is a second column to put it in. Nothing
      about the desktop composition changes; the phone stops being an
      afterthought.
    */
    <main className="relative flex min-h-[100dvh] flex-col bg-background text-foreground md:flex-row">
      {/* Brand field (~55% on desktop, a slim band on a phone) */}
      <section
        aria-hidden
        className="relative order-2 flex items-center justify-center overflow-hidden border-t border-border px-8 py-10 md:order-1 md:min-h-0 md:w-[55%] md:border-r md:border-t-0 md:px-14 md:py-14"
      >
        {/* The identity halo. Both stops are tokens, so it is a warm glow on
            the night ground and a warm wash on the day one — the same
            composition either way, which is what keeps the two editions
            recognisably one page. */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[85vmin] w-[85vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, hsl(var(--brand) / 0.16), hsl(var(--muted) / 0.5) 42%, transparent 68%)',
          }}
        />
        {/* Radial line texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            background:
              'repeating-conic-gradient(from 0deg at 50% 50%, hsl(var(--brand) / 0.08) 0deg, transparent 2deg 8deg)',
            maskImage: 'radial-gradient(circle at 50% 50%, black 0%, transparent 62%)',
            WebkitMaskImage: 'radial-gradient(circle at 50% 50%, black 0%, transparent 62%)',
          }}
        />
        <div className="relative z-10 flex flex-col items-center text-center">
          <Image
            src="/brand/logonew.png"
            alt=""
            width={690}
            height={677}
            priority
            sizes="(min-width: 768px) 18rem, 8rem"
            className="h-auto w-32 md:w-72"
          />
          <OlympussWordmark className="mt-6 text-2xl md:text-3xl" />
        </div>
      </section>

      {/* Authentication interface */}
      <section className="relative order-1 flex flex-1 items-center justify-center px-6 py-12 md:order-2 md:w-[45%] md:px-12 md:py-14">
        <div className="flex w-full max-w-sm flex-col items-start">
          {/* The theme control is on the front door because the person signing
              in is the person who will read a dashboard behind it, and the
              preference is one durable choice for the whole product. */}
          <div className="mb-8 flex w-full items-center justify-between gap-4">
            <OlympussWordmark className="text-xl md:hidden" />
            <ThemeToggle className="ml-auto" />
          </div>

          <div className="mb-8">
            <p className="brand-eyebrow">Authorised access</p>
            <h1 className="ol-display mt-4 text-3xl leading-tight text-foreground sm:text-4xl">
              Sign in to Olympuss AI
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              {authenticated
                ? 'You are signed in. Continue below, or sign out to let someone else use this device.'
                : 'One sign-in for the operations console and the project workspace. You will be taken to your own screen.'}
            </p>
          </div>

          {authenticated ? (
            <div className="w-full space-y-5">
              {deniedOps && (
                <NoOpsAccessNotice
                  requested={decision.kind === 'no-ops-access' ? decision.requested : null}
                />
              )}
              {opsAccessPending && (
                <OpsAccessPendingNotice
                  role={opsRole}
                  requested={decision.kind === 'ops-access-pending' ? decision.requested : null}
                />
              )}
              <AuthenticatedActions
                next={continueTo}
                email={user?.email}
                label={
                  opsRole && !deniedOps && !opsAccessPending ? 'Continue to Operations' : undefined
                }
              />
              {/* Sign-out is the only action left when there is nowhere to
                  continue to, and it is the one that lets a second person on
                  a shared machine get in. AuthenticatedActions renders it
                  either way. */}
            </div>
          ) : (
            <LoginForm next={next} />
          )}

          <div className="mt-10 flex w-full flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">
              Authorised users only
            </p>
            <Link
              href="/"
              className="text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Back to Olympuss AI
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
