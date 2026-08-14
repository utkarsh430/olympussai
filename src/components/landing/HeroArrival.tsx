'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Scene 01 — Arrival (Section 22). The 3D golden globe glows behind; this is the
 * accessible hero: eyebrow, H1, body, two actions, scroll cue.
 * Entrance is staggered and brief; content is fully readable without animation.
 */
export function HeroArrival() {
  const toAscent = useCallback(() => {
    const el = document.getElementById('ascent');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  return (
    <section
      id="arrival"
      aria-label="Arrival"
      className="relative flex flex-col items-center justify-center px-6 pb-24 pt-28 text-center"
      // Theme-driven, because the height exists to give the WebGL globe scroll
      // travel and the globe is only mounted on the night ground. See the
      // --hero-min-h note in globals.css.
      style={{ minHeight: 'var(--hero-min-h)' }}
    >
      {/*
        Soft legibility scrim — a gradient, not a card.

        Its job is to push the PAGE GROUND back up under the headline where
        the globe is brightest, so it is built from `--background` rather
        than from a fixed near-black. That makes it correct in both themes
        without a second rule: on the night ground it dims the globe exactly
        as before, and on the day ground it is a soft white bloom that lifts
        the hero off the warm field.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[80vmin] w-[80vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle, hsl(var(--background) / var(--stage-scrim)), transparent 62%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <p className="ol-anim ol-eyebrow" style={{ animationDelay: '0.9s' }}>
          Artificial Intelligence · Intelligent Systems · Innovation
        </p>

        <h1
          className="ol-anim ol-display ol-h1 mt-5 text-foreground"
          // The halo is the ground colour, not black: behind pale text on the
          // night field it deepens the ground, and behind dark text on the day
          // field it lifts the headline off the warm wash. One rule, both
          // themes, no second declaration to keep in step.
          style={{
            animationDelay: '1.1s',
            textShadow: '0 2px 40px hsl(var(--background) / calc(var(--stage-scrim) * 1.55))',
          }}
        >
          Intelligence Elevated
        </h1>

        <p
          className="ol-anim ol-body ol-measure mt-7 text-pretty"
          style={{ animationDelay: '1.35s' }}
        >
          A digital laboratory exploring artificial intelligence, adaptive systems, and the ideas
          shaping the next era of technology.
        </p>

        <div
          className="ol-anim mt-10 flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:items-center"
          style={{ animationDelay: '1.55s' }}
        >
          {/* Both actions are the shared Button, so the front door has the
              same focus ring and the same hit target as everything behind
              it. The identity variant is used here and essentially nowhere
              else in the product. */}
          <Button type="button" variant="brand" size="xl" onClick={toAscent}>
            Ascend to Explore
          </Button>
          <Button asChild variant="brandOutline" size="xl">
            <Link href="/login">Project Login</Link>
          </Button>
        </div>
      </div>

      {/* Scroll indicator */}
      <button
        type="button"
        onClick={toAscent}
        aria-label="Scroll to the next section"
        /*
          CENTRED WITH MARGINS, NOT WITH A TRANSFORM, AND THAT IS A BUG FIX.

          This was `left-1/2 -translate-x-1/2`, and it has been rendering 70px
          right of centre — measured, not guessed: the button's box centre sat
          at 790px in a 1440px viewport. The cause is two rules quietly
          fighting. `ol-anim` runs `ol-rise`, whose final keyframe is
          `transform: none`, with `animation-fill-mode: forwards`. A filled
          animation's final value beats a class, so the moment the entrance
          finishes the browser throws the centring translate away and never
          puts it back.

          `inset-x-0 mx-auto w-fit` centres through the box model instead, so
          it cannot be clobbered by an animation and does not care what the
          entrance does with transforms.
        */
        className="ol-anim absolute inset-x-0 bottom-10 mx-auto w-fit text-[10px] uppercase tracking-[0.24em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        style={{ animationDelay: '1.9s' }}
      >
        <span>Ascend to Explore</span>
        <span
          aria-hidden
          className="mx-auto mt-2 block h-3 w-3 rotate-45 border-b border-r border-brand/60"
          style={{ animation: 'ol-scroll-cue 2.4s ease-in-out infinite' }}
        />
      </button>
    </section>
  );
}
