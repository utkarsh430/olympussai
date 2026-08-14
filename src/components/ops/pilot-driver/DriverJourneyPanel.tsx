'use client';

import { useCallback, useEffect, useState } from 'react';
import { OpsAlert, OpsBadge, OpsPanel } from '@/components/ops/ui';
import { DriverRouteMap } from './DriverRouteMap';
import { StopArrivalList } from './StopArrivalList';
import type { JourneyStop } from '@/lib/ops/driverJourney';
import { describeSpeedBasis, freshnessNote } from '@/lib/ops/driverJourneyView';

/**
 * The driver's route: where the bus is, which stops are next, and when the
 * system thinks it will reach them - or why it cannot say.
 *
 * ─── POLLING, NOT CACHING ────────────────────────────────────────────────
 *
 * Every number here is relative to the response's own `generatedAt`, and the
 * model does not track the bus between polls. So this re-polls on a fixed
 * interval and never caches: a stored countdown is one computed from a
 * position that was already minutes old, re-served later with nothing on the
 * wire to say so.
 *
 * 20 s rather than the command console's 4 s. The console's interval is set by
 * a command TTL a driver must answer inside; a route ahead does not change
 * meaningfully in four seconds, and the arrival endpoint does real work per
 * call (a route-direction stop read plus a peer-speed scan). This is the
 * cheaper cadence that still keeps every displayed number inside its own
 * freshness bound.
 */
const POLL_INTERVAL_MS = 20_000;
/** Re-render this often so the displayed minutes tick down between polls. */
const TICK_INTERVAL_MS = 5_000;

interface JourneyResponse {
  vehicleId: string;
  generatedAt: string;
  horizonSeconds: number;
  stopLimit: number;
  prediction: PredictionContext;
  stops: JourneyStop[];
  schedule: {
    routeName: string | null;
    originName: string | null;
    destinationName: string | null;
    source: string;
    stale: boolean;
  } | null;
}

type PredictionContext =
  | {
      status: 'unavailable';
      reason: string;
      detail: string;
      observedAt: string | null;
      stateAgeSeconds: number | null;
    }
  | {
      status: 'available';
      routeDirectionId: string;
      observedAt: string;
      stateAgeSeconds: number;
      vehicle: {
        distanceAlongRouteMeters: number;
        matchConfidence: number;
        stopState: string;
        currentStopId: string | null;
        latitude: number | null;
        longitude: number | null;
      };
      speed: { basis: 'vehicle_smoothed_speed' | 'route_peer_median_speed'; speedKmph: number };
      dwell: { measured: false; secondsPerIntermediateStop: number };
    };

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: JourneyResponse }
  /**
   * The service could not be reached at all. Kept SEPARATE from a prediction
   * refusal on purpose - rule 9. "Nobody looked" and "we looked and cannot
   * predict this bus" are different facts, and rendering an outage as a calm
   * "no arrival times right now" would tell a driver the system is working
   * when it is not.
   */
  | { status: 'outage'; message: string }
  /** No bus on this account. Terminal: polling stops, because it cannot resolve itself. */
  | { status: 'unassigned'; message: string };

