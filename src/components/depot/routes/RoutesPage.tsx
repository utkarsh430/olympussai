'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
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
import { defaultLoaderDepot, loaderDepots, planRowSentence } from '@/lib/depot/routes/loaderRow';
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
 * Route intelligence for the whole network: the plan section (one row with the
 * route-details loader until something can be planned), then the route table, the
 * page's hero, and the closing
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
  const network = useDepotNetworkContext().data;
  const scopeDepotId = useSearchParams().get('depot');
  const depots = useMemo(
    () => loaderDepots(routeData?.depotOptions ?? [], network?.depots ?? []),
    [routeData?.depotOptions, network?.depots],
  );

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

  // Nothing can be planned: the loader's row says why, in place of a panel.
  const lead = plan !== null && plan.coverage.planned.n === 0 ? planRowSentence(plan) : undefined;
  const loader = (
    <ProfileLoader
      depots={depots}
      defaultDepotId={defaultLoaderDepot(depots, scopeDepotId)}
      lead={lead}
      onFinished={onProfiled}
    />
  );

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
