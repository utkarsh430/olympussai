import { DepotTrends } from '@/components/depot/trends/DepotTrends';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';
import { parseTrendMetric, TREND_METRIC_PARAM } from '@/lib/depot/forecast/trendsPageModel';

type SearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

/** One depot's trend and forecast for one measure, and its buses against the requirement. */
export default async function DepotTrendsForDepotPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
  readonly searchParams: SearchParams;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/trends');
  // An unknown measure falls back to the default rather than failing the page.
  const metric = parseTrendMetric((await searchParams)[TREND_METRIC_PARAM]);

  return (
    <>
      <PageHeader
        title="Trends"
        description="Where this depot's measures have been and where they are heading, and whether the buses it is forecast to have available cover its modelled requirement."
        provenance="modelled"
      />
      <DepotTrends metric={metric} />
    </>
  );
}
