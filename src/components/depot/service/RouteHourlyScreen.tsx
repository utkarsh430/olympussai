'use client';

import { PageHeader } from '@/components/depot/shell/PageHeader';
import { useRouteHourly } from '@/hooks/useRouteHourly';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';
import { RouteHourlyPage, routeHourlyProvenance } from './RouteHourlyPage';

export const ROUTE_HOURLY_TITLE = 'Hour by hour';
export const ROUTE_HOURLY_DESCRIPTION =
  'Buses deployed, scheduled and needed on this route in each hour of the day.';

export interface RouteHourlyHeaderProps {
  readonly routeName: string;
  readonly response: RouteHourlyResponse | null;
}

/**
 * The route day's header in every state: the route name as the mono label, the title, one
 * sentence, and the MIXED provenance line, which carries the coverage once the day has
 * loaded so nothing sits between the header and the chart.
 */
export function RouteHourlyHeader({ routeName, response }: RouteHourlyHeaderProps) {
  return (
    <PageHeader
      eyebrow={routeName}
      title={ROUTE_HOURLY_TITLE}
      description={ROUTE_HOURLY_DESCRIPTION}
      provenanceLine={routeHourlyProvenance(response)}
    />
  );
}

/** One route's day hour by hour: the header and the page body, on one poll of the route. */
export function RouteHourlyScreen({ routeName }: { readonly routeName: string }) {
  const { data, error, loading, refresh } = useRouteHourly(routeName);
  return (
    <>
      <RouteHourlyHeader routeName={routeName} response={data} />
      <RouteHourlyPage response={data} error={error} loading={loading} onRetry={refresh} />
    </>
  );
}
