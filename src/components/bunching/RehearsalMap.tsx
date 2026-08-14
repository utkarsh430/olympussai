'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { OpsFleetMap } from '@/components/ops/map/OpsFleetMap';
import { OpsButton, OpsBadge } from '@/components/ops/ui';
import {
  REHEARSAL_MAP_LEGEND,
  buildCorridorOverlay,
  buildSimulatedFleetOverlay,
  corridorFitPoints,
} from '@/lib/rehearsal/overlays';
import type { RehearsalArm, RehearsalResult } from '@/models/rehearsal';

/**
 * The run, on the real corridor it runs on.
 *
 * REUSES the ops fleet map rather than carrying its own — one canvas
 * renderer, one frame, one set of camera rules. What it does NOT do is pass
 * these buses in as vehicles: see src/lib/rehearsal/overlays.ts for why a
 * simulated bus is an annotation and never an `OpsMapVehicle`.
 *
 * Playback is a plain frame index over a fixed-length track the server
 * already computed, not a simulation running in the browser. The browser
 * never models anything; it steps through an answer.
 */

/** Milliseconds per frame. Slow enough to watch a bus close on its leader, fast enough to see a whole run. */
const FRAME_INTERVAL_MS = 220;

export function RehearsalMap({
  result,
  arm,
  armLabel,
}: {
  result: RehearsalResult;
  arm: RehearsalArm;
  armLabel: string;
}) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frameCount = arm.frames.length;

  // A new run (or a switched arm) restarts the track rather than leaving the
  // scrubber pointing at a frame that no longer means the same thing.
  const trackKey = `${result.corridor.routeDirectionId}:${result.inputs.seed}:${result.inputs.disturbance}:${armLabel}`;
  const previousTrack = useRef(trackKey);
  if (previousTrack.current !== trackKey) {
    previousTrack.current = trackKey;
    if (frameIndex !== 0) setFrameIndex(0);
  }

  useEffect(() => {
    if (!playing || frameCount === 0) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frameCount);
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, frameCount]);

  const frame = arm.frames[Math.min(frameIndex, Math.max(0, frameCount - 1))] ?? null;

  const overlays = useMemo(
    () => [
      buildCorridorOverlay(result.corridor.stops, result.corridor.shape),
      buildSimulatedFleetOverlay(frame, result.disturbedVehicleId),
    ],
    [result.corridor.stops, result.corridor.shape, frame, result.disturbedVehicleId],
  );

  const fitPoints = useMemo(
    () => corridorFitPoints(result.corridor.stops, result.corridor.shape),
    [result.corridor.stops, result.corridor.shape],
  );

  const held = frame?.vehicles.filter((vehicle) => vehicle.status === 'held').length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OpsFleetMap
        vehicles={[]}
        overlays={overlays}
        fitPoints={fitPoints}
        showFleetLegend={false}
        // The map carries no live fleet by design, so the shared component's
        // "No vehicles to show" notice would be a true statement about the
        // wrong thing: it describes an empty FLEET, over a map that is full
        // of simulated buses.
        emptyMessage={null}
        fill
        // MEASURED at 1024x900: with the frame's default 28rem floor the
        // map box could not shrink to fit the pane, so the playback row
        // overflowed upward and painted over the map's own caption. The
        // floor has to be low enough that the frame can give way before
        // the controls do - a map an operator cannot scrub is worse than a
        // slightly shorter map.
        minHeight="16rem"
        label={`Simulated buses on ${result.corridor.routeId} ${result.corridor.directionCode}`}
        caption={`${result.corridor.stops.length} stops over ${(result.corridor.totalDistanceMeters / 1000).toFixed(0)} km — real corridor geometry, simulated buses`}
      />

      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <OpsButton onClick={() => setPlaying((current) => !current)} disabled={frameCount === 0}>
          {playing ? 'Pause' : 'Play'}
        </OpsButton>

        <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-xs text-ops-faint">
          <span className="sr-only">Position in the run</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, frameCount - 1)}
            value={Math.min(frameIndex, Math.max(0, frameCount - 1))}
            onChange={(event) => {
              setPlaying(false);
              setFrameIndex(Number(event.target.value));
            }}
            disabled={frameCount === 0}
            className="w-full accent-holo-glow"
          />
          <span className="w-20 shrink-0 text-right font-mono tabular-nums">
            {frame ? `${Math.round(frame.atSeconds / 60)} min` : '—'}
          </span>
        </label>

        {held > 0 ? (
          <OpsBadge variant="sim">
            {held === 1 ? '1 bus held' : `${held} buses held`}
          </OpsBadge>
        ) : null}
      </div>

      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ops-faint">
        {REHEARSAL_MAP_LEGEND.map((entry) => (
          <span key={entry.label} className="inline-flex items-center gap-1.5 font-mono">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.colour }}
            />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}
