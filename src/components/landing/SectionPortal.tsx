import Link from 'next/link';
import { Reveal } from './Reveal';

/**
 * Scene 05 — Project Portal (Section 26). The golden halo returns as a gateway
 * in the WebGL layer; here the quiet, centred call to enter the protected
 * environment. The button navigates immediately to /login.
 */
export function SectionPortal() {
  return (
    <section
      id="portal"
      aria-label="Project Portal"
      className="relative flex min-h-[120vh] flex-col items-center justify-center px-6 py-32 text-center"
    >
      {/* Legibility scrim — keeps text readable over the bright gateway glow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70vmin] w-[110vmin] -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
        style={{ background: 'radial-gradient(ellipse, rgba(5,5,7,0.72), rgba(5,5,7,0.35) 45%, transparent 70%)' }}
      />
      <Reveal className="relative z-10 flex flex-col items-center">
        <p className="ol-eyebrow">Private Environment</p>
        <h2 className="ol-display ol-h2 mt-5 text-ol-ivory">Enter the project workspace.</h2>
        <p className="ol-body ol-measure mt-7">
          Authorized access to projects, operational systems, and protected environments within
          Olympuss AI.
        </p>

        <Link
          href="/login"
          className="group mt-10 inline-flex items-center gap-3 rounded-md border border-ol-gold/60 bg-ol-gold/12 px-8 py-4 font-sans text-[13px] uppercase tracking-[0.22em] text-ol-gold-light transition-all hover:border-ol-gold hover:bg-ol-gold/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ol-gold"
          style={{ boxShadow: '0 0 40px -10px rgba(214,161,58,0.55)' }}
        >
          Open Project Portal
          <span aria-hidden className="transition-transform group-hover:translate-x-1">
            →
          </span>
        </Link>

        <p className="mt-6 font-sans text-[11px] uppercase tracking-[0.18em] text-ol-muted">
          Authorized users only.
        </p>
      </Reveal>
    </section>
  );
}
