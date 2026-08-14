'use client';

import { SatelliteDish, TriangleAlert, RotateCw } from 'lucide-react';

/**
 * What the map area shows while the basemap is loading, or when it failed.
 * Never a raw stack.
 *
 * ─── THE `light` VARIANT IS GONE, AND SO IS ITS COPY ─────────────────────
 *
 * This carried a whole second styling branch — twelve conditionals — for the
 * old light bunching simulator. That page moved onto the ops shell some time
 * ago and stopped calling this, so by the time this lane arrived the branch
 * had no caller: it was a hundred lines of dead ternaries that every future
 * reader had to hold in their head to work out which half was live. The
 * theme now does what the prop was doing.
 *
 * ─── THE WORDING WENT WITH IT ────────────────────────────────────────────
 *
 * "Establishing holographic projection and synchronising UPSRTC telemetry"
 * described nothing that was happening. The map area is the one place on
 * this screen where a failure could be read as "no buses are running", so
 * the failure case has to say which half is down and which half still works
 * — and say it in words an operations reader can act on.
 */
export function MapFallback({
  status,
  message,
  onRetry,
}: {
  status: 'loading' | 'error';
  message?: string;
  onRetry: () => void;
}) {
  const isError = status === 'error';

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/[0.92] backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-0 bg-hud-grid opacity-40" />

      <div className="hud-panel hud-corners relative max-w-md p-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center">
          <span
            className={`absolute h-16 w-16 rounded-full border ${
              isError ? 'border-instrument-danger/40' : 'animate-pulse-ring border-primary/50'
            }`}
          />
          {isError ? (
            <TriangleAlert className="h-7 w-7 text-destructive" aria-hidden />
          ) : (
            <SatelliteDish className="h-7 w-7 animate-flicker text-primary" aria-hidden />
          )}
        </div>

        <h3
          className={`mb-2 text-sm font-semibold uppercase tracking-[0.14em] ${
            isError ? 'text-destructive' : 'text-primary'
          }`}
        >
          {isError ? 'The map could not load' : 'Loading the map'}
        </h3>

        <p className="mb-5 text-[13px] leading-relaxed text-muted-foreground">
          {isError
            ? (message ??
              'The map itself could not start. This is the map, not the buses — live positions are still arriving and are listed in the fleet panel.')
            : 'Loading the map and the current bus positions…'}
        </p>

        {isError && (
          <>
            <button type="button" className="hud-button-primary mx-auto" onClick={onRetry}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              Try loading it again
            </button>
            <p className="mt-4 border-t border-border pt-3 text-[12px] text-subtle">
              Bus positions, timetables and every other panel on this screen keep working without
              the map.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
