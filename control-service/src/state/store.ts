// In-memory runtime state, rehydrated from the database on boot
// (docs/CONTROL_SERVICE_DEPLOYMENT.md "CI/CD pipeline" step 5). This is
// what makes a Render rolling-deploy restart safe: the new instance does
// not report /readyz healthy - and therefore receives no traffic - until
// this store has been populated from CONTROL_SERVICE_DATABASE_URL.
export interface VehicleStateRow {
  vehicleId: string;
  tripId: string | null;
  routeDirectionId: string | null;
  /**
   * Raw GPS fix (vehicle_states.position). Present so a
   * VehicleStateEstimate can be mirrored into this store losslessly -
   * without it, /v1/vehicle-states had no choice but to hardcode
   * `position: null`.
   */
  position: { lat: number; lon: number } | null;
  distanceAlongRouteMeters: number | null;
  speedKmph: number | null;
  headingDegrees: number | null;
  stopState: string;
  currentStopId: string | null;
  confidence: number | null;
  /** vehicle_states.is_low_confidence - a flagged vehicle is excluded from the leader/follower chain rather than silently trusted. */
  isLowConfidence: boolean;
  observedAt: string;
  /** Raw passenger count from the last onboard count sample, when the ingestion path reports one (blueprint 8.6 "occupancy is central" - schema column `vehicle_states.occupancy_count`). Null when unknown; the MPC occupancy weighting treats that as "estimated" rather than failing closed. */
  occupancyCount: number | null;
  /** Coarse load-band label alongside the count, when supplied by upstream (e.g. 'light' | 'moderate' | 'full'); not validated here, just passed through. */
  occupancyLoadBand: string | null;
}

export interface HeadwayStateRow {
  id: string;
  routeDirectionId: string;
  leaderVehicleId: string;
  followerVehicleId: string;
  hFwdSeconds: number | null;
  /** Backward headway of `followerVehicleId` - the gap to the bus behind it, at that bus's pace. Null when nothing is behind it. See headway/metrics.ts. */
  hBwdSeconds: number | null;
  targetHeadwaySeconds: number;
  deviationSeconds: number | null;
  computedAt: string;
}

