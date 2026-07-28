import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/server';
import { isAuthorizedProject } from '@/lib/auth/config';
import { BunchingSimulator } from '@/components/bunching/BunchingSimulator';

/**
 * Bus bunching control simulator — a protected UPSRTC project surface.
 *
 * Sits under `/project/*`, so edge middleware gates it exactly like the
 * operations dashboard. This server component then re-verifies the session
 * independently (the same defence-in-depth pattern the dashboard layout uses):
 * an unauthenticated request never renders simulator markup.
 *
 * Deliberately *not* nested inside the dashboard's `upsrtc/layout.tsx`. That
 * layout re-creates a fixed-viewport, CSS-zoomed command-centre environment for
 * a page that must never scroll; this simulator is a long analysis surface that
 * scrolls naturally, and CSS `zoom` would also desynchronise Tailwind's
 * viewport-based breakpoints from the real layout width. The visual language
 * is applied here instead, so the page still reads as part of the same product:
 * Orbitron display type and tabular numerals as on the dashboard, but on a light
 * surface (`sim-light` + the `sim-*` palette) rather than the command centre's
 * void background.
 */
export const metadata: Metadata = {
  title: 'Bus Bunching Control Simulator · UPSRTC',
  // Protected surface — never indexed.
  robots: { index: false, follow: false },
};

export default async function BunchingPage() {
  const session = await getSession();
  if (!session || !isAuthorizedProject(session.project)) {
    redirect('/login?next=/project/bunching');
  }

  return (
    <div className="sim-light bg-sim-page font-display text-sim-ink [font-feature-settings:'tnum'_1] antialiased">
      <a
        href="#bunching-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-sim-accent focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-white"
      >
        Skip to simulator
      </a>
      <div id="bunching-main">
        <BunchingSimulator />
      </div>
    </div>
  );
}
