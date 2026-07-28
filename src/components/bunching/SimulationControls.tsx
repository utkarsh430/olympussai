'use client';

import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { SIM_MINUTES_PER_ITERATION, TARGET_HEADWAY_MINUTES } from '@/lib/bunching/config';
import { formatSimClock } from '@/lib/bunching/math';
import type { SimulationPlayer } from './useSimulationPlayer';

/**
 * Transport controls for the synchronised comparison. Play advances both
 * simulations on the same clock; every other control is a direct seek.
 */
export function SimulationControls({
  player,
  total,
}: {
  player: SimulationPlayer;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-holo-glow/20 bg-void-900/60 px-3 py-2">
      <button
        type="button"
        className="hud-button-primary min-w-[92px]"
        onClick={player.toggle}
        aria-pressed={player.playing}
        aria-label={player.playing ? 'Pause simulation' : 'Play simulation'}
        data-testid="bunching-play"
      >
        {player.playing ? (
          <Pause className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden />
        )}
        {player.playing ? 'Pause' : player.atEnd ? 'Replay' : 'Play'}
      </button>

      <button
        type="button"
        className="hud-button"
        onClick={player.previous}
        disabled={player.atStart}
        aria-label="Previous iteration"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        Previous
      </button>

      <button
        type="button"
        className="hud-button"
        onClick={player.next}
        disabled={player.atEnd}
        aria-label="Next iteration"
        data-testid="bunching-next"
      >
        Next
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </button>

      <button
        type="button"
        className="hud-button"
        onClick={player.reset}
        aria-label="Reset simulation to the initial disturbance"
        data-testid="bunching-reset"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Reset
      </button>

      <div className="flex min-w-[200px] flex-1 items-center gap-2">
        <label
          className="hud-label whitespace-nowrap"
          htmlFor="bunching-scrubber"
        >
          Iteration
        </label>
        <input
          id="bunching-scrubber"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          step={1}
          value={player.index}
          onChange={(event) => player.seek(Number(event.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-holo-glow/20 accent-holo-glow"
          aria-valuetext={`Iteration ${player.index} of ${total - 1}, ${formatSimClock(
            player.index * SIM_MINUTES_PER_ITERATION,
          )}`}
        />
        <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-holo-glow">
          {player.index} / {total - 1}
          <span className="ml-1 text-holo-glow/45">
            {formatSimClock(player.index * SIM_MINUTES_PER_ITERATION)}
          </span>
        </span>
      </div>

      <span
        className="whitespace-nowrap rounded border border-holo-glow/30 bg-holo-glow/[0.07] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-holo-glow/80"
        title="Simulation assumption for this demonstration. Not a universal UPSRTC operating standard."
      >
        Demo target headway: {TARGET_HEADWAY_MINUTES.toFixed(1)} min
      </span>
    </div>
  );
}
