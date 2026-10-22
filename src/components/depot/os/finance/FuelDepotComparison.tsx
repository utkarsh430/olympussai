'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import type { FuelAudit } from '@/lib/depot/os/intel/fuelAudit';
import type { DepotSummary } from '@/lib/depot/types';
import { AiKindChip } from '../aiKinds';
import { EmptyNote, MeterBar, Panel } from '../ui';

const SHOWN = 12;

/**
 * Depots compared on the fuel audit: exposure (excess litres at the planning price) and
 * the share of each depot's journeys flagged, highest exposure first. A depot opens its
 * own audit. The figures are the audit's own, regrouped.
 */
export function FuelDepotComparison({ audit, depotsById }: { readonly audit: FuelAudit; readonly depotsById: ReadonlyMap<string, DepotSummary> }) {
  const rows = useMemo(() => {
    const journeys = new Map<string, number>();
    for (const v of audit.vehicles.values()) if (v.depotId) journeys.set(v.depotId, (journeys.get(v.depotId) ?? 0) + v.journeys.length);
    const groups = new Map<string, { exposure: number; flagged: number; buses: Set<string> }>();
    for (const j of audit.flagged) {
      if (!j.depotId) continue;
      const g = groups.get(j.depotId) ?? { exposure: 0, flagged: 0, buses: new Set<string>() };
      g.exposure += j.exposureRupees;
      g.flagged += 1;
      g.buses.add(j.registration);
      groups.set(j.depotId, g);
    }
    return [...groups]
      .map(([id, g]) => ({ id, name: depotsById.get(id)?.name ?? `Depot ${id}`, exposure: g.exposure, flagged: g.flagged, buses: g.buses.size, share: g.flagged / Math.max(1, journeys.get(id) ?? 0) }))
      .sort((a, b) => b.exposure - a.exposure);
  }, [audit, depotsById]);
  const max = Math.max(1, ...rows.map((r) => r.exposure));
  const median = rows.length ? [...rows].sort((a, b) => a.share - b.share)[Math.floor(rows.length / 2)]!.share : 0;
  return (
    <Panel kicker="Depot-level comparison" title={`Exposure by depot · ${formatCount(rows.length)} depots with flags`} actions={<AiKindChip kind="anomaly" />} bodyClassName="p-0">
      {rows.length === 0 ? (
        <EmptyNote>No depot has a flagged journey in this context.</EmptyNote>
      ) : (
        <ul className="os-scroll max-h-[300px] overflow-y-auto py-1">
          {rows.slice(0, SHOWN).map((r) => (
            <li key={r.id}>
              <Link href={`${depotHref(r.id)}/fuel-audit`} className="os-row grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem_4rem] items-center gap-2 px-4 py-1.5">
                <span className="truncate font-sans text-[12.5px] text-depot-ink">{r.name}</span>
                <MeterBar value={r.exposure} max={max} tone={r.share > median * 1.5 ? 'crimson' : 'amber'} />
                <span className="text-right font-mono text-[12px] text-depot-ink">₹{formatCount(r.exposure)}</span>
                <span className={`text-right font-mono text-[11px] ${r.share > median * 1.5 ? 'text-alert-crimson' : 'text-depot-prose'}`} title={`${r.flagged} of the depot's journeys flagged, on ${r.buses} buses`}>
                  {(r.share * 100).toFixed(1)}%
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-holo-glow/10 px-4 py-2 font-sans text-[11.5px] text-depot-muted">Bar: exposure to verify. Right: share of the depot&apos;s journeys flagged; crimson is over half as high again as the median depot.</p>
    </Panel>
  );
}
