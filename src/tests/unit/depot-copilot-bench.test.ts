// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { handleCopilotPost } from '@/lib/depot/copilot/service/handle';
import { buildCopilotRuntime } from '@/lib/depot/copilot/service/runtime';

/**
 * Benchmark, not a test: OFF in the normal suite. Run it with
 *   DEPOT_COPILOT_BENCH=1 npx vitest run src/tests/unit/depot-copilot-bench.test.ts
 * It times the scripted answer end to end through the service (limits, body,
 * schema, facts, render, response) on the sample feed and reports CPU time per
 * request (user + system, so a busy machine does not inflate it), the minimum
 * of several runs. `PROCESS_REQUESTS_PER_MINUTE` is set from this figure.
 */
const ENABLED = process.env.DEPOT_COPILOT_BENCH === '1';
const RUNS = 7;
const REQUESTS_PER_RUN = 600;
const WARMUP_REQUESTS = 300;

const rows = normalizeDepotRows(liveFixture).rows;
const VIEW: FleetSnapshotView = {
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
};

/** A realistic mix: every task, network and depot scope. */
function bodies(): readonly unknown[] {
  const depots = buildNetworkResponse(VIEW).depots.filter((d) => d.id !== 'unassigned');
  const transfer = buildDistributionResponse(VIEW).plan.transfers[0];
  const depot = (i: number) => ({ kind: 'depot', depotId: depots[i % depots.length]!.id });
  return [
    { task: 'briefing', scope: { kind: 'network' } },
    { task: 'briefing', scope: depot(0) },
    { task: 'briefing', scope: depot(3) },
    { task: 'ask', question: 'Which five depots rank highest?', scope: { kind: 'network' } },
    { task: 'ask', question: 'What exceptions does this depot have?', scope: depot(1) },
    ...(transfer ? [{ task: 'rationale', transferId: transfer.id }] : []),
  ];
}

const post = (body: unknown): NextRequest =>
  new NextRequest('http://localhost:3000/api/upsrtc/depot/copilot', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

/** CPU microseconds per request over `count` requests, each from a fresh session. */
async function run(count: number, cold: boolean): Promise<number> {
  const runtime = buildCopilotRuntime({ setting: 'scripted', cli: null });
  const mix = bodies();
  const load = async (): Promise<FleetSnapshotView> => VIEW;
  const requests = Array.from({ length: count }, (_, i) => post(mix[i % mix.length]));
  const start = process.cpuUsage();
  for (let i = 0; i < count; i += 1) {
    if (cold) resetAnalysisForTests();
    const claims = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0, sid: `bench-${i}` };
    const response = await handleCopilotPost(requests[i]!, runtime, load, claims);
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    await response.text();
  }
  const used = process.cpuUsage(start);
  return (used.user + used.system) / count;
}

describe.skipIf(!ENABLED)('scripted answer cost (benchmark)', () => {
  it('reports CPU time per request', async () => {
    await run(WARMUP_REQUESTS, false);
    const warm: number[] = [];
    const cold: number[] = [];
    for (let r = 0; r < RUNS; r += 1) {
      warm.push(await run(REQUESTS_PER_RUN, false));
      cold.push(await run(REQUESTS_PER_RUN / 10, true));
    }
    const ms = (us: number): string => (us / 1000).toFixed(3);
    process.stdout.write(
      `scripted answer CPU ms/request over ${RUNS} runs of ${REQUESTS_PER_RUN}\n` +
        `  warm (analysis cached for the snapshot): min ${ms(Math.min(...warm))}` +
        ` max ${ms(Math.max(...warm))} runs [${warm.map(ms).join(', ')}]\n` +
        `  cold (analysis rebuilt every request): min ${ms(Math.min(...cold))}` +
        ` max ${ms(Math.max(...cold))} runs [${cold.map(ms).join(', ')}]\n`,
    );
    expect(Math.min(...warm)).toBeGreaterThan(0);
  });
});
