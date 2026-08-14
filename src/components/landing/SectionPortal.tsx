import Link from 'next/link';
import { Reveal } from './Reveal';
import { Button } from '@/components/ui/button';

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
        style={{
          background:
            `radial-gradient(ellipse, hsl(var(--background) / calc(var(--stage-scrim) * 1.31)), hsl(var(--background) / calc(var(--stage-scrim) * 0.64)) 45%, transparent 70%)`,
        }}
      />
      <Reveal className="relative z-10 flex flex-col items-center">
        <p className="ol-eyebrow">Private Environment</p>
        <h2 className="ol-display ol-h2 mt-5 text-foreground">Enter the project workspace.</h2>
        <p className="ol-body ol-measure mt-7">
          Authorized access to projects, operational systems, and protected environments within
          Olympuss AI.
        </p>

        <Button asChild variant="brand" size="xl" className="group mt-10">
          <Link href="/login">
            Open Project Portal
            <span aria-hidden className="transition-transform group-hover:translate-x-1">
              →
            </span>
          </Link>
        </Button>

        <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-subtle">
          Authorized users only.
        </p>
      </Reveal>
    </section>
  );
}
