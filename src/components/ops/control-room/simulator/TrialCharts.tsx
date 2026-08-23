'use client';

/**
 * The three pictures a fleet trial is actually read from.
 *
 * ─── WHY THESE THREE ─────────────────────────────────────────────────────
 *
 * TIME-DISTANCE (a Marey diagram) is the only view in which bunching is
 * visible as the thing it is. A table of headway statistics can say "CV fell
 * from 0.57 to 0.44"; two buses converging into one line, and then not
 * converging, is the same fact in a form an operator recognises from the road.
 *
 * THE PASSENGER-TIME BALANCE is the trial's verdict, and it is diverging by
 * nature: waiting removed on one side, onboard delay added on the other, and
 * the honest answer is whichever is longer. Drawn as one number it would hide
 * the trade; drawn as two bars from a shared zero it cannot.
 *
 * HOLDS BY STATION says WHERE the controller does its work, which is the
 * question a planner asks next and the one that decides where a supervisor
 * needs to be standing.
 *
 * ─── COLOUR IS NEVER THE ONLY ENCODING ───────────────────────────────────
 *
 * Following this console's own rule (see the instrument-hue block in
 * globals.css). The two arms of the comparison are separated by POSITION -
 * two panels side by side - not by hue, so a colour-blind operator reads them
 * exactly as well as anyone else. The diverging balance carries its direction
 * in words above each bar. Held stops carry a ring as well as a fill.
 */
import { useId, useState } from 'react';
import { OpsPanel, OpsEmptyState } from '@/components/ops/ui';
import type { SweepSample, VehicleTrajectory } from '@/models/fleetTrial';

const PLOT = { width: 520, height: 300, left: 44, right: 12, top: 14, bottom: 26 };

