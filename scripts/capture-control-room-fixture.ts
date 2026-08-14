/**
 * Capture a real control-room fixture from a running control service.
 *
 * The review harness (scripts/preview-control-room.tsx) stubs the network, and
 * a stub full of invented corridors and made-up registration numbers would be
 * a poor thing to judge a console by - the whole point of this phase is that
 * the screen shows real operations. So the fixture is captured from a live
 * control service rather than written by hand.
 *
 * READ-ONLY, and deliberately so. It issues four GETs and one POST
 * /v1/mpc/solve, which mutates nothing (the solve reads the in-memory state
 * store plus one SELECT on `commands`). It never writes, and it must never be
 * given a reason to.
 *
 *   CONTROL_SERVICE_BASE_URL=... CONTROL_SERVICE_SERVICE_TOKEN=... \
 *     pnpm tsx --tsconfig scripts/tsconfig.preview.json \
 *     scripts/capture-control-room-fixture.ts > scripts/preview-control-room-data.json
 *
 * The token is read from the environment and never written to the output.
 */
const BASE = process.env.CONTROL_SERVICE_BASE_URL;
const TOKEN = process.env.CONTROL_SERVICE_SERVICE_TOKEN;

if (!BASE || !TOKEN) {
  throw new Error('CONTROL_SERVICE_BASE_URL and CONTROL_SERVICE_SERVICE_TOKEN are required.');
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
  return (await response.json()) as T;
}

async function solve(routeDirectionId: string): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(`${BASE}/v1/mpc/solve`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ routeDirectionId }),
  });
  return { ok: response.ok, body: await response.json() };
}

interface RouteDirection {
  routeDirectionId: string;
  routeId: string;
  directionCode: string;
  isLoop: boolean;
  totalDistanceMeters: number;
}

interface VehicleState {
  vehicleId: string;
  position: { latitude: number; longitude: number } | null;
  headingDegrees: number | null;
  speedKmph: number | null;
  stopState: string;
  routeDirectionId: string;
  observedAt: string;
}

async function main() {
  const { routeDirections } = await get<{ routeDirections: RouteDirection[] }>('/v1/route-directions');
  const { snapshots } = await get<{ snapshots: Record<string, unknown>[] }>('/v1/kpi/daily');

  // Corridors that have a daily roll-up are the ones with an active policy, so
  // they are the ones the engine can actually be asked about.
  const withHistory = snapshots
    .map((row) => String(row.routeDirectionId))
    .filter((id) => routeDirections.some((rd) => rd.routeDirectionId === id));

  let liveSolve: unknown = null;
  let solvedCorridor: string | null = null;
  for (const id of withHistory.slice(0, 12)) {
    const attempt = await solve(id);
    const body = attempt.body as { candidateActions?: unknown[] };
    if (attempt.ok && (body.candidateActions?.length ?? 0) > 0) {
      liveSolve = attempt.body;
      solvedCorridor = id;
      break;
    }
  }
  if (!solvedCorridor) throw new Error('no corridor produced a solve with candidates');

  const { vehicleStates } = await get<{ vehicleStates: VehicleState[] }>(
    `/v1/vehicle-states?routeDirectionId=${encodeURIComponent(solvedCorridor)}`,
  );
  let headway: unknown = null;
  try {
    const result = await get<{ aggregate: unknown }>(
      `/v1/route-directions/${encodeURIComponent(solvedCorridor)}/headway`,
    );
    headway = result.aggregate;
  } catch {
    headway = null;
  }

  const solvedMeta = routeDirections.find((rd) => rd.routeDirectionId === solvedCorridor)!;

  process.stdout.write(
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        // The solved corridor first, so the harness opens on the one the
        // captured solve actually describes.
        corridors: [solvedMeta, ...routeDirections.filter((rd) => rd.routeDirectionId !== solvedCorridor).slice(0, 20)],
        liveSolve,
        kpiRow: snapshots.find((row) => row.routeDirectionId === solvedCorridor) ?? null,
        headway,
        vehicles: vehicleStates
          .filter((state) => state.position !== null)
          .slice(0, 400)
          .map((state) => ({
            id: state.vehicleId,
            registrationNumber: state.vehicleId,
            latitude: state.position!.latitude,
            longitude: state.position!.longitude,
            headingDegrees: state.headingDegrees,
            dataQuality: 'good',
            depotName: null,
            routeName: null,
            speedKmph: state.speedKmph,
            stopState: state.stopState,
            routeDirectionId: state.routeDirectionId,
            positionSource: 'control-service',
            observedAt: state.observedAt,
          })),
      },
      null,
      2,
    )}\n`,
  );
}

void main();
