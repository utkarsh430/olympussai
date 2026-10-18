'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { useDepotDistribution } from '@/hooks/useDepotDistribution';
import { useIncidentRollup } from '@/hooks/useDepotIncidents';
import { useFleetIndex } from '@/hooks/useFleetIndex';
import type { DepotDistributionResponse, DepotNetworkResponse } from '@/lib/depot/api';
import { depotIdFromPath } from '@/lib/depot/depotNav';
import type { IncidentRollupResponse } from '@/lib/depot/incident/api';
import type { FleetBus } from '@/lib/depot/os/fleetIndex';
import { buildDecisions } from '@/lib/depot/os/intel/decisions';
import { auditFleet, type FuelAudit } from '@/lib/depot/os/intel/fuelAudit';
import type { Decision } from '@/lib/depot/os/intel/types';
import { vehicleHealth, type VehicleHealth } from '@/lib/depot/os/intel/vehicleHealth';
import { depotsInRegion } from '@/lib/depot/os/regions';
import { operatingDateOf } from '@/lib/depot/sim/seed';
import type { DepotSummary } from '@/lib/depot/types';
import { useOsStore } from './osStore';

export interface Intel {
  readonly network: DepotNetworkResponse | null;
  readonly distribution: DepotDistributionResponse | null;
  readonly incidents: IncidentRollupResponse | null;
  readonly fleet: readonly FleetBus[] | null;
  readonly health: readonly VehicleHealth[] | null;
  readonly healthByReg: ReadonlyMap<string, VehicleHealth>;
  readonly fuel: FuelAudit | null;
  readonly operatingDate: string | null;
  readonly depotsById: ReadonlyMap<string, DepotSummary>;
  /** The depot ids in the current context: one depot, a region, or null for all. */
  readonly scope: ReadonlySet<string> | null;
  readonly scopeDepotId: string | null;
  /** Decisions in the current context, most urgent first. */
  readonly decisions: readonly Decision[];
  /** True once the network and the distribution have both answered. */
  readonly ready: boolean;
}

const EMPTY_MAP = new Map<string, never>();

const IntelContext = createContext<Intel | null>(null);

/** A cheap fingerprint of what the fuel audit depends on, so it is not recomputed every poll. */
function auditSignature(fleet: readonly FleetBus[], date: string): string {
  let hash = 0;
  for (const bus of fleet) {
    const key = `${bus.registration}|${bus.routeName ?? ''}|${bus.state === 'off_road' ? 1 : 0}`;
    for (let i = 0; i < key.length; i += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  }
  return `${date}:${fleet.length}:${hash}`;
}

/**
 * Runs the OS's shared reads once for the shell: the network (already polled by the
 * shell), the fleet distribution, the incident roll-up and the fleet index, and derives
 * fleet health, the fuel audit and the decision queue from them. The fuel audit is the
 * one heavy step (every bus's last fourteen days), so it runs after paint and only when
 * the fleet or the date has changed.
 */
export function IntelProvider({ children }: { readonly children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const regionId = useOsStore((s) => s.regionId);
  const { data: network } = useDepotNetworkContext();
  const { data: distribution } = useDepotDistribution();
  const { data: incidents } = useIncidentRollup();
  const { buses: fleet } = useFleetIndex();

  const operatingDate = useMemo(() => {
    if (distribution) return distribution.operatingDate;
    if (!network) return null;
    try {
      return operatingDateOf(network.feedNow, network.fetchedAt);
    } catch {
      return null;
    }
  }, [distribution, network]);

  const health = useMemo(() => (fleet ? fleet.map(vehicleHealth) : null), [fleet]);
  const healthByReg = useMemo(
    () => (health ? new Map(health.map((h) => [h.registration, h])) : (EMPTY_MAP as ReadonlyMap<string, VehicleHealth>)),
    [health],
  );

  const signature = fleet && operatingDate ? auditSignature(fleet, operatingDate) : null;
  const [fuel, setFuel] = useState<{ key: string; audit: FuelAudit } | null>(null);
  useEffect(() => {
    if (!fleet || !operatingDate || signature === null || fuel?.key === signature) return undefined;
    const handle = window.setTimeout(() => {
      setFuel({ key: signature, audit: auditFleet(fleet, operatingDate) });
    }, 120);
    return () => window.clearTimeout(handle);
  }, [fleet, operatingDate, signature, fuel?.key]);

  const scopeDepotId = depotIdFromPath(pathname);
  const depots = network?.depots;
  const scope = useMemo<ReadonlySet<string> | null>(() => {
    if (scopeDepotId !== null) return new Set([scopeDepotId]);
    if (regionId === null || !depots) return null;
    return new Set(depotsInRegion(depots, regionId).map((d) => d.id));
  }, [scopeDepotId, regionId, depots]);

  const depotsById = useMemo(
    () => new Map((depots ?? []).map((d) => [d.id, d])),
    [depots],
  );

  const decisions = useMemo(
    () =>
      network
        ? buildDecisions({
            network,
            distribution: distribution ?? null,
            incidents: incidents ?? null,
            health,
            fuel: fuel?.audit ?? null,
            scope,
          })
        : [],
    [network, distribution, incidents, health, fuel, scope],
  );

  const value = useMemo<Intel>(
    () => ({
      network: network ?? null,
      distribution: distribution ?? null,
      incidents: incidents ?? null,
      fleet,
      health,
      healthByReg,
      fuel: fuel?.audit ?? null,
      operatingDate,
      depotsById,
      scope,
      scopeDepotId,
      decisions,
      ready: Boolean(network && distribution),
    }),
    [network, distribution, incidents, fleet, health, healthByReg, fuel, operatingDate, depotsById, scope, scopeDepotId, decisions],
  );

  return <IntelContext.Provider value={value}>{children}</IntelContext.Provider>;
}

export function useIntel(): Intel {
  const value = useContext(IntelContext);
  if (!value) throw new Error('useIntel must be used inside <IntelProvider>');
  return value;
}
