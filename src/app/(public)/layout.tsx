import './olympuss.css';

/**
 * Public (landing + login) layout.
 *
 * ─── THIS SUBTREE IS NO LONGER PINNED TO DARK ────────────────────────────
 *
 * It used to be `<div className="ol-scope dark bg-ol-bg">`, which held the
 * front door at night while the console behind it followed the visitor's
 * theme. That was the right holding position for a foundation that could not
 * verify this surface; it is the wrong final state. /login is the single
 * front door for every persona, and an operator who has set the product to
 * light and then signs in on a phone in daylight should not have to pass
 * through a black screen to reach a white one.
 *
 * So the pin is gone and both pages resolve through the shared tokens. What
 * survives the change is in LandingBackdrop and CanvasMount: the WebGL globe
 * is an EMISSIVE object and there is no light to add to a white field, so it
 * mounts on the night ground only, and light gets the static edition the
 * design already had. Motion, depth, entrance choreography and the editorial
 * type scale are unchanged in both.
 *
 * ─── THE FONTS ALREADY MOVED ─────────────────────────────────────────────
 *
 * This used to load Manrope and Cormorant Garamond through
 * `next/font/google`, which fetches the binaries from Google at BUILD time.
 * All three of the old families are retired; the product is set in one
 * self-hosted family (Noto Sans, see src/app/fonts.ts) plus JetBrains Mono
 * for identifiers, inherited from the root layout.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="ol-scope bg-background font-sans text-foreground">{children}</div>;
}
