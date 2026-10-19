'use client';

import { useEffect, useRef } from 'react';
import { cycleEvents, findingsOf, type AnalysisInput, type Findings } from '@/lib/depot/os/intel/analysis';
import { regionById } from '@/lib/depot/os/regions';
import { useIntel, type Intel } from '../IntelProvider';
import { useOsStore } from '../osStore';
import { useAiStore } from './aiStore';

function inputOf(intel: Intel, regionId: string | null): AnalysisInput | null {
  if (!intel.network) return null;
  const depot = intel.scopeDepotId ? intel.depotsById.get(intel.scopeDepotId) : undefined;
  const region = intel.scopeDepotId === null ? regionById(regionId) : null;
  return {
    network: intel.network,
    distribution: intel.distribution,
    incidents: intel.incidents,
    fleet: intel.fleet,
    health: intel.health,
    fuel: intel.fuel,
    scope: intel.scope,
    scopeKey: intel.scopeDepotId ? `depot:${intel.scopeDepotId}` : region ? `region:${region.id}` : 'network',
    scopeLabel: depot?.name ?? region?.name ?? 'the UPSRTC network',
    depotId: intel.scopeDepotId,
  };
}

/**
 * Runs the AI engine's analysis cycle on its schedule (every 30 s unless changed in
 * Settings), as soon as every core read is in, whenever a poll brings new data, on a
 * change of context, and whenever a person asks for one. Each cycle re-runs the decision
 * engine on the current snapshot, compares the findings with the last cycle's and writes
 * what moved to the activity stream. Draws nothing.
 */
export function AiEngine() {
  const intel = useIntel();
  const regionId = useOsStore((s) => s.regionId);
  const intervalSec = useAiStore((s) => s.intervalSec);
  const runRequest = useAiStore((s) => s.runRequest);
  const latest = useRef<{ intel: Intel; regionId: string | null }>({ intel, regionId });
  latest.current = { intel, regionId };
  const previous = useRef<Findings | null>(null);

  const run = useRef(() => {
    const input = inputOf(latest.current.intel, latest.current.regionId);
    if (!input) return;
    const store = useAiStore.getState();
    store.setRunning(true);
    const started = performance.now();
    const findings = findingsOf(input);
    const drafts = cycleEvents(previous.current, findings, input);
    previous.current = findings;
    store.record({ findings, drafts, at: Date.now(), durationMs: performance.now() - started, scopeLabel: input.scopeLabel });
  });

  // The first cycle waits for every core read, so it never reports a half-loaded network.
  const ready = Boolean(intel.network && intel.distribution && intel.incidents && intel.fleet);
  const scopeKey = intel.scopeDepotId ?? `r:${regionId ?? ''}`;
  // A change of context or a person's request: run now.
  useEffect(() => {
    if (ready) run.current();
  }, [ready, scopeKey, runRequest]);
  // New data from any poll (or the fuel audit landing) is analysed as it arrives, so the
  // engine's figures always match the pages'; reads that land together share one cycle.
  const { network, distribution, incidents, fleet, fuel } = intel;
  const arrivals = useRef(0);
  useEffect(() => {
    arrivals.current += 1;
    if (!ready || arrivals.current === 1) return undefined;
    const handle = window.setTimeout(() => run.current(), 250);
    return () => window.clearTimeout(handle);
  }, [ready, network, distribution, incidents, fleet, fuel]);

  useEffect(() => {
    const store = useAiStore.getState();
    if (intervalSec <= 0 || !ready) {
      store.scheduleNext(null);
      return undefined;
    }
    store.scheduleNext(Date.now() + intervalSec * 1000);
    const handle = window.setInterval(() => {
      run.current();
      useAiStore.getState().scheduleNext(Date.now() + intervalSec * 1000);
    }, intervalSec * 1000);
    return () => window.clearInterval(handle);
  }, [intervalSec, ready, scopeKey, runRequest]);

  return null;
}
