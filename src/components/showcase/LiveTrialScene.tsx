'use client';

import { Pause, Play } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { REPLAY_SPEEDS } from '@/lib/showcase/replayClock';
import {
  emptyFrame,
  frameAt,
  replayWindow,
  type ReplayArm,
  type ReplayContext,
  type ReplayWindow,
} from '@/lib/showcase/replayFrame';
import type { LiveCorridorModel, LiveTrialModel } from '@/lib/showcase/resolve';
import { cn } from '@/lib/utils';
import { CorridorMap } from './CorridorMap';
import { ReplayLanes } from './ReplayLanes';
import { ARM_LABEL } from './TacticalMap';
import { useReplayClock } from './useReplayClock';

/**
 * The live trial: one scenario of the fleet trial replayed on one corridor.
 *
 * Two columns, and nothing floats over the plot. The three routes between
 * them run through every quadrant of the map - the city trunk south-west
 * to north-east, the suburban radial the other way, the inter-city trunk
 * from the right edge to the left - so any panel laid over the canvas
 * covered some route's end. The controls and readings therefore live in
 * a column of their own on the left, and the right column is the corridor
 * map - the basemap when there is one, the tactical plot when there is not -
 * with the time-distance lanes beneath it.
 *
 * Three choices drive everything: which corridor, which scenario on it, and
 * which arm - the corridor left alone or the corridor under control. The
 * frame for the chosen arm is derived from the clock on every change and
 * handed to the plot; the lanes show both arms at once so the comparison is
 * always on screen.
 *
 * The clock runs over the replay WINDOW (`replayWindow`): the sampled buses
 * occupy a few hours of a ~25,000 s horizon, so the clock counts seconds
 * from the window's start and every consumer of absolute trial time -
 * `frameAt`, the lanes, the sim clock - is handed `window.start + clock.t`.
 * Choosing a corridor resets the scenario, the followed bus and, through
 * the changed horizon, the clock.
 *
 * The scene holds no numbers of its own. Every figure it shows comes off
 * the model or off the frame.
 */

/** The simulated service day starts at 06:00. */
const SERVICE_START_SECONDS = 6 * 3600;

const ARMS: readonly ReplayArm[] = ['uncontrolled', 'controlled'];

const NO_WINDOW: ReplayWindow = { start: 0, end: 0 };

/**
 * `t` seconds into the run as a wall clock, HH:MM from 06:00. The clock is
 * a time of day, so it rolls past midnight: an inter-city window that runs
 * twenty hours reads `02:00`, never `26:00`.
 */
export function formatSimClock(t: number): string {
  const total = SERVICE_START_SECONDS + Math.max(0, Math.floor(t));
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A saving as a signed percentage: `+3.1%`, `−0.4%`, or an em dash when unmeasured. */
export function formatSignedPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : '+';
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/** A cut as a negative percentage: a 40-point cut in excess wait reads `−40%`. */
export function formatCutPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '−' : '+';
  return `${sign}${Math.abs(Math.round(value))}%`;
}

/** The corridor the scene opens on: the city trunk when the model has one, else the first. */
export function defaultCorridorIndex(corridors: readonly LiveCorridorModel[]): number {
  const urban = corridors.findIndex((corridor) => corridor.presetId === 'urban');
  return urban >= 0 ? urban : 0;
}

type ReadingTone = 'warn' | 'danger' | 'good';

const TONE_CLASS: Record<ReadingTone, string> = {
  warn: 'text-warning',
  danger: 'text-destructive',
  good: 'text-success',
};

/**
 * A label over a value. The value is foreground ink unless a tone says
 * otherwise, and a tone is only ever given when the number means something
 * - open incidents above zero, a saving above zero - so colour is a weight
 * on a reading, never the reading itself.
 */
