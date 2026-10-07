import { Suspense } from 'react';
import { RouteHourlyPage } from '@/components/depot/service/RouteHourlyPage';
import { RouteHourlyHeader, RouteHourlyScreen } from '@/components/depot/service/RouteHourlyScreen';
import { requireRoutePage } from '@/lib/depot/depotGate';

/** One route's day hour by hour: deployed, scheduled and needed buses, the gap and proposals. */
export default async function RouteHourlyRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly routeName: string }>;
}) {
  const { routeName } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself; the name is
  // checked before the session gate sees it.
  await requireRoutePage(routeName);

  return (
    <Suspense
      fallback={
        <>
          <RouteHourlyHeader routeName={routeName} response={null} />
          <RouteHourlyPage response={null} error={null} loading />
        </>
      }
    >
      <RouteHourlyScreen routeName={routeName} />
    </Suspense>
  );
}
