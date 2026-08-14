import './olympuss.css';

/**
 * Public (landing + login) layout.
 *
 * ─── THE FONTS MOVED, AND THAT RETIRES THE LAST GOOGLE FETCH ─────────────
 *
 * This used to load Manrope and Cormorant Garamond through
 * `next/font/google`, which fetches the binaries from Google at BUILD time.
 * Together with the dashboard's Orbitron that made four families and three
 * build-time network calls, one of which has already failed a build.
 *
 * All three families are retired. The product is set in one self-hosted
 * family (Noto Sans, see src/app/fonts.ts) plus JetBrains Mono for
 * identifiers, inherited from the root layout. There is now no font-related
 * network call anywhere in the build.
 *
 * ─── WHY THIS SUBTREE IS PINNED TO DARK ──────────────────────────────────
 *
 * The landing page is a dark-only brand surface with its own `.ol-scope`
 * palette. `darkMode: 'class'` resolves against a `.dark` ANCESTOR, not just
 * <html>, so wrapping this subtree re-declares the token block for it and
 * the landing page keeps its night look even while an operator has the
 * console in light mode. Same mechanism, no second palette.
 *
 * Unifying this surface's own colour vocabulary is the cinematic lane's
 * work; this only stops it inverting under a light theme in the meantime.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="ol-scope dark bg-ol-bg font-sans">{children}</div>;
}