export interface RoutePolicyRow {
  id: string;
  routeDirectionId: string;
  operatingPeriod: string;
  dayType: string;
  targetHeadwaySeconds: number;
  bunchedThresholdRatio: number;
  warningThresholdRatio: number;
  kf: number | null;
  kb: number | null;
  selfEqualizingK: number | null;
  maxHoldSeconds: number;
  cooldownSeconds: number;
  /** route_policies.minimum_action_seconds - the shortest hold worth issuing. Enforced by mpc/safety.ts as `below_minimum_action`; a hold under it costs more in driver and dispatcher attention than it buys. */
  minimumActionSeconds: number;
  /** route_policies.prediction_horizon_control_points (Appendix C "prediction horizon"). Used to label/scale the occupancy-weighted MPC advisory, not to run a true multi-step solve yet. */
  predictionHorizonControlPoints: number;
  /** route_policies.occupancy_stale_seconds - an occupancy sample older than this is not "live" for MPC weighting purposes and the advisory must fall back to an estimated load instead of trusting it. Null means no configured limit (occupancy is never treated as fresh). */
  occupancyStaleSeconds: number | null;
  /** route_policies.occupancy_capacity - denominator for load fraction. Null means capacity is unknown for this route-direction, so occupancy weighting falls back to an estimated mid-load fraction. */
  occupancyCapacity: number | null;
  /** route_policies.ks - gain on schedule deviation in the two-way and terminal-dispatch laws. Null disables the term, leaving pure-headway control. See schedule/deviation.ts. */
  ks: number | null;
  /** route_policies.max_lateness_seconds - hard bound on the lateness a hold may cause, enforced by mpc/safety.ts. Null means unbounded, which is the deployed state while no timetable exists to measure lateness against. */
  maxLatenessSeconds: number | null;
  /** route_policies.speed_band_min_kmph - the slowest pace `mpc/paceGuidance.ts` may advise on this corridor. Null means no configured floor, so only the module's own relative floor applies. */
  speedBandMinKmph: number | null;
  /** route_policies.speed_band_max_kmph - the fastest pace guidance may name. Pace guidance never advises speeding up, so this only ever binds as a sanity ceiling. */
  speedBandMaxKmph: number | null;
  /**
   * route_policies.max_concurrent_actions - most simultaneous holds the
   * solver may propose for this corridor in one cycle
   * (mpc/solver.ts#selectActions).
   *
   * Optional on this shape rather than required, because a policy row written
   * before the column existed rehydrates without it and the solver's own
   * default then applies. An operational limit on what a control room can
   * absorb, never a claim about how many corridors need help.
   */
  maxConcurrentActions?: number | null;
  /**
   * route_policies.alighting_only_enabled - whether this corridor may be
   * OFFERED alighting-only proposals (mpc/boardingLimit.ts).
   *
   * Optional on this shape, and absent is read as FALSE rather than as "the
   * module default applies" - the opposite of `maxConcurrentActions` above,
   * deliberately. A policy row written before the column existed, or a
   * synthetic policy in a test, must not acquire the one action in this system
   * whose cost is paid visibly by passengers at a kerb. Absent means off.
   */
  alightingOnlyEnabled?: boolean | null;
  /**
   * route_policies.alighting_only_max_refusals - the refusal tripwire's bound.
   *
   * Most alighting-only instructions this corridor may have issued inside
   * `alightingOnlyRefusalWindowSeconds` before the law stops offering more.
   * Absent falls back to `mpc/boardingLimit.ts#DEFAULT_MAX_REFUSALS_PER_WINDOW`,
   * never to "unbounded": the bound is what makes enabling the law a bounded
   * experiment rather than an open one.
   */
  alightingOnlyMaxRefusals?: number | null;
  /** route_policies.alighting_only_refusal_window_seconds - the tripwire's rolling window. Absent falls back to `DEFAULT_REFUSAL_WINDOW_SECONDS`. */
  alightingOnlyRefusalWindowSeconds?: number | null;
}

export type RehydrationStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

/** Shared empty set, so a corridor with no configured control points does not allocate one per lookup. */
const EMPTY_STOP_SET: ReadonlySet<string> = new Set<string>();

class ControlStateStore {
  private vehicleStates = new Map<string, VehicleStateRow>();
  private headwayStatesByRouteDirection = new Map<string, HeadwayStateRow[]>();
  private activePoliciesByRouteDirection = new Map<string, RoutePolicyRow[]>();
  /** route-direction -> the stop_id at sequence 0 in route_direction_stops, i.e. its origin terminal (blueprint 8.2 "Algorithm A - Terminal dispatch regulation": "at the origin, regulate actual departure headway"). */
  private terminalStopByRouteDirection = new Map<string, string>();
  /** route-direction -> the stop_ids flagged `route_direction_stops.is_control_point`. Where a hold may actually be executed (mpc/eligibility.ts). An absent or empty set means the corridor has designated none, which is read as "any stop" rather than "no stop". */
  private controlPointStopsByRouteDirection = new Map<string, Set<string>>();
  /**
   * route-direction -> stop_id -> how many stops remain from it to the end of
   * the route-direction, counting itself.
   *
   * The horizon the objective's waiting term is summed over
   * (`mpc/objective.ts`). Stored as the ANSWER rather than as the sequence,
   * because "stops left" is the only question anything asks of it and
   * `route_direction_stops.sequence` is not guaranteed dense - a corridor
   * whose stops are numbered 0, 10, 20 would make `count - sequence`
   * nonsense.
   */
  private downstreamStopsByRouteDirection = new Map<string, Map<string, number>>();
  private _status: RehydrationStatus = 'pending';
  private _rehydratedAt: string | undefined;
  private _lastError: string | undefined;

  get status(): RehydrationStatus {
    return this._status;
  }

  get isReady(): boolean {
    return this._status === 'complete';
  }

