import type { Metadata } from 'next';
import { requireProjectSurface } from '@/lib/auth/projectPageGuard';

/**
 * Protected UPSRTC dashboard shell.
 *
 * Two responsibilities:
 *
 * 1. Independent server-side authorization gate (defence in depth — middleware
 *    is the first check, this is a second that does not trust it, and the Edge
 *    runtime cannot read `ops_users` at all). A request without an ACTIVE ops
 *    profile never renders dashboard markup.
 *
 *    This used to be `if (!user) redirect('/login')` — a signed-in check, not
 *    an authorization one. With public self-signup on the Supabase project,
 *    that admitted any stranger who completed a registration form to the whole
 *    command centre. See src/lib/auth/authorize.ts for the full account.
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

export default async function UpsrtcProjectLayout({ children }: { children: React.ReactNode }) {
  await requireProjectSurface('/project/upsrtc');

  return (
    // Enlarge the entire command centre ~18% — text, panels and spacing
    // together — with CSS `zoom`. The box is sized at the inverse (100/zoom) so
    // after zooming it fills exactly the viewport (no overflow, no clipping).
    //
    // `zoom` is used deliberately rather than `transform: scale`: `transform`
    // leaves the layout size unchanged and only scales visually, which desyncs
    // the Google Maps canvas overlay (it projects positions in *layout* pixels)
    // and shifts every bus marker off the road. `zoom` changes the actual
    // layout size, so the map's projection stays aligned.
    //
    // The dashboard is viewed at ~85% browser zoom, which widens the effective
    // CSS viewport well beyond the 1920px design width, so the top command bar
    // and the map-area overlays have ample room even at this scale.
    // `dark` pins this subtree to the night palette. `darkMode: 'class'`
    // resolves against a `.dark` ANCESTOR, so the command centre keeps its
    // look even while an operator has the console in light mode. Unifying
    // this surface's own vocabulary is the cinematic lane's work; this only
    // stops it inverting under a light theme in the meantime.
    <div
      className="upsrtc-shell dark relative overflow-hidden bg-background font-sans text-foreground antialiased"
      style={{ zoom: 1.18, width: 'calc(100vw / 1.18)', height: 'calc(100dvh / 1.18)' }}
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
