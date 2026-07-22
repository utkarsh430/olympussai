import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/server';
import { PROJECT_UPSRTC } from '@/lib/auth/config';

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
  if (!session || session.project !== PROJECT_UPSRTC) {
    redirect('/login?next=/project/upsrtc');
  }

  return (
    // `zoom` enlarges the entire command centre a little (~8%) — text, panels
    // and spacing together. The box is sized inversely (100/zoom) so after
    // zooming it fills exactly the viewport, so nothing overflows or clips.
    // Fixed overlays use `inset-0`, so they still cover the full viewport while
    // their content scales with the zoom.
    <div
      className="upsrtc-shell relative overflow-hidden bg-void font-display text-[#d6ecf7] [font-feature-settings:'tnum'_1] antialiased"
      style={{ zoom: 1.08, width: 'calc(100vw / 1.08)', height: 'calc(100dvh / 1.08)' }}
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
