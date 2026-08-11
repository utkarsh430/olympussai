'use client';

import { useMemo, useState, useEffect } from 'react';
import { Search, Navigation, Bus, SignalHigh } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { useDebounced } from '@/hooks/useDebounced';
import { Badge, sourceBadge } from '@/components/shared/hud';
import { DATA_QUALITY_META, formatRelativeAge, formatSpeed, formatNumber } from '@/lib/formatters';
import type { CanonicalLiveBus } from '@/models/canonical';
import { cn } from '@/lib/utils';

const MAX_RENDERED = 160;

/**
 * Fleet list ordering, lowest first.
 *
 * Roughly a quarter of the ~9.5k vehicles carry a route assignment at any time,
 * and most of the rest are parked, so unordered the list opens on a wall of
 * stationary unassigned buses. Running services surface instead.
 */
function activityRank(bus: CanonicalLiveBus): number {
  const onRoute = bus.routeName !== null;
  // A stale record's speed is whatever it read when the GPS last reported,
  // which can be days ago — that bus is not moving now, so it does not get to
  // outrank vehicles the feed is actually tracking.
  const moving = (bus.speedKmph ?? 0) > 0 && bus.dataQuality !== 'stale';
  if (onRoute && moving) return 0;
  if (onRoute) return 1;
  if (moving) return 2;
  return 3;
}

