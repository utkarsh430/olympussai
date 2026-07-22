'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback } from 'react';

/**
 * Scene 01 — Arrival (Section 22). The 3D golden halo glows behind; this is the
 * accessible hero: eyebrow, emblem stamp, H1, body, two actions, scroll cue.
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
      className="relative flex min-h-[120vh] flex-col items-center justify-center px-6 pb-24 pt-28 text-center"
    >
      {/* Soft legibility scrim — a gradient, not a card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[80vmin] w-[80vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(5,5,7,0.55), transparent 62%)' }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <Image
          src="/brand/olympuss-emblem.webp"
          alt="Olympuss AI"
          width={84}
          height={84}
          priority
          className="ol-anim-emblem h-16 w-16 sm:h-20 sm:w-20"
          style={{ animationDelay: '0.15s' }}
        />

        <p
          className="ol-anim ol-eyebrow mt-8"
          style={{ animationDelay: '0.9s' }}
        >
          Artificial Intelligence · Intelligent Systems · Innovation
        </p>

        <h1
          className="ol-anim ol-display ol-h1 mt-5 text-ol-ivory"
          style={{ animationDelay: '1.1s', textShadow: '0 2px 40px rgba(0,0,0,0.6)' }}
        >
          Intelligence, elevated.
        </h1>

        <p
          className="ol-anim ol-body ol-measure mt-7"
          style={{ animationDelay: '1.35s', textShadow: '0 2px 20px rgba(0,0,0,0.7)' }}
        >
          A digital laboratory exploring artificial intelligence, adaptive systems, and the ideas
          shaping the next era of technology.
        </p>

        <div
          className="ol-anim mt-10 flex flex-col items-center gap-4 sm:flex-row"
          style={{ animationDelay: '1.55s' }}
        >
          <button
            type="button"
            onClick={toAscent}
            className="rounded-md border border-ol-gold/60 bg-ol-gold/12 px-7 py-3.5 font-sans text-[13px] uppercase tracking-[0.2em] text-ol-gold-light transition-all hover:bg-ol-gold/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ol-gold"
            style={{ boxShadow: '0 0 34px -12px rgba(214,161,58,0.6)' }}
          >
            Ascend to Explore
          </button>
          <Link
            href="/login"
            className="rounded-md border border-[var(--ol-border)] px-7 py-3.5 font-sans text-[13px] uppercase tracking-[0.2em] text-ol-text-secondary transition-colors hover:border-white/30 hover:text-ol-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ol-gold"
          >
            Project Login
          </Link>
        </div>
      </div>

      {/* Scroll indicator */}
      <button
        type="button"
        onClick={toAscent}
        aria-label="Ascend to explore"
        className="ol-anim absolute bottom-10 left-1/2 -translate-x-1/2 font-sans text-[10px] uppercase tracking-[0.24em] text-ol-text-secondary transition-colors hover:text-ol-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ol-gold"
        style={{ animationDelay: '1.9s' }}
      >
        <span>Ascend to Explore</span>
        <span
          aria-hidden
          className="mx-auto mt-2 block h-3 w-3 rotate-45 border-b border-r border-ol-gold/60"
          style={{ animation: 'ol-scroll-cue 2.4s ease-in-out infinite' }}
        />
      </button>
    </section>
  );
}