  get rehydratedAt(): string | undefined {
    return this._rehydratedAt;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  setStatus(status: RehydrationStatus, error?: string): void {
    this._status = status;
    if (status === 'complete') this._rehydratedAt = new Date().toISOString();
    if (status === 'failed') this._lastError = error;
  }

  /**
   * Boot-time WHOLESALE REPLACE of the vehicle-state map. Correct for
   * rehydration (the DB is the truth and this store is empty), and wrong
   * for anything incremental - calling it with a single row would delete
   * every other vehicle. Runtime updates must use upsertVehicleState.
   */
  loadVehicleStates(rows: VehicleStateRow[]): void {
    this.vehicleStates = new Map(rows.map((r) => [r.vehicleId, r]));
  }

  /**
   * Single-vehicle update for the live ingestion path.
   *
   * The staleness guard mirrors PgStateEstimationRepository.saveVehicleState's
   * `where vehicle_states.observed_at <= excluded.observed_at` conflict
   * clause EXACTLY, so this cache and that table can never disagree about
   * which of two out-of-order fixes won. A strict `>` (not `>=`) keeps a
   * redelivery of the same timestamp idempotent-but-applied, matching the
   * `<=` on the SQL side.
   */
  upsertVehicleState(row: VehicleStateRow): void {
    const existing = this.vehicleStates.get(row.vehicleId);
    if (existing && existing.observedAt > row.observedAt) return;
    this.vehicleStates.set(row.vehicleId, row);
  }

  loadHeadwayStates(rows: HeadwayStateRow[]): void {
    const grouped = new Map<string, HeadwayStateRow[]>();
    for (const row of rows) {
      const bucket = grouped.get(row.routeDirectionId) ?? [];
      bucket.push(row);
      grouped.set(row.routeDirectionId, bucket);
    }
    this.headwayStatesByRouteDirection = grouped;
  }

  /**
   * Replace one route-direction's headway slice after a compute cycle.
   *
   * The counterpart to upsertVehicleState, and needed for the same reason.
   * loadHeadwayStates() above replaces the WHOLE map and runs once, at boot,
   * from rehydrate.ts. Without this method the headway sweep persisted to
   * `headway_states` while stateStore kept its boot-time snapshot forever - so
   * mpc/solver.ts, which reads getHeadwayStates() and iterates it to build
   * terminal-dispatch and two-way candidates, saw an empty list and returned
   * zero candidates no matter how bunched the route actually was. The decision
   * engine was structurally unable to act on live data.
   *
   * Per-direction replacement, not a merge: one compute cycle yields the
   * complete current pair set for that route-direction, and a pair whose
   * follower has since moved on must disappear rather than linger. Passing an
   * empty array therefore correctly clears the direction.
   */
  upsertHeadwayStates(routeDirectionId: string, rows: HeadwayStateRow[]): void {
    if (rows.length === 0) {
      this.headwayStatesByRouteDirection.delete(routeDirectionId);
      return;
    }
    this.headwayStatesByRouteDirection.set(routeDirectionId, rows);
  }

  loadActivePolicies(rows: RoutePolicyRow[]): void {
    const grouped = new Map<string, RoutePolicyRow[]>();
    for (const row of rows) {
      const bucket = grouped.get(row.routeDirectionId) ?? [];
      bucket.push(row);
      grouped.set(row.routeDirectionId, bucket);
    }
    this.activePoliciesByRouteDirection = grouped;
  }

  loadTerminalStops(rows: { routeDirectionId: string; stopId: string }[]): void {
    this.terminalStopByRouteDirection = new Map(rows.map((r) => [r.routeDirectionId, r.stopId]));
  }

  loadControlPointStops(rows: { routeDirectionId: string; stopId: string }[]): void {
    const byDirection = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = byDirection.get(row.routeDirectionId) ?? new Set<string>();
      set.add(row.stopId);
      byDirection.set(row.routeDirectionId, set);
    }
    this.controlPointStopsByRouteDirection = byDirection;
  }

