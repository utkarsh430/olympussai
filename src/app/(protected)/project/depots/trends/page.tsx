import { requireProjectSession } from '@/lib/auth/server';
import { NetworkTrends } from '@/components/depot/trends/NetworkTrends';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import {
  parseTrendMetric,
  TREND_METRIC_PARAM,
} from '@/lib/depot/forecast/trendsPageModel';
import { NETWORK_TRENDS_PATH } from '@/lib/depot/nav';

type SearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

/** The network's trend and forecast for one measure, and every unit's trend beside it. */
export default async function DepotTrendsPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(NETWORK_TRENDS_PATH);
  // An unknown measure falls back to the default rather than failing the page.
  const metric = parseTrendMetric((await searchParams)[TREND_METRIC_PARAM]);

  return (
    <>
      <PageHeader
        title="Trends"
        description="Where each network measure has been and where it is heading, with a forecast range."
        provenanceLine={{
          default: 'modelled',
          replacedBy: 'a database of real history',
          feedId: 'history-store',
        }}
      />
      <NetworkTrends metric={metric} />
    </>
  );
}
