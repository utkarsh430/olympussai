'use client';

import { SatelliteDish, TriangleAlert, RotateCw } from 'lucide-react';

/** Polished futuristic fallback for map loading / failure — never a raw stack. */
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
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-void-900/92 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-0 bg-hud-grid bg-hud-grid opacity-40" />

      <div className="hud-panel hud-corners relative max-w-md p-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center">
          <span
            className={`absolute h-16 w-16 rounded-full border ${
              isError ? 'border-alert-crimson/40' : 'animate-pulse-ring border-holo-glow/50'
            }`}
          />
          {isError ? (
            <TriangleAlert className="h-7 w-7 text-alert-crimson" aria-hidden />
          ) : (
            <SatelliteDish className="h-7 w-7 animate-flicker text-holo-glow" aria-hidden />
          )}
        </div>

        <h3
          className={`mb-2 font-mono text-sm uppercase tracking-[0.2em] ${
            isError ? 'text-alert-crimson' : 'text-holo-glow'
          }`}
        >
          {isError ? 'Basemap Unavailable' : 'Initialising Command Map'}
        </h3>

        <p className="mb-5 font-mono text-[11px] leading-relaxed text-holo-glow/55">
          {isError
            ? (message ??
              'The Google basemap could not be initialised. Live UPSRTC telemetry continues to stream and remains available in the fleet panel.')
            : 'Establishing holographic projection and synchronising UPSRTC telemetry…'}
        </p>

        {isError && (
          <>
            <button type="button" className="hud-button-primary mx-auto" onClick={onRetry}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              Reinitialise Map
            </button>
            <p className="mt-4 border-t border-holo-glow/10 pt-3 font-mono text-[10px] text-holo-glow/40">
              Fleet data, schedules and all analysis views remain fully operational without
              the basemap.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
