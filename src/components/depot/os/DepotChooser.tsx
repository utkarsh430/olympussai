'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { formatCount } from '@/lib/depot/format';
import { regionOf, summariseRegions } from '@/lib/depot/os/regions';
import { MISSION_PATH, viewByKey, viewHref } from '@/lib/depot/os/workspaces';
import { useIntel } from './IntelProvider';
import { OsHeader } from './OsHeader';
import { useOsStore } from './osStore';
import { EmptyNote, PanelLoading, SeverityDot } from './ui';
import { StateMixBar } from './StateMixBar';

/**
 * The way into a per-depot view from Headquarters: every operating depot as a card with
 * its fleet, its state mix, its peak balance and its open decisions, filtered by region.
 */
export function DepotChooser() {
  const params = useSearchParams();
  const found = viewByKey(params?.get('view') ?? '');
  const intel = useIntel();
  const regionId = useOsStore((s) => s.regionId);
  const setRegion = useOsStore((s) => s.setRegion);
  const [query, setQuery] = useState('');
  const depots = useMemo(() => intel.network?.depots.filter((d) => d.kind === 'depot') ?? [], [intel.network]);
  const regions = useMemo(() => summariseRegions(depots), [depots]);
  const balances = useMemo(() => new Map((intel.distribution?.balances ?? []).map((b) => [b.depotId, b])), [intel.distribution]);
  const decisionCount = useMemo(() => {
    const counts = new Map<string, { n: number; worst: 'critical' | 'high' | 'medium' | 'low' }>();
    for (const d of intel.decisions) {
      if (!d.depotId) continue;
      const held = counts.get(d.depotId);
      counts.set(d.depotId, { n: (held?.n ?? 0) + 1, worst: held?.worst ?? d.severity });
    }
    return counts;
  }, [intel.decisions]);

  const listed = depots
    .filter((d) => regionId === null || regionOf(d) === regionId)
    .filter((d) => query.trim() === '' || d.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const view = found?.view ?? null;
  const target = (depotId: string): string => (view ? (viewHref(view, depotId) ?? MISSION_PATH) : `${MISSION_PATH}/d/${encodeURIComponent(depotId)}`);

  return (
    <>
      <OsHeader
        title={view ? `Choose a depot for ${view.label}` : 'Choose a depot'}
        description={view ? `${view.label} runs per depot. Pick one; the context selector switches between depots from any view.` : 'Pick a depot to open its views.'}
        statuses={['live', 'estimate']}
        actions={
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter depots"
            aria-label="Filter depots"
            className="depot-field w-56 font-sans"
          />
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Region">
        <button type="button" onClick={() => setRegion(null)} aria-pressed={regionId === null} className={`os-chip px-2 py-1 text-[10.5px] ${regionId === null ? 'border-holo-glow/60 text-holo-glow' : 'border-depot-line text-depot-muted hover:text-depot-ink'}`}>
          All regions
        </button>
        {regions.map((r) => (
          <button
            key={r.region.id}
            type="button"
            onClick={() => setRegion(r.region.id)}
            aria-pressed={regionId === r.region.id}
            className={`os-chip px-2 py-1 text-[10.5px] ${regionId === r.region.id ? 'border-holo-glow/60 text-holo-glow' : 'border-depot-line text-depot-muted hover:text-depot-ink'}`}
          >
            {r.region.name} · {r.depotIds.length}
          </button>
        ))}
      </div>
      {!intel.network ? (
        <PanelLoading rows={6} label="Loading the depots" />
      ) : listed.length === 0 ? (
        <div className="os-panel">
          <EmptyNote>No depot matches the filter.</EmptyNote>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {listed.map((d) => {
            const b = balances.get(d.id);
            const dec = decisionCount.get(d.id);
            return (
              <li key={d.id}>
                <Link href={target(d.id)} className="os-panel group block p-4 transition-colors hover:border-holo-glow/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-sans text-[14px] font-semibold text-depot-ink">{d.name}</div>
                      <div className="font-mono text-[11px] text-depot-muted">{formatCount(d.fleet)} buses</div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-depot-muted transition-colors group-hover:text-holo-glow" aria-hidden />
                  </div>
                  <div className="mt-3">
                    <StateMixBar states={d.states} fleet={d.fleet} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 font-sans text-[12px]">
                    <span className={b && b.balance < 0 ? 'text-alert-crimson' : 'text-depot-prose'}>
                      {b ? (b.balance < 0 ? `${formatCount(-b.balance)} short at peak` : `${formatCount(b.balance)} spare at peak`) : 'Peak balance loading'}
                    </span>
                    {dec ? (
                      <span className="flex items-center gap-1.5 text-depot-prose">
                        <SeverityDot severity={dec.worst} />
                        {dec.n} decision{dec.n === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
