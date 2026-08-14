'use client';

import dynamic from 'next/dynamic';
import { useTheme } from '@/components/theme/ThemeProvider';

/**
 * Client boundary for the WebGL globe. `next/dynamic` with `ssr: false` is
 * only permitted inside a Client Component, so the server landing page mounts
 * the experience through here. The heavy three.js bundle loads lazily.
 *
 * ─── THE GLOBE IS A NIGHT OBJECT, AND THAT IS THE DESIGN ─────────────────
 *
 * This is the one place in the redesign where a cinematic element does not
 * simply re-token and follow the theme, so the reasoning is worth stating
 * rather than discovering.
 *
 * The globe is EMISSIVE. Its particles, arcs and rim are drawn with additive
 * blending over a transparent canvas — they work by ADDING light to whatever
 * is behind them. On the night ground that is the entire effect. On a light
 * ground there is nothing left to add: additive blending against near-white
 * saturates to white, so the globe does not look wrong, it looks like a faint
 * smudge, and a visitor in light mode would see a page that appears to be
 * loading something that never arrives.
 *
 * The alternatives were both worse. Re-authoring the scene for a light ground
 * means a second material set, a second light rig and a second set of
 * hand-tuned colours for one page — a second design system in three.js, which
 * is the exact thing this redesign exists to remove. Forcing the landing page
 * to stay dark means the front door contradicts the product behind it, and
 * the captain asked for a genuine light mode product-wide.
 *
 * So the canvas is treated as what it already was: a progressive enhancement
 * on top of a designed static edition. It is already skipped for reduced
 * motion and for machines without WebGL, and LandingBackdrop is already the
 * intentional fallback. Light mode joins that list. What a light-mode visitor
 * gets is not a degraded page — it is the editorial edition: the same type,
 * the same entrance choreography, the same scroll reveals, the same card
 * depth, over the warm static field.
 *
 * `resolved`, not `preference`: a visitor on "follow my machine" gets the
 * globe when their machine is dark, and the effect follows them at dusk
 * without a reload, because the provider re-resolves on the media query.
 */
const ExperienceCanvas = dynamic(() => import('@/three/ExperienceCanvas'), { ssr: false });

export function CanvasMount() {
  const { resolved } = useTheme();
  if (resolved !== 'dark') return null;
  return <ExperienceCanvas />;
}
