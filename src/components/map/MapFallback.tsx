'use client';

import { SatelliteDish, TriangleAlert, RotateCw } from 'lucide-react';

/**
 * Polished futuristic fallback for map loading / failure — never a raw stack.
 *
 * `variant` exists because the bunching simulator is a light surface: the dark
 * default is unchanged for the command centre, which passes nothing.
 */
export function MapFallback({
  status,
  message,
  onRetry,
  variant = 'dark',
}: {
  status: 'loading' | 'error';
  message?: string;
  onRetry: () => void;
  variant?: 'dark' | 'light';
}) {
  const isError = status === 'error';
  const light = variant === 'light';

  return (
    <div
      className={
        light
          ? 'absolute inset-0 z-30 flex items-center justify-center bg-sim-surface/95'
          : 'absolute inset-0 z-30 flex items-center justify-center bg-void-900/92 backdrop-blur-sm'
      }
    >
      {!light && (
        <div className="pointer-events-none absolute inset-0 bg-hud-grid bg-hud-grid opacity-40" />
      )}

      <div
        className={
          light
            ? 'sim-panel relative max-w-md p-8 text-center'
            : 'hud-panel hud-corners relative max-w-md p-8 text-center'
        }
      >
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center">
          <span
            className={`absolute h-16 w-16 rounded-full border ${
              isError
                ? light
                  ? 'border-sim-crimson/40'
                  : 'border-alert-crimson/40'
                : light
                  ? 'animate-pulse-ring border-sim-accent/50'
                  : 'animate-pulse-ring border-holo-glow/50'
            }`}
          />
          {isError ? (
            <TriangleAlert
              className={`h-7 w-7 ${light ? 'text-sim-crimson' : 'text-alert-crimson'}`}
              aria-hidden
            />
          ) : (
            <SatelliteDish
              className={`h-7 w-7 animate-flicker ${light ? 'text-sim-accent' : 'text-holo-glow'}`}
              aria-hidden
            />
          )}
        </div>

        <h3
          className={`mb-2 font-mono text-sm uppercase tracking-[0.2em] ${
            isError
              ? light
                ? 'text-sim-crimson'
                : 'text-alert-crimson'
              : light
                ? 'text-sim-accent'
                : 'text-holo-glow'
          }`}
        >
          {isError ? 'Basemap Unavailable' : 'Initialising Command Map'}
        </h3>

        <p
          className={`mb-5 font-mono text-[11px] leading-relaxed ${
            light ? 'text-sim-muted' : 'text-holo-glow/55'
          }`}
        >
          {isError
            ? (message ??
              'The Google basemap could not be initialised. Live UPSRTC telemetry continues to stream and remains available in the fleet panel.')
            : light
              ? 'Loading the simulation corridor basemap…'
              : 'Establishing holographic projection and synchronising UPSRTC telemetry…'}
        </p>

        {isError && (
          <>
            <button
              type="button"
              className={`mx-auto ${light ? 'sim-button-primary' : 'hud-button-primary'}`}
              onClick={onRetry}
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              Reinitialise Map
            </button>
            <p
              className={`mt-4 border-t pt-3 font-mono text-[10px] ${
                light
                  ? 'border-sim-line text-sim-faint'
                  : 'border-holo-glow/10 text-holo-glow/40'
              }`}
            >
              {light
                ? 'The headway simulation, metrics and calculations below remain fully functional without the basemap.'
                : 'Fleet data, schedules and all analysis views remain fully operational without the basemap.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