export function FleetPanel({ onVisibleCountChange }: { onVisibleCountChange: (n: number) => void }) {
  const buses = useCopilotStore((state) => state.buses);
  const filters = useCopilotStore((state) => state.filters);
  const setFilters = useCopilotStore((state) => state.setFilters);
  const selectedBusId = useCopilotStore((state) => state.selectedBusId);
  const selectBus = useCopilotStore((state) => state.selectBus);
  const logAudit = useCopilotStore((state) => state.logAudit);
  const isLoading = useCopilotStore((state) => state.isLoadingFleet);
  const feedMeta = useCopilotStore((state) => state.feedMeta);

  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebounced(searchInput, 220);

  useEffect(() => {
    setFilters({ search: debouncedSearch });
  }, [debouncedSearch, setFilters]);

  // Depot/route option lists are expensive over ~9.5k records — memoize hard.
  const { depots, routes } = useMemo(() => {
    const depotSet = new Set<string>();
    const routeSet = new Set<string>();
    for (const bus of buses) {
      if (bus.depotName) depotSet.add(bus.depotName);
      if (bus.routeName) routeSet.add(bus.routeName);
    }
    return {
      depots: [...depotSet].sort(),
      routes: [...routeSet].sort().slice(0, 400),
    };
  }, [buses]);

  const filtered = useMemo(() => {
    const query = filters.search.trim().toUpperCase();
    const matches = buses.filter((bus) => {
      if (query && !bus.registrationNumber.toUpperCase().includes(query)) return false;
      if (filters.depot !== 'all' && bus.depotName !== filters.depot) return false;
      if (filters.route !== 'all' && bus.routeName !== filters.route) return false;
      if (filters.quality !== 'all' && bus.dataQuality !== filters.quality) return false;
      return true;
    });

    // Only the first MAX_RENDERED rows are ever painted, so ordering decides
    // what an operator actually sees. A bus that is on a route and moving is
    // the one worth watching; parked and unassigned vehicles sink. Ties break
    // on registration so the list does not reshuffle under itself on each poll.
    return matches.sort((a, b) => {
      const rank = activityRank(a) - activityRank(b);
      return rank !== 0 ? rank : a.registrationNumber.localeCompare(b.registrationNumber);
    });
  }, [buses, filters]);

  useEffect(() => {
    onVisibleCountChange(filtered.length);
  }, [filtered.length, onVisibleCountChange]);

  const rendered = filtered.slice(0, MAX_RENDERED);

  return (
    <aside
      className="hud-panel hud-corners relative z-20 flex w-[272px] shrink-0 flex-col overflow-hidden"
      aria-label="Live fleet navigation"
    >
      <header className="shrink-0 border-b border-holo-glow/15 px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">
            <Bus className="h-3.5 w-3.5" aria-hidden />
            Fleet Navigation
          </h2>
          <Badge variant={sourceBadge(feedMeta.source).variant} pulse>
            {sourceBadge(feedMeta.source).label}
          </Badge>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-holo-glow/40"
            aria-hidden
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search registration…"
            aria-label="Search by bus registration number"
            className="hud-input pl-8"
            data-testid="fleet-search"
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <FilterSelect
            label="Depot"
            value={filters.depot}
            onChange={(value) => setFilters({ depot: value })}
            options={depots}
            allLabel="All depots"
          />
          <FilterSelect
            label="Route"
            value={filters.route}
            onChange={(value) => setFilters({ route: value })}
            options={routes}
            allLabel="All routes"
          />
        </div>

        <div className="mt-2">
          <span className="hud-label mb-1 block">GPS Data Status</span>
          <div className="flex gap-1" role="group" aria-label="Filter by GPS data status">
            {(['all', 'good', 'degraded', 'stale'] as const).map((quality) => (
              <button
                key={quality}
                type="button"
                onClick={() => setFilters({ quality })}
                aria-pressed={filters.quality === quality}
                className={cn(
                  'flex-1 rounded border px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider transition',
                  filters.quality === quality
                    ? 'border-holo-glow/70 bg-holo-glow/15 text-holo-glow'
                    : 'border-holo-glow/15 text-holo-glow/45 hover:border-holo-glow/40',
                )}
              >
                {quality}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between border-t border-holo-glow/10 pt-2">
          <span className="hud-label">Visible</span>
          <span className="font-mono text-xs tabular-nums text-holo-teal" data-testid="visible-count">
            {formatNumber(filtered.length)} / {formatNumber(buses.length)}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Live bus list">
        {isLoading && buses.length === 0 && <SkeletonList />}

        {!isLoading && filtered.length === 0 && (
          <p className="px-3 py-6 text-center font-mono text-[11px] text-holo-glow/45">
            No buses match the current filters.
          </p>
        )}

        {rendered.map((bus) => (
          <BusRow
            key={bus.id}
            bus={bus}
            selected={bus.id === selectedBusId}
            onSelect={() => {
              selectBus(bus.id);
              logAudit('bus-selected', `Operator selected live bus ${bus.registrationNumber}`, {
                registrationNumber: bus.registrationNumber,
                simulated: false,
              });
            }}
          />
        ))}

        {filtered.length > MAX_RENDERED && (
          <p className="border-t border-holo-glow/10 px-3 py-2.5 text-center font-mono text-[10px] text-holo-glow/40">
            Showing first {MAX_RENDERED} of {formatNumber(filtered.length)} — refine filters to narrow
          </p>
        )}
      </div>
    </aside>
  );
}

function BusRow({
  bus,
  selected,
  onSelect,
}: {
  bus: CanonicalLiveBus;
  selected: boolean;
  onSelect: () => void;
}) {
  const quality = DATA_QUALITY_META[bus.dataQuality];

  return (
    <button
      type="button"
      role="listitem"
      onClick={onSelect}
      aria-current={selected}
      data-testid="fleet-bus-row"
      className={cn(
        'group relative w-full border-b border-holo-glow/[0.07] px-3 py-2 text-left transition-colors',
        selected ? 'bg-holo-glow/[0.13]' : 'hover:bg-holo-glow/[0.06]',
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-holo-glow" aria-hidden />}

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold tracking-wider text-holo-glow">
          {bus.registrationNumber}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn('h-1.5 w-1.5 rounded-full', quality.dot)}
            aria-hidden
          />
          <span className="sr-only">Data quality: {quality.label}. {quality.description}.</span>
          <Navigation
            className="h-3 w-3 text-holo-teal/70 transition-transform"
            style={{ transform: `rotate(${bus.headingDegrees ?? 0}deg)` }}
            aria-hidden
          />
        </span>
      </div>

      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] text-holo-glow/50">
          {bus.depotName ?? 'Unknown depot'}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-holo-glow/70">
          {formatSpeed(bus.speedKmph)}
        </span>
      </div>

      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[9px] text-holo-glow/35">
          {bus.routeName ?? 'No route assigned'}
        </span>
        <span className="shrink-0 font-mono text-[9px] text-holo-glow/40">
          {formatRelativeAge(bus.gpsTimestamp)}
        </span>
      </div>
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <label className="block">
      <span className="hud-label mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="hud-input cursor-pointer appearance-none py-1 text-[10px]"
        aria-label={`Filter by ${label.toLowerCase()}`}
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-px p-2" aria-hidden>
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          key={index}
          className="h-[52px] animate-pulse rounded bg-holo-glow/[0.05]"
          style={{ animationDelay: `${index * 60}ms` }}
        />
      ))}
      <p className="pt-2 text-center font-mono text-[10px] text-holo-glow/40">
        <SignalHigh className="mr-1 inline h-3 w-3" aria-hidden />
        Acquiring UPSRTC telemetry…
      </p>
    </div>
  );
}