function niceMinutes(seconds: number): string {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 60)}m`;
}

/**
 * One arm's time-distance panel.
 *
 * Every bus is one polyline: time across, distance along the route up. Buses
 * that bunch are lines that converge; a healthy corridor is a set of roughly
 * parallel lines. Stations are horizontal rules, because a hold can only
 * happen on one of them and a reader needs to see which.
 */
function MareyPanel({
  title,
  caption,
  trajectories,
  stations,
  totalDistanceMeters,
  horizonSeconds,
  tone,
}: {
  title: string;
  caption: string;
  trajectories: VehicleTrajectory[];
  stations: { name: string; cumulativeDistanceMeters: number }[];
  totalDistanceMeters: number;
  horizonSeconds: number;
  tone: 'baseline' | 'controlled';
}) {
  const clipId = useId();
  const [hovered, setHovered] = useState<string | null>(null);

  const innerW = PLOT.width - PLOT.left - PLOT.right;
  const innerH = PLOT.height - PLOT.top - PLOT.bottom;
  const x = (t: number) => PLOT.left + (horizonSeconds > 0 ? (t / horizonSeconds) * innerW : 0);
  const y = (d: number) =>
    PLOT.top + innerH - (totalDistanceMeters > 0 ? (d / totalDistanceMeters) * innerH : 0);

  // The trajectories are drawn in one recessive ink rather than one hue per
  // bus. Ten hues would imply ten identities that mean nothing - the reader is
  // looking at the SHAPE of the family of lines, not at bus number seven.
  const stroke = tone === 'controlled' ? 'var(--sim-controlled)' : 'var(--sim-baseline)';

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1">
        <span className="ops-eyebrow">{title}</span>
        <span className="ml-2 text-[11px] text-subtle">{caption}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title}: distance along the route against time, one line per bus`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PLOT.left} y={PLOT.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {/* Stations. Recessive: they are the frame, not the reading. */}
        {stations.map((station) => (
          <g key={station.name}>
            <line
              x1={PLOT.left}
              x2={PLOT.width - PLOT.right}
              y1={y(station.cumulativeDistanceMeters)}
              y2={y(station.cumulativeDistanceMeters)}
              stroke="var(--sim-grid)"
              strokeWidth={1}
            />
          </g>
        ))}
        <text x={4} y={y(totalDistanceMeters) + 4} className="fill-subtle text-[9px]">
          {Math.round(totalDistanceMeters / 1000)}km
        </text>
        <text x={4} y={y(0) + 4} className="fill-subtle text-[9px]">
          0
        </text>
        <line
          x1={PLOT.left}
          x2={PLOT.width - PLOT.right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--sim-axis)"
          strokeWidth={1}
        />
        <text x={PLOT.left} y={PLOT.height - 8} className="fill-subtle text-[9px]">
          0
        </text>
        <text x={PLOT.width - PLOT.right} y={PLOT.height - 8} textAnchor="end" className="fill-subtle text-[9px]">
          {niceMinutes(horizonSeconds)}
        </text>

        <g clipPath={`url(#${clipId})`}>
          {trajectories.map((vehicle) => {
            const d = vehicle.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)},${y(p.d)}`).join(' ');
            const isHovered = hovered === vehicle.vehicleId;
            return (
              <g key={vehicle.vehicleId}>
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={hovered && !isHovered ? 0.25 : 0.85}
                  vectorEffect="non-scaling-stroke"
                  onMouseEnter={() => setHovered(vehicle.vehicleId)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <title>{vehicle.vehicleId}</title>
                </path>
                {/* Where a hold was actually served. Ringed as well as filled,
                    so it reads without colour. */}
                {vehicle.points
                  .filter((p) => p.hold > 0)
                  .map((p, i) => (
                    <circle
                      key={`${vehicle.vehicleId}-hold-${i}`}
                      cx={x(p.t)}
                      cy={y(p.d)}
                      r={3.5}
                      fill="var(--sim-hold)"
                      stroke="var(--sim-surface)"
                      strokeWidth={1.5}
                    >
                      <title>{`${vehicle.vehicleId} held ${Math.round(p.hold)}s`}</title>
                    </circle>
                  ))}
              </g>
            );
          })}
        </g>
      </svg>
    </figure>
  );
}

export function MareyComparison({
  trajectories,
  stations,
  totalDistanceMeters,
  horizonSeconds,
}: {
  trajectories: { controlled: VehicleTrajectory[]; uncontrolled: VehicleTrajectory[] };
  stations: { name: string; cumulativeDistanceMeters: number }[];
  totalDistanceMeters: number;
  horizonSeconds: number;
}) {
  if (trajectories.controlled.length === 0 && trajectories.uncontrolled.length === 0) {
    return <OpsEmptyState>This scenario returned no vehicle traces to draw.</OpsEmptyState>;
  }
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <MareyPanel
        title="Left alone"
        caption="what the corridor does with nobody intervening"
        trajectories={trajectories.uncontrolled}
        stations={stations}
        totalDistanceMeters={totalDistanceMeters}
        horizonSeconds={horizonSeconds}
        tone="baseline"
      />
      <MareyPanel
        title="Under control"
        caption="the same day, the same seed, the deployed laws running"
        trajectories={trajectories.controlled}
        stations={stations}
        totalDistanceMeters={totalDistanceMeters}
        horizonSeconds={horizonSeconds}
        tone="controlled"
      />
    </div>
  );
}

/**
 * The trade, from a shared zero.
 *
 * Waiting removed points one way, onboard delay added points the other, and
 * whichever bar is longer is the answer. There is no third bar for the net:
 * the net IS the difference in the lengths, and adding it would let a reader
 * take the verdict without seeing what paid for it.
 */
export function PassengerBalance({
  waitSecondsSaved,
  onboardDelayImposed,
  netSeconds,
  netPercent,
}: {
  waitSecondsSaved: number;
  onboardDelayImposed: number;
  netSeconds: number;
  netPercent: number | null;
}) {
  const scale = Math.max(Math.abs(waitSecondsSaved), Math.abs(onboardDelayImposed), 1);
  const hours = (s: number) => `${Math.round(s / 3600).toLocaleString()} h`;
  const good = netSeconds >= 0;

  const Bar = ({
    label,
    seconds,
    direction,
  }: {
    label: string;
    seconds: number;
    direction: 'saved' | 'added';
  }) => (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm tabular-nums text-foreground">{hours(Math.abs(seconds))}</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full rounded-sm"
          style={{
            width: `${(Math.abs(seconds) / scale) * 100}%`,
            background: direction === 'saved' ? 'var(--sim-saved)' : 'var(--sim-added)',
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <Bar label="Waiting time removed at stations" seconds={waitSecondsSaved} direction="saved" />
      <Bar label="Delay added to people already aboard" seconds={onboardDelayImposed} direction="added" />
      <p className="pt-1 text-sm">
        <span className="text-muted-foreground">Net effect on total passenger time: </span>
        <span className={good ? 'font-semibold text-success' : 'font-semibold text-destructive'}>
          {good ? 'saved ' : 'cost '}
          {hours(Math.abs(netSeconds))}
          {netPercent === null ? '' : ` (${Math.abs(netPercent).toFixed(1)}%)`}
        </span>
      </p>
    </div>
  );
}

/** Where on the route the controller does its work. One series, one hue, magnitude only. */
export function StationHolds({
  stations,
}: {
  stations: { stopId: string; name: string; sequence: number; holdSeconds: number; holdCount: number }[];
}) {
  const max = Math.max(1, ...stations.map((s) => s.holdSeconds));
  if (stations.every((s) => s.holdSeconds === 0)) {
    return <OpsEmptyState>No hold was served at any station in this phase.</OpsEmptyState>;
  }
  return (
    <ul className="space-y-2">
      {stations.map((station) => (
        <li key={station.stopId} className="grid grid-cols-[8.5rem_1fr_5.5rem] items-center gap-3">
          <span className="truncate text-xs text-muted-foreground">{station.name}</span>
          <span className="h-2.5 w-full overflow-hidden rounded-sm bg-muted">
            <span
              className="block h-full rounded-sm"
              style={{ width: `${(station.holdSeconds / max) * 100}%`, background: 'var(--sim-hold)' }}
            />
          </span>
          <span className="text-right text-[11px] tabular-nums text-subtle">
            {Math.round(station.holdSeconds / 60).toLocaleString()} min · {station.holdCount}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * How much of the corridor was in trouble, minute by minute, on each arm.
 *
 * Two panels again rather than two lines on one plot - same reason as the
 * time-distance view, and it also keeps the y-scale honestly shared without
 * ever becoming a dual axis.
 */
export function SweepBands({
  sweeps,
  horizonSeconds,
}: {
  sweeps: { controlled: SweepSample[]; uncontrolled: SweepSample[] };
  horizonSeconds: number;
}) {
  const all = [...sweeps.controlled, ...sweeps.uncontrolled];
  if (all.length === 0) return null;
  const maxOpen = Math.max(1, ...all.map((s) => s.openIncidents));

  const Panel = ({ label, samples, tone }: { label: string; samples: SweepSample[]; tone: 'baseline' | 'controlled' }) => {
    const w = 520;
    const h = 90;
    const x = (t: number) => (horizonSeconds > 0 ? (t / horizonSeconds) * w : 0);
    const y = (v: number) => h - (v / maxOpen) * (h - 8);
    const d = samples.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.atSeconds)},${y(s.openIncidents)}`).join(' ');
    return (
      <figure className="min-w-0">
        <figcaption className="ops-eyebrow mb-1">{label}</figcaption>
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`${label}: open incidents over time`}>
          <path
            d={`${d} L${x(samples[samples.length - 1]?.atSeconds ?? 0)},${h} L${x(samples[0]?.atSeconds ?? 0)},${h} Z`}
            fill={tone === 'controlled' ? 'var(--sim-controlled-fill)' : 'var(--sim-baseline-fill)'}
          />
          <path
            d={d}
            fill="none"
            stroke={tone === 'controlled' ? 'var(--sim-controlled)' : 'var(--sim-baseline)'}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </figure>
    );
  };

  return (
    <OpsPanel
      title="Incidents open at once"
      description={`Peak ${maxOpen} concurrent. Same vertical scale on both panels.`}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Panel label="Left alone" samples={sweeps.uncontrolled} tone="baseline" />
        <Panel label="Under control" samples={sweeps.controlled} tone="controlled" />
      </div>
    </OpsPanel>
  );
}
