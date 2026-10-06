'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { depotPortalRoot } from '@/lib/depot/portalRoot';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { useRouteProfile } from '@/hooks/useRouteProfile';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import {
  NO_TIME,
  drawerPhase,
  drawerView,
  type DrawerMove,
  type DrawerRoute,
} from '@/lib/depot/routes/routeDrawerModel';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface RouteDrawerProps {
  readonly route: DrawerRoute;
  /** The plan's move for this route, from the allocation summary; null when it stays. */
  readonly move: DrawerMove | null;
  readonly onClose: () => void;
  /** Called once the profile has loaded, so the page can refresh its figures. */
  readonly onProfiled: () => void;
  /** Where focus goes when the sheet closes: the opener, else a page fallback. */
  readonly restoreFocusTo: () => HTMLElement | null;
}

function DrawerBody({ route, move, onProfiled }: Pick<RouteDrawerProps, 'route' | 'move' | 'onProfiled'>) {
  // Exactly one route is fetched: the one this drawer was opened for.
  const profile = useRouteProfile(route.routeName);
  const loaded = profile.data !== null;
  const profiledRef = useRef(onProfiled);
  useEffect(() => {
    profiledRef.current = onProfiled;
  });
  useEffect(() => {
    if (loaded) profiledRef.current();
  }, [loaded]);

  const phase = drawerPhase(profile);
  const retry =
    typeof profile.retry === 'function' ? (
      <button type="button" className="depot-filter-button" onClick={profile.retry}>
        Try again
      </button>
    ) : undefined;
  if (phase.kind === 'loading' || phase.kind === 'slow') {
    // One status line: a slow lookup replaces the words, so it is announced.
    return (
      <p className="depot-prose" role="status" data-testid={`route-drawer-${phase.kind}`}>
        {phase.sentence}
      </p>
    );
  }
  if (phase.kind === 'limited') {
    return <StatePanel kind="no-data" sentence={phase.sentence} action={retry} testId="route-drawer-limited" />;
  }
  if (phase.kind === 'failed' || profile.data === null) {
    const sentence = phase.kind === 'failed' ? phase.sentence : '';
    return (
      <StatePanel kind="error" title="Route details unavailable" sentence={sentence} action={retry} />
    );
  }
  const view = drawerView(profile.data, route, move);
  if (view.status === 'unavailable') {
    return <StatePanel kind="empty" sentence={view.sentence} testId="route-drawer-empty" />;
  }
  return (
    <>
      <p className="depot-prose mb-3 flex flex-wrap items-baseline gap-2">
        <ProvenanceBadge provenance="derived" />
        <span>From the route-details feed and the inferred depot positions.</span>
      </p>
      <p className="depot-prose">{view.operatorsLine} {view.busesLine}</p>
      <h3 className="depot-label mb-2 mt-4">Dead kilometres</h3>
      {view.deadKmLines.map((line) => (
        <p key={line} className="depot-prose">{line}</p>
      ))}
      <h3 className="depot-label mb-2 mt-4">Terminals</h3>
      <p className="depot-prose">
        From {view.firstStop ?? 'an unnamed stop'} to {view.lastStop ?? 'an unnamed stop'}, from the
        route-details feed. {view.durationLine} {view.unlocatedLine}
      </p>
      <h3 className="depot-label mb-2 mt-4">Stops in order</h3>
      <DataTable
        columns={STOP_COLUMNS}
        rows={view.stops}
        rowKey={(s) => String(s.sequence)}
        caption="Stops in order"
        fixedRows
      />
    </>
  );
}

interface StopRow {
  readonly sequence: number;
  readonly name: string;
  readonly time: string;
}

/** The stops on the shared table options; a stop without a time is a dash with the reason. */
const STOP_COLUMNS: readonly Column<StopRow>[] = [
  { key: 'seq', header: '#', align: 'right', width: '2.5rem', render: (s) => String(s.sequence) },
  { key: 'name', header: 'Stop', render: (s) => s.name },
  {
    key: 'time',
    header: 'Scheduled',
    align: 'right',
    render: (s) => (s.time === NO_TIME ? <span title="No scheduled time">—</span> : s.time),
  },
];

/**
 * Side sheet for one route, after the bus drawer: a modal dialog where focus
 * moves in, Tab is held inside, Escape and the close button leave, the page
 * behind does not scroll, and focus returns to the route that opened it.
 */
export function RouteDrawer({ route, move, onClose, onProfiled, restoreFocusTo }: RouteDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  const restoreRef = useRef(restoreFocusTo);
  useEffect(() => {
    closeRef.current = onClose;
    restoreRef.current = restoreFocusTo;
  });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const panel = panelRef.current;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !panel.contains(active);
      if (event.shiftKey) {
        if (outside || active === first || active === titleRef.current) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(
    () => () => {
      const target = restoreRef.current();
      if (target?.isConnected) target.focus();
    },
    [],
  );

  const dialog = (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="route-drawer">
      <div className="absolute inset-0 bg-depot-page/70" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-drawer-title"
        className="relative flex h-full w-full min-w-0 flex-col overflow-y-auto border-l border-depot-line bg-depot-surface p-4 sm:max-w-lg"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2
            id="route-drawer-title"
            ref={titleRef}
            tabIndex={-1}
            className="min-w-0 break-words font-mono text-base text-depot-ink outline-none"
          >
            Route {route.routeName}
          </h2>
          <button type="button" className="hud-button shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        <DrawerBody route={route} move={move} onProfiled={onProfiled} />
      </div>
    </div>
  );
  return createPortal(dialog, depotPortalRoot());
}