function Reading({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: ReadingTone | null;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="sc-label leading-snug">{label}</div>
      <div
        className={cn(
          'truncate font-mono text-sm tabular-nums text-foreground',
          tone ? TONE_CLASS[tone] : null,
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function LiveTrialScene({ model }: { model: LiveTrialModel }) {
  const [corridorIndex, setCorridorIndex] = useState(() => defaultCorridorIndex(model.corridors));
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [arm, setArm] = useState<ReplayArm>('controlled');
  const [followedId, setFollowedId] = useState<string | null>(null);

  const corridor = model.corridors[corridorIndex] ?? model.corridors[0] ?? null;
  const scenario = corridor?.scenarios[scenarioIndex] ?? corridor?.scenarios[0] ?? null;
  const span = useMemo(() => (scenario ? replayWindow(scenario) : NO_WINDOW), [scenario]);
  const { clock, toggle, seek, setSpeed } = useReplayClock(span.end - span.start);
  /** Absolute trial time: what the trajectories, the lanes and the sim clock speak. */
  const t = span.start + clock.t;

  const ctx = useMemo<ReplayContext | null>(
    () =>
      corridor
        ? {
            route: corridor.route,
            trialCorridorLengthMeters: corridor.trialCorridorLengthMeters,
            targetHeadwaySeconds: corridor.targetHeadwaySeconds,
            bunchedThresholdRatio: corridor.bunchedThresholdRatio,
            warningThresholdRatio: corridor.warningThresholdRatio,
          }
        : null,
    [corridor],
  );

  const frame = useMemo(
    () => (scenario && ctx ? frameAt(scenario, arm, t, ctx) : emptyFrame(t)),
    [scenario, arm, t, ctx],
  );

  const toggleFollow = useCallback((id: string) => {
    setFollowedId((current) => (current === id ? null : id));
  }, []);

  const seekAbsolute = useCallback(
    (absolute: number) => seek(absolute - span.start),
    [seek, span.start],
  );

  const chooseCorridor = (index: number) => {
    setCorridorIndex(index);
    setScenarioIndex(0);
    setFollowedId(null);
    seek(0);
  };

  const chooseScenario = (index: number) => {
    setScenarioIndex(index);
    setFollowedId(null);
    seek(0);
  };

  if (!corridor) {
    return (
      <div className="relative flex min-h-[100svh] items-center justify-center p-6">
        <div className="sc-panel px-6 py-4 text-sm text-muted-foreground">No replay data</div>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-[100svh] grid-cols-1 gap-4 bg-background p-6 pt-20 lg:grid-cols-[360px_1fr]">
      <section
        aria-label="Live trial"
        className="sc-panel flex flex-col gap-4 p-4 lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto"
      >
        <div>
          <p className="sc-label">Live trial · {corridor.route.city}</p>
          <h2 className="sc-display mt-1 text-xl font-semibold text-foreground">
            {corridor.route.name}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-x-4">
            <Reading
              label="Passenger time"
              value={formatSignedPercent(corridor.netPercent)}
              tone={corridor.netPercent > 0 ? 'good' : null}
            />
            <Reading
              label="Excess wait"
              value={formatCutPercent(corridor.excessWaitPercent)}
              tone={corridor.excessWaitPercent > 0 ? 'good' : null}
            />
          </div>
        </div>

        <div role="group" aria-label="Corridor" className="flex flex-wrap gap-1.5">
          {model.corridors.map((entry, index) => (
            <button
              key={entry.presetId}
              type="button"
              className="sc-button"
              aria-pressed={index === corridorIndex}
              onClick={() => chooseCorridor(index)}
            >
              <span className="flex flex-col items-start gap-0.5 text-left">
                <span>{entry.name}</span>
                <span className="sc-label text-[10px]">{entry.shape}</span>
              </span>
            </button>
          ))}
        </div>

        <div>
          {corridor.scenarios.length > 0 ? (
            <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
              {corridor.scenarios.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  className="sc-button"
                  aria-pressed={index === scenarioIndex}
                  onClick={() => chooseScenario(index)}
                >
                  {entry.title}
                </button>
              ))}
            </div>
          ) : null}
          {scenario ? (
            <>
              <p className="mt-3 text-sm font-medium text-foreground">{scenario.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{scenario.note}</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No replay data for this route</p>
          )}
        </div>

        <div role="group" aria-label="Arm" className="flex gap-1.5">
          {ARMS.map((entry) => (
            <button
              key={entry}
              type="button"
              className="sc-button"
              aria-pressed={entry === arm}
              onClick={() => setArm(entry)}
            >
              {ARM_LABEL[entry]}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="Live readings"
          className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4"
        >
          <Reading label="Sim clock" value={formatSimClock(t)} />
          <Reading label="Buses live" value={frame.busesLive} />
          <Reading
            label="Open incidents"
            value={frame.openIncidents}
            tone={frame.openIncidents > 0 ? 'warn' : null}
          />
          <Reading
            label="Bunched pairs"
            value={frame.bunchedPairs}
            tone={frame.bunchedPairs > 0 ? 'danger' : null}
          />
          <Reading
            label="Holds served"
            value={frame.holdsServed}
            tone={frame.holdsServed > 0 ? 'good' : null}
          />
        </div>

        {scenario ? (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="sc-button-primary"
                onClick={toggle}
                aria-label={clock.playing ? 'Pause the replay' : 'Play the replay'}
              >
                {clock.playing ? (
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Play className="h-3.5 w-3.5" aria-hidden />
                )}
                {clock.playing ? 'Pause' : 'Play'}
              </button>

              <div role="group" aria-label="Replay speed" className="flex gap-1">
                {REPLAY_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className="sc-button"
                    aria-pressed={clock.speed === speed}
                    onClick={() => setSpeed(speed)}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
            </div>

            <div role="group" aria-label="Scenario readings" className="grid grid-cols-3 gap-x-4">
              <Reading
                label="Passenger time"
                value={formatSignedPercent(scenario.netPercent)}
                tone={scenario.netPercent !== null && scenario.netPercent > 0 ? 'good' : null}
              />
              <Reading
                label="Excess wait"
                value={formatCutPercent(scenario.excessWaitPercent)}
                tone={
                  scenario.excessWaitPercent !== null && scenario.excessWaitPercent > 0
                    ? 'good'
                    : null
                }
              />
              <Reading label="Incidents avoided" value={scenario.incidentsAvoided} />
            </div>
          </div>
        ) : null}
      </section>

      <div className="flex min-h-0 flex-col gap-3">
        <div className="sc-panel relative min-h-[420px] flex-1 overflow-hidden">
          <CorridorMap
            route={corridor.route}
            frame={frame}
            arm={arm}
            followedId={followedId}
            onSelect={toggleFollow}
          />
        </div>
        {scenario ? (
          <ReplayLanes
            scenario={scenario}
            t={t}
            windowStart={span.start}
            windowEnd={span.end}
            trialCorridorLengthMeters={corridor.trialCorridorLengthMeters}
            stationNames={corridor.stationNames}
            onSeek={seekAbsolute}
            className="h-[200px] shrink-0"
          />
        ) : null}
      </div>
    </div>
  );
}
