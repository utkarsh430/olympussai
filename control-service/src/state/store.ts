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
  /** route_policies.prediction_horizon_control_points (Appendix C "prediction horizon"). Used to label/scale the occupancy-weighted MPC advisory, not to run a true multi-step solve yet. */
  predictionHorizonControlPoints: number;
  /** route_policies.occupancy_stale_seconds - an occupancy sample older than this is not "live" for MPC weighting purposes and the advisory must fall back to an estimated load instead of trusting it. Null means no configured limit (occupancy is never treated as fresh). */
  occupancyStaleSeconds: number | null;
  /** route_policies.occupancy_capacity - denominator for load fraction. Null means capacity is unknown for this route-direction, so occupancy weighting falls back to an estimated mid-load fraction. */
  occupancyCapacity: number | null;
}

export type RehydrationStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

class ControlStateStore {
  private vehicleStates = new Map<string, VehicleStateRow>();
  private headwayStatesByRouteDirection = new Map<string, HeadwayStateRow[]>();
  private activePoliciesByRouteDirection = new Map<string, RoutePolicyRow[]>();
  /** route-direction -> the stop_id at sequence 0 in route_direction_stops, i.e. its origin terminal (blueprint 8.2 "Algorithm A - Terminal dispatch regulation": "at the origin, regulate actual departure headway"). */
  private terminalStopByRouteDirection = new Map<string, string>();
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
    this._status = 'pending';
    this._rehydratedAt = undefined;
    this._lastError = undefined;
  }
}

export const stateStore = new ControlStateStore();
