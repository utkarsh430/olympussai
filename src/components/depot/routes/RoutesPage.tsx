'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { useDepotAllocation } from '@/hooks/useDepotAllocation';
import { useDepotRoutes } from '@/hooks/useDepotRoutes';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { unmovedGroups } from '@/lib/depot/routes/allocationGroups';
import type { RouteListItem } from '@/lib/depot/routes/api';
import { DEFAULT_ROUTES_QUERY, type RoutesQuery } from '@/lib/depot/routes/routeQuery';
import { ROUTES_TEXT } from '@/lib/depot/routes/routesPageText';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { AllocationSection } from './AllocationPanel';
import { ProfileLoader } from './ProfileLoader';
import { RouteDrawer } from './RouteDrawer';
import { RouteTable } from './RouteTable';
import { RoutesMethod } from './RoutesMethod';

const TABLE_TITLE_ID = 'route-table-title';

/** The page's footprint while neither response has arrived: hero band, then the table. */
function RoutesLoading() {
  return (
    <div className="space-y-8" data-testid="routes-loading">
      <LoadingBlock rows={3} rowHeight={64} label="Loading the allocation plan" />
      <LoadingBlock rows={10} label="Loading the route table" />
    </div>
  );
}

/**
 * Route intelligence for the whole network: the plan as one compact panel (with
 * the route-details loader), then the route table, the page's hero, and the closing
 * disclosure. Both endpoints are network-wide; the table's depot filter
 * narrows only the table, so no network total is passed off as one depot's.
 */
export function RoutesPage() {
  const [query, setQuery] = useState<RoutesQuery>(DEFAULT_ROUTES_QUERY);
  const [opened, setOpened] = useState<RouteListItem | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const routes = useDepotRoutes(query);
  const allocation = useDepotAllocation();
  const routeData = routes.data;
  const plan = allocation.data;

  const groups = useMemo(() => (plan === null ? null : unmovedGroups(plan)), [plan]);
  const openRoute = useCallback((route: RouteListItem, opener: HTMLButtonElement): void => {
    openerRef.current = opener;
    setOpened(route);
  }, []);
  const refreshRoutes = routes.refresh;
  const refreshPlan = allocation.refresh;
  // A newly loaded profile shows in the table at once and in the plan within its interval.
  const onProfiled = useCallback((): void => {
    refreshRoutes();
    refreshPlan();
  }, [refreshRoutes, refreshPlan]);
  const move = opened === null ? null : (plan?.moves.find((m) => m.routeName === opened.routeName) ?? null);

  if (routes.loading && allocation.loading) return <RoutesLoading />;

  const stale =
    (routeData !== null && (routeData.stale || routes.error !== null)) ||
    (plan !== null && (plan.stale || allocation.error !== null));
  const strip = stale ? <StaleStrip since={routeData?.feedNow ?? plan?.feedNow ?? null} /> : null;

  if (routeData !== null && routeData.inFeed === 0) {
    return (
      <>
        {strip}
        <EmptyState>{ROUTES_TEXT.noRoutes}</EmptyState>
      </>
    );
  }

  const loader = <ProfileLoader depots={routeData?.depotOptions ?? []} onFinished={onProfiled} />;

  return (
    <>
      {strip}
      <AllocationSection state={allocation} groups={groups ?? []} loader={loader} />
      <section aria-labelledby={TABLE_TITLE_ID} className="mb-8 min-w-0">
        <SectionLabel
          id={TABLE_TITLE_ID}
          label={ROUTES_TEXT.tableTitle}
          count={routeData?.inFeed}
          note="Select a route to see its stops"
        />
        {routes.loading ? (
          <LoadingBlock rows={10} label="Loading the route table" />
        ) : routeData !== null ? (
          <RouteTable
            data={routeData}
            query={query}
            onQueryChange={setQuery}
            onOpenRoute={openRoute}
          />
        ) : (
          <ErrorPanel
            title="Routes list unavailable"
            message={routes.error ?? DEPOT_UNAVAILABLE_MESSAGE}
            onRetry={routes.refresh}
          />
        )}
      </section>
      <RoutesMethod allocation={plan} />
      {opened !== null ? (
        <RouteDrawer
          route={routeData?.routes.find((r) => r.routeName === opened.routeName) ?? opened}
          move={move}
          onClose={() => setOpened(null)}
          onProfiled={onProfiled}
          restoreFocusTo={() => openerRef.current}
        />
      ) : null}
    </>
  );
}
