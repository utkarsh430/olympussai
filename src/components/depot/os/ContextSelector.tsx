'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, ChevronDown, ChevronRight, Globe2, MapPinned } from 'lucide-react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { depotIdFromPath } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { DEPOT_KIND_LABEL } from '@/lib/depot/labels';
import { regionById, regionOf, summariseRegions } from '@/lib/depot/os/regions';
import { equivalentHref } from '@/lib/depot/os/workspaces';
import { useOsStore } from './osStore';

const MAX_LISTED = 60;

/**
 * The context selector: UPSRTC network › Headquarters or a region › a depot. Choosing a
 * depot keeps the person on the same view in the depot's scope (or its Control Room
 * when the view has no depot form); choosing Headquarters or a region does the reverse.
 * A region narrows the Headquarters views that read it (Control Room, the decision
 * queue, fleet health, the fuel audit) without leaving Headquarters scope.
 */
export function ContextSelector() {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const router = useRouter();
  const { data } = useDepotNetworkContext();
  const regionId = useOsStore((s) => s.regionId);
  const setRegion = useOsStore((s) => s.setRegion);
  const depotId = depotIdFromPath(pathname);
  const depots = useMemo(() => data?.depots ?? [], [data]);
  const depot = depotId ? depots.find((d) => d.id === depotId) ?? null : null;
  const regions = useMemo(() => summariseRegions(depots), [depots]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [browseRegion, setBrowseRegion] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const shownRegionId = depot ? regionOf(depot) : regionId;
  const shownRegion = regionById(shownRegionId);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onPointer = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...depots]
      .filter((d) => (browseRegion === null ? true : regionOf(d) === browseRegion))
      .filter((d) => needle === '' || d.name.toLowerCase().includes(needle) || d.id.includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .slice(0, MAX_LISTED);
  }, [depots, browseRegion, query]);

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const toHeadquarters = (region: string | null): void => {
    setRegion(region);
    setOpen(false);
    if (depotId !== null) router.push(equivalentHref(pathname, search, null));
  };

  const toDepot = (id: string): void => {
    const target = depots.find((d) => d.id === id);
    if (target) setRegion(regionOf(target));
    setOpen(false);
    router.push(equivalentHref(pathname, search, id));
  };

  const openPanel = (): void => {
    setQuery('');
    setBrowseRegion(depot ? regionOf(depot) : regionId);
    setOpen(true);
  };

  return (
    <div ref={rootRef} className="relative min-w-0" data-testid="depot-scope-switcher">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!data}
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={`Context: ${depot ? depot.name : shownRegion ? `${shownRegion.name} region` : 'Headquarters'}. Change context`}
        className="flex min-w-0 items-center gap-1.5 rounded-[4px] border border-transparent px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-depot-muted hover:border-depot-line hover:bg-depot-raised disabled:cursor-wait"
      >
        <Globe2 className="h-3.5 w-3.5 shrink-0 text-holo-glow" aria-hidden />
        <span className="hidden shrink-0 min-[1800px]:inline">UPSRTC Network</span>
        <ChevronRight className="hidden h-3 w-3 shrink-0 text-depot-faint min-[1800px]:inline" aria-hidden />
        <span className={`truncate ${depot ? 'hidden md:inline' : 'text-depot-ink'}`}>
          {shownRegion ? `${shownRegion.name} region` : 'Headquarters'}
        </span>
        {depot || depotId ? (
          <>
            <ChevronRight className="hidden h-3 w-3 shrink-0 text-depot-faint md:inline" aria-hidden />
            <span className="truncate font-sans text-[13px] font-semibold normal-case tracking-normal text-depot-ink">
              {depot ? depot.name : `Depot ${depotId}`}
            </span>
          </>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose the operational context"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
          className="os-panel os-panel-strong absolute left-0 top-full z-50 mt-2 w-[min(40rem,calc(100vw-2rem))] overflow-hidden"
        >
          <div className="flex items-center gap-2 border-b border-holo-glow/10 p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && listed[0]) toDepot(listed[0].id);
              }}
              placeholder="Find a depot by name or id"
              aria-label="Find a depot by name or id"
              autoComplete="off"
              spellCheck={false}
              className="depot-field w-full font-sans"
            />
          </div>
          <div className="grid max-h-[26rem] grid-cols-1 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <div className="os-scroll overflow-y-auto border-b border-holo-glow/10 p-2 sm:border-b-0 sm:border-r">
              <button
                type="button"
                onClick={() => toHeadquarters(null)}
                className={`flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left font-sans text-[12.5px] ${
                  !depot && regionId === null ? 'bg-depot-selected text-holo-glow' : 'text-depot-ink hover:bg-depot-raised'
                }`}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="flex-1">Headquarters</span>
                <span className="font-mono text-[10.5px] text-depot-muted">{formatCount(depots.length)}</span>
              </button>
              <div className="os-kicker mt-2 px-2 pb-1">Regions</div>
              {regions.map((summary) => (
                <div key={summary.region.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setBrowseRegion(summary.region.id)}
                    onDoubleClick={() => toHeadquarters(summary.region.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-[3px] px-2 py-1 text-left font-sans text-[12.5px] ${
                      browseRegion === summary.region.id ? 'bg-depot-raised text-holo-glow' : 'text-depot-prose hover:text-depot-ink'
                    }`}
                  >
                    <MapPinned className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">{summary.region.name}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-depot-muted">{summary.depotIds.length}</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="os-scroll min-h-0 overflow-y-auto p-2">
              {browseRegion !== null ? (
                <button
                  type="button"
                  onClick={() => toHeadquarters(browseRegion)}
                  className="os-button mb-2 w-full justify-start"
                >
                  <MapPinned className="h-3.5 w-3.5" aria-hidden />
                  View the {regionById(browseRegion)?.name ?? ''} region at Headquarters scope
                </button>
              ) : null}
              {listed.length === 0 ? (
                <p className="depot-note px-2 py-3">No depot matches that name or id.</p>
              ) : (
                <ul aria-label="Depots">
                  {listed.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => toDepot(d.id)}
                        aria-current={d.id === depotId ? 'true' : undefined}
                        className={`flex w-full items-baseline justify-between gap-3 rounded-[3px] px-2 py-1.5 text-left ${
                          d.id === depotId ? 'bg-depot-selected text-holo-glow' : 'text-depot-ink hover:bg-depot-raised'
                        }`}
                      >
                        <span className="truncate font-sans text-[13px]">{d.name}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-depot-muted">
                          {DEPOT_KIND_LABEL[d.kind]} · {formatCount(d.fleet)} buses
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
