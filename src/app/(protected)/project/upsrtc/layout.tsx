import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/server';
import { isAuthorizedProject } from '@/lib/auth/config';

/**
 * Protected UPSRTC dashboard shell.
 *
 * Two responsibilities:
 *
 * 1. Independent server-side session gate (defence in depth — middleware is the
 *    first check, this is a second that does not trust it). An unauthenticated
 *    request never renders dashboard markup; it redirects to /login.
 *
 * 2. Re-establishes the command-centre's fixed-viewport visual environment
 *    (dark void background, Orbitron display font, cyan text, tabular numerals,
 *    no page scroll) *scoped to this route only* — deliberately NOT on the
 *    global <body>, so the public landing page scrolls natively with its own
 *    typography and palette.
 */
export const metadata: Metadata = {
  title: 'UPSRTC · Operations Intelligence',
  // Protected surface — never indexed.
  robots: { index: false, follow: false },
};

export default async function UpsrtcProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || !isAuthorizedProject(session.project)) {
    redirect('/login?next=/project/upsrtc');
  }

  return (
    // Enlarge the entire command centre ~18% — text, panels and spacing
    // together — with a top-left `transform: scale`. The box is laid out at the
    // inverse size (100/scale) so after scaling it fills exactly the viewport
    // (no overflow, no clipping). `transform` (rather than `zoom`) gives fixed
    // overlays a proper containing block and keeps click coordinates correct.
    //
    // The dashboard is viewed at ~85% browser zoom, which widens the effective
    // CSS viewport well beyond the 1920px design width, so the top command bar
    // and the map-area overlays have ample room even at this scale.
    <div
      className="upsrtc-shell fixed left-0 top-0 origin-top-left overflow-hidden bg-void font-display text-[#d6ecf7] [font-feature-settings:'tnum'_1] antialiased"
      style={{ transform: 'scale(1.18)', width: 'calc(100vw / 1.18)', height: 'calc(100dvh / 1.18)' }}
    >
      <a
        href="#command-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-holo-glow focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-void"
      >
        Skip to command centre
      </a>
      {children}
    </div>
  );
}
