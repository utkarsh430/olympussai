// In-memory runtime state, rehydrated from the database on boot
// (docs/CONTROL_SERVICE_DEPLOYMENT.md "CI/CD pipeline" step 5). This is
// what makes a Render rolling-deploy restart safe: the new instance does
// not report /readyz healthy - and therefore receives no traffic - until
// this store has been populated from CONTROL_SERVICE_DATABASE_URL.
export interface VehicleStateRow {
  vehicleId: string;
  tripId: string | null;
  routeDirectionId: string | null;
  distanceAlongRouteMeters: number | null;
  speedKmph: number | null;
  stopState: string;
  currentStopId: string | null;
  confidence: number | null;
  observedAt: string;
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
}

export type RehydrationStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

class ControlStateStore {
  private vehicleStates = new Map<string, VehicleStateRow>();
  private headwayStatesByRouteDirection = new Map<string, HeadwayStateRow[]>();
  private activePoliciesByRouteDirection = new Map<string, RoutePolicyRow[]>();
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

  loadVehicleStates(rows: VehicleStateRow[]): void {
    this.vehicleStates = new Map(rows.map((r) => [r.vehicleId, r]));
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
    this._status = 'pending';
    this._rehydratedAt = undefined;
    this._lastError = undefined;
  }
}

export const stateStore = new ControlStateStore();
