'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, Bus, CornerDownLeft, LayoutGrid, MapPinned, Search, Sparkles, Route as RouteIcon } from 'lucide-react';
import { depotIdFromPath } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { decisionHref } from '@/lib/depot/os/intel/decisions';
import { summariseRegions } from '@/lib/depot/os/regions';
import { viewLink, WORKSPACES } from '@/lib/depot/os/workspaces';
import { BUS_STATE_LABEL as BUS_STATE_WORD } from '@/lib/depot/labels';
import { useIntel } from './IntelProvider';
import { OsOverlay } from './OsOverlay';
import { useOsStore, type EntityRef } from './osStore';

type ResultKind = 'view' | 'depot' | 'region' | 'bus' | 'route' | 'decision';

interface Result {
  readonly key: string;
  readonly kind: ResultKind;
  readonly label: string;
  readonly detail: string;
  readonly href?: string;
  readonly entity?: EntityRef;
  readonly region?: string;
}

const ICON: Readonly<Record<ResultKind, typeof Search>> = {
  view: LayoutGrid,
  depot: Building2,
  region: MapPinned,
  bus: Bus,
  route: RouteIcon,
  decision: Sparkles,
};

const KIND_LABEL: Readonly<Record<ResultKind, string>> = {
  view: 'View',
  depot: 'Depot',
  region: 'Region',
  bus: 'Vehicle',
  route: 'Route',
  decision: 'Decision',
};

const LIMIT = { view: 8, depot: 6, region: 4, bus: 8, route: 5, decision: 5 } as const;

/**
 * Global search (Ctrl/Cmd+K): views, depots, regions, vehicles, routes and decisions in
 * one list. A vehicle, depot or route opens its intelligence profile; a view navigates.
 */
export function CommandPalette() {
  const open = useOsStore((s) => s.paletteOpen);
  const setOpen = useOsStore((s) => s.setPaletteOpen);
  const openEntity = useOsStore((s) => s.openEntity);
  const setRegion = useOsStore((s) => s.setRegion);
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const depotId = depotIdFromPath(pathname);
  const intel = useIntel();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useOsStore.getState().paletteOpen);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const results = useMemo<readonly Result[]>(() => {
    const needle = query.trim().toLowerCase();
    const has = (...texts: (string | null | undefined)[]): boolean =>
      needle === '' || texts.some((t) => t?.toLowerCase().includes(needle));
    const views: Result[] = WORKSPACES.flatMap((w) =>
      w.views
        .filter((v) => has(v.label, w.title, v.keywords))
        .map((v) => ({
          key: `view:${v.key}`,
          kind: 'view' as const,
          label: v.label,
          detail: w.title,
          href: viewLink(v, depotId),
        })),
    ).slice(0, needle === '' ? 6 : LIMIT.view);
    if (needle === '') return views;
    const depots: Result[] = (intel.network?.depots ?? [])
      .filter((d) => has(d.name, d.id))
      .slice(0, LIMIT.depot)
      .map((d) => ({ key: `depot:${d.id}`, kind: 'depot', label: d.name, detail: `${formatCount(d.fleet)} buses`, entity: { kind: 'depot', id: d.id } }));
    const regions: Result[] = summariseRegions(intel.network?.depots ?? [])
      .filter((r) => has(r.region.name))
      .slice(0, LIMIT.region)
      .map((r) => ({ key: `region:${r.region.id}`, kind: 'region', label: `${r.region.name} region`, detail: `${r.depotIds.length} depots`, region: r.region.id }));
    const compact = needle.replace(/\s+/g, '');
    const buses: Result[] =
      compact.length >= 3
        ? (intel.fleet ?? [])
            .filter((b) => b.registration.toLowerCase().includes(compact))
            .slice(0, LIMIT.bus)
            .map((b) => ({
              key: `bus:${b.registration}`,
              kind: 'bus',
              label: b.registration,
              detail: `${BUS_STATE_WORD[b.state]}${b.depotId ? ` · ${intel.depotsById.get(b.depotId)?.name ?? b.depotId}` : ''}${b.routeName ? ` · ${b.routeName}` : ''}`,
              entity: { kind: 'vehicle', id: b.registration, depotId: b.depotId },
            }))
        : [];
    const routeNames = new Set<string>();
    if (needle.length >= 2) {
      for (const b of intel.fleet ?? []) {
        if (b.routeName && b.routeName.toLowerCase().includes(needle)) routeNames.add(b.routeName);
        if (routeNames.size >= LIMIT.route) break;
      }
    }
    const routes: Result[] = [...routeNames].map((name) => ({
      key: `route:${name}`,
      kind: 'route',
      label: name,
      detail: 'Route profile',
      entity: { kind: 'route', id: name },
    }));
    const decisions: Result[] = intel.decisions
      .filter((d) => has(d.title, d.entity.label))
      .slice(0, LIMIT.decision)
      .map((d) => ({ key: `decision:${d.id}`, kind: 'decision', label: d.title, detail: d.timing, href: decisionHref(d.id) }));
    return [...buses, ...depots, ...decisions, ...views, ...routes, ...regions];
  }, [query, intel, depotId]);

  const choose = (result: Result): void => {
    setOpen(false);
    if (result.entity) openEntity(result.entity);
    else if (result.region) setRegion(result.region);
    else if (result.href) router.push(result.href);
  };

  return (
    <OsOverlay open={open} onClose={() => setOpen(false)} label="Search Depot Intelligence OS" variant="dialog" testId="os-command-palette">
      <div className="flex items-center gap-2 border-b border-holo-glow/15 px-3 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-holo-glow" aria-hidden />
        <input
          data-autofocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="os-palette-results"
          aria-activedescendant={results[active] ? `os-palette-${active}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (event.key === 'Enter' && results[active]) {
              event.preventDefault();
              choose(results[active]!);
            }
          }}
          placeholder="Search a registration, depot, region, route, decision or view"
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-sans text-[14px] text-depot-ink placeholder:text-depot-faint focus:outline-none"
        />
        <kbd className="rounded-[3px] border border-depot-line px-1.5 font-mono text-[10px] text-depot-muted">Esc</kbd>
      </div>
      <ul id="os-palette-results" role="listbox" aria-label="Results" className="os-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <li className="px-3 py-6 font-sans text-[13px] text-depot-prose">
            Nothing matches. A registration needs at least three characters.
          </li>
        ) : null}
        {results.map((result, index) => {
          const Icon = ICON[result.kind];
          return (
            <li
              key={result.key}
              id={`os-palette-${index}`}
              role="option"
              aria-selected={index === active}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(result)}
              className={`flex cursor-pointer items-center gap-3 rounded-[4px] px-3 py-2 ${
                index === active ? 'bg-depot-selected' : ''
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${index === active ? 'text-holo-glow' : 'text-depot-muted'}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-[13px] text-depot-ink">{result.label}</span>
                <span className="block truncate font-sans text-[11.5px] text-depot-prose">{result.detail}</span>
              </span>
              <span className="os-chip border-depot-line text-depot-muted">{KIND_LABEL[result.kind]}</span>
              {index === active ? <CornerDownLeft className="h-3.5 w-3.5 text-holo-glow" aria-hidden /> : null}
            </li>
          );
        })}
      </ul>
    </OsOverlay>
  );
}
