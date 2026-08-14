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
 * 2. Re-establishes the command-centre's fixed-viewport environment (no page
 *    scroll, the whole surface sized to the viewport) *scoped to this route
 *    only* — deliberately NOT on the global <body>, so the landing page still
 *    scrolls natively.
 *
 * ─── IT NO LONGER PINS THE NIGHT PALETTE ─────────────────────────────────
 *
 * This used to be `<div className="upsrtc-shell dark …">`. The `dark` is
 * gone, and the command centre follows the operator's theme like everything
 * else.
 *
 * That was a real decision rather than a sweep, because the obvious argument
 * runs the other way: a wall display in a control room is dark for good
 * reasons, and this is also the surface shown in a pitch. What settled it is
 * that neither reason is about the THEME. An operator who wants the night
 * display picks dark and gets exactly the surface that existed before, to the
 * pixel — the tokens in the dark block are the same values this page was
 * built on. What the change buys is the other case: the same command centre
 * projected in a bright room, or opened on a laptop at a depot in daylight,
 * where a black HUD is genuinely harder to read and always was.
 *
 * What "cinematic" means here survives the flip intact, because none of it
 * was ever the colour black: the fixed viewport, the instrument density, the
 * canvas fleet layer, the corner ticks, the scanline, the count-ups, the
 * drifting ambient particles and the framer-motion transitions are all
 * unchanged in both. The one thing that genuinely does not survive is the
 * BLOOM — see the `--hud-bloom` note in globals.css. A glow is light added to
 * a surface, and there is no light to add to white.
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
    <div
      className="upsrtc-shell relative overflow-hidden bg-background font-sans text-foreground antialiased"
      style={{ zoom: 1.18, width: 'calc(100vw / 1.18)', height: 'calc(100dvh / 1.18)' }}
    >
      <a
        href="#command-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-primary-foreground"
      >
        Skip to command centre
      </a>
      {children}
    </div>
  );
}