export function DriverJourneyPanel() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Bumped on a timer so the minutes shown re-derive from the clock between
  // polls. The numbers themselves still come from the last response.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/ops/pilot-driver/journey', { cache: 'no-store' });

      if (response.status === 409) {
        const body = await response.json().catch(() => null);
        setState({
          status: 'unassigned',
          message: body?.error?.message ?? 'No vehicle is assigned to your account yet.',
        });
        return;
      }

      if (!response.ok) {
        setState({
          status: 'outage',
          message:
            'Arrival times cannot be reached right now. This is a problem with the system, not with your bus.',
        });
        return;
      }

      setState({ status: 'ready', data: (await response.json()) as JourneyResponse });
    } catch {
      setState({
        status: 'outage',
        message: 'Arrival times cannot be reached right now. Check your signal.',
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) load();
    };
    run();
    const poll = setInterval(run, POLL_INTERVAL_MS);
    const tick = setInterval(() => setTick((n) => n + 1), TICK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  // Terminal: an unassigned account cannot fix itself by polling harder, and a
  // driver reading this needs an instruction, not a spinner.
  if (state.status === 'unassigned') {
    return (
      <OpsPanel title="Your route" headingLevel={2}>
        <OpsAlert tone="warning" title="No bus assigned to you yet">
          <p className="text-base leading-relaxed">{state.message}</p>
        </OpsAlert>
      </OpsPanel>
    );
  }

  if (state.status === 'loading') {
    return (
      <OpsPanel title="Your route" headingLevel={2}>
        <p className="py-6 text-center text-base text-muted-foreground">Loading your route…</p>
      </OpsPanel>
    );
  }

  if (state.status === 'outage') {
    return (
      <OpsPanel title="Your route" headingLevel={2}>
        <OpsAlert tone="error" title="Arrival times are not available">
          <p className="text-base leading-relaxed">{state.message}</p>
          <p className="mt-2 text-sm text-muted-foreground">Trying again automatically.</p>
        </OpsAlert>
      </OpsPanel>
    );
  }

  const { data } = state;
  const prediction = data.prediction;
  const routeLabel =
    data.schedule?.routeName ??
    [data.schedule?.originName, data.schedule?.destinationName].filter(Boolean).join(' - ') ??
    null;

  return (
    <div className="space-y-4">
      <OpsPanel
        title="Your route"
        headingLevel={2}
        description={routeLabel ?? undefined}
        actions={
          prediction.status === 'available' ? (
            <OpsBadge variant="live">Live</OpsBadge>
          ) : (
            <OpsBadge variant="neutral">No times</OpsBadge>
          )
        }
        bodyClassName="space-y-4"
      >
        {prediction.status === 'available' ? (
          <>
            <DriverRouteMap
              vehicleId={data.vehicleId}
              position={
                prediction.vehicle.latitude !== null && prediction.vehicle.longitude !== null
                  ? {
                      latitude: prediction.vehicle.latitude,
                      longitude: prediction.vehicle.longitude,
                    }
                  : null
              }
              observedAt={prediction.observedAt}
              stateAgeSeconds={prediction.stateAgeSeconds}
              routeName={routeLabel}
              stops={data.stops}
            />

            {/* Rules 4, 5 and 7, in one line under the map: where the speed
                came from, that dwell is modelled, and how old the fix is.
                Kept together because they are the three things that qualify
                every number in the list below. */}
            <ProvenanceLine
              speedBasis={prediction.speed.basis}
              speedKmph={prediction.speed.speedKmph}
              stateAgeSeconds={prediction.stateAgeSeconds}
              dwellSeconds={prediction.dwell.secondsPerIntermediateStop}
              anyScheduled={data.stops.some((stop) => stop.scheduled?.arrival)}
            />
          </>
        ) : (
          <OpsAlert tone="info" title="No arrival times for your bus right now">
            {/* `detail` is written by the service in plain language for exactly
                this purpose, so it is shown verbatim rather than re-worded
                into something vaguer here. */}
            <p className="text-base leading-relaxed">{prediction.detail}</p>
          </OpsAlert>
        )}
      </OpsPanel>

      <StopArrivalList
        stops={data.stops}
        generatedAt={data.generatedAt}
        predictionAvailable={prediction.status === 'available'}
      />
    </div>
  );
}

function ProvenanceLine({
  speedBasis,
  speedKmph,
  stateAgeSeconds,
  dwellSeconds,
  anyScheduled,
}: {
  speedBasis: 'vehicle_smoothed_speed' | 'route_peer_median_speed';
  speedKmph: number;
  stateAgeSeconds: number;
  dwellSeconds: number;
  /** True when at least one stop below carries a published time worth explaining. */
  anyScheduled: boolean;
}) {
  const speed = describeSpeedBasis(speedBasis);
  const freshness = freshnessNote(stateAgeSeconds);

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <p className={speed.weaker ? 'text-sm text-warning' : 'text-sm text-muted-foreground'}>
        <span className="font-mono tabular-nums text-foreground">{speedKmph.toFixed(0)} km/h</span>
        {' - '}
        {speed.label}
      </p>
      <p
        className={
          freshness.tone === 'warn' ? 'text-sm text-warning' : 'text-sm text-muted-foreground'
        }
      >
        {freshness.label}
      </p>
      <p className="text-sm text-subtle">
        Waiting time at each stop is an estimate of {dwellSeconds}s, not a measurement.
      </p>
      {/* Said once, here, rather than on all six rows. Only shown when there is
          actually a published time below to explain. */}
      {anyScheduled && (
        <p className="text-sm text-subtle">
          <span className="text-warning">Timetable</span> times are the published schedule, not a
          measurement of where your bus is.
        </p>
      )}
    </div>
  );
}
