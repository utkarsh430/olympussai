'use client';

import { useMemo } from 'react';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { useDepotAllocation } from '@/hooks/useDepotAllocation';
import { useDepotRoutes } from '@/hooks/useDepotRoutes';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { depotNameMap, unmovedGroups } from '@/lib/depot/routes/allocationGroups';
import { ROUTES_TEXT } from '@/lib/depot/routes/routesPageText';
import { AllocationSection } from './AllocationPanel';
import { ProfileCoverage } from './ProfileCoverage';
import { RouteTable } from './RouteTable';
import { UnmovedRoutes } from './UnmovedRoutes';

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
 * Route intelligence for the whole network: the allocation recommendation
 * (the hero), the routes it would not move and why, profile coverage, and the
 * route table. Both endpoints are network-wide; the table's depot filter
 * narrows only the table, so no network total is passed off as one depot's.
 */
export function RoutesPage() {
  const routes = useDepotRoutes();
  const allocation = useDepotAllocation();
  const routeData = routes.data;
  const plan = allocation.data;

  const groups = useMemo(() => {
    if (plan === null) return null;
    const names = depotNameMap(routeData?.routes ?? []);
    return unmovedGroups(plan.unchanged, plan.excluded, plan.params, names);
  }, [plan, routeData]);

  if (routes.loading && allocation.loading) return <RoutesLoading />;

  const stale =
    (routeData !== null && (routeData.stale || routes.error !== null)) ||
    (plan !== null && (plan.stale || allocation.error !== null));
  const strip = stale ? <StaleStrip since={routeData?.feedNow ?? plan?.feedNow ?? null} /> : null;

  if (routeData !== null && routeData.routes.length === 0) {
    return (
      <>
        {strip}
        <EmptyState>{ROUTES_TEXT.noRoutes}</EmptyState>
      </>
    );
  }

  const profiled = plan?.coverage.profiled ?? routeData?.coverage.profiled ?? null;
  const showUnmoved = plan !== null && groups !== null && (plan.coverage.planned.n > 0 || groups.length > 0);

  return (
    <>
      {strip}
      <AllocationSection state={allocation} />
      {showUnmoved ? <UnmovedRoutes groups={groups} /> : null}
      {profiled !== null ? <ProfileCoverage profiled={profiled} /> : null}
      <section aria-labelledby={TABLE_TITLE_ID}>
        <h2 id={TABLE_TITLE_ID} className="depot-section-label">
          {ROUTES_TEXT.tableTitle}
        </h2>
        {routes.loading ? (
          <LoadingBlock rows={10} label="Loading the route table" />
        ) : routeData !== null ? (
          <RouteTable routes={routeData.routes} />
        ) : (
          <ErrorPanel message={routes.error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={routes.refresh} />
        )}
      </section>
    </>
  );
}