  /**
   * Boot-time load of every route-direction's stop sequence, reduced to the
   * one thing the control laws ask of it.
   *
   * Ordered HERE by `sequence` rather than trusted from the query, so a
   * reader of `db/rehydrate.ts` cannot silently break the horizon by dropping
   * an `order by` - the same defensiveness `loadTerminalStops` gets from
   * `distinct on ... order by sequence asc`.
   */
  loadStopSequences(rows: { routeDirectionId: string; stopId: string; sequence: number }[]): void {
    const byDirection = new Map<string, { stopId: string; sequence: number }[]>();
    for (const row of rows) {
      const bucket = byDirection.get(row.routeDirectionId) ?? [];
      bucket.push({ stopId: row.stopId, sequence: row.sequence });
      byDirection.set(row.routeDirectionId, bucket);
    }
    const reduced = new Map<string, Map<string, number>>();
    for (const [routeDirectionId, stops] of byDirection) {
      stops.sort((a, b) => a.sequence - b.sequence);
      const counts = new Map<string, number>();
      stops.forEach((stop, index) => counts.set(stop.stopId, stops.length - index));
      reduced.set(routeDirectionId, counts);
    }
    this.downstreamStopsByRouteDirection = reduced;
  }

  /**
   * How many stops a vehicle standing at `stopId` still has to serve,
   * counting that one.
   *
   * NULL, never a fallback, when the corridor's sequence is not loaded or the
   * stop is not on it: `mpc/objective.ts` prices a null horizon as the
   * one-stop term it has always used, and inventing a length here would put a
   * guessed multiplier on every candidate that corridor ever scores.
   */
  getDownstreamStopCount(routeDirectionId: string, stopId: string | null): number | null {
    if (stopId === null) return null;
    return this.downstreamStopsByRouteDirection.get(routeDirectionId)?.get(stopId) ?? null;
  }

  getControlPointStopIds(routeDirectionId: string): ReadonlySet<string> {
    return this.controlPointStopsByRouteDirection.get(routeDirectionId) ?? EMPTY_STOP_SET;
  }

  getTerminalStopId(routeDirectionId: string): string | undefined {
    return this.terminalStopByRouteDirection.get(routeDirectionId);
  }

  getVehicleState(vehicleId: string): VehicleStateRow | undefined {
    return this.vehicleStates.get(vehicleId);
  }

  listVehicleStates(routeDirectionId?: string): VehicleStateRow[] {
    const all = Array.from(this.vehicleStates.values());
    return routeDirectionId ? all.filter((v) => v.routeDirectionId === routeDirectionId) : all;
  }

  getHeadwayStates(routeDirectionId: string): HeadwayStateRow[] {
    return this.headwayStatesByRouteDirection.get(routeDirectionId) ?? [];
  }

  getActivePolicy(
    routeDirectionId: string,
    operatingPeriod = 'all',
    dayType = 'all',
  ): RoutePolicyRow | undefined {
    const candidates = this.activePoliciesByRouteDirection.get(routeDirectionId) ?? [];
    return (
      candidates.find((p) => p.operatingPeriod === operatingPeriod && p.dayType === dayType) ??
      candidates.find((p) => p.operatingPeriod === 'all' && p.dayType === 'all')
    );
  }

  counts(): { vehicleStates: number; routeDirectionsWithHeadway: number; activePolicies: number } {
    return {
      vehicleStates: this.vehicleStates.size,
      routeDirectionsWithHeadway: this.headwayStatesByRouteDirection.size,
      activePolicies: Array.from(this.activePoliciesByRouteDirection.values()).reduce(
        (sum, arr) => sum + arr.length,
        0,
      ),
    };
  }

  /** Test-only: reset to a pristine state between test cases. */
  _resetForTests(): void {
    this.vehicleStates.clear();
    this.headwayStatesByRouteDirection.clear();
    this.activePoliciesByRouteDirection.clear();
    this.terminalStopByRouteDirection.clear();
    this.controlPointStopsByRouteDirection.clear();
    this._status = 'pending';
    this._rehydratedAt = undefined;
    this._lastError = undefined;
  }
}

export const stateStore = new ControlStateStore();
