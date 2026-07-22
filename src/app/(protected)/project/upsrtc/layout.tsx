import type { Metadata } from 'next';

/**
 * Protected UPSRTC dashboard shell.
 *
 * This wrapper re-establishes the command-centre's fixed-viewport visual
 * environment (dark void background, Orbitron display font, cyan text, tabular
 * numerals, no page scroll) *scoped to this route only* — it deliberately does
 * NOT live on the global <body>, so the public Olympuss landing page can scroll
 * natively and use its own typography and palette.
 *
 * Section 16 (Olympuss project context) and the server-side session gate are
 * layered on in the authentication phase.
 */
export const metadata: Metadata = {
  title: 'UPSRTC · Operations Intelligence',
  // Protected surface — never indexed.
  robots: { index: false, follow: false },
};

export default function UpsrtcProjectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="upsrtc-shell relative h-[100dvh] w-full overflow-hidden bg-void font-display text-[#d6ecf7] [font-feature-settings:'tnum'_1] antialiased">
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
