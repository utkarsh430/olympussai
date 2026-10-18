import { requireProjectSession } from '@/lib/auth/server';
import { FORECASTS_PATH } from '@/lib/depot/os/workspaces';
import { ForecastsView } from '@/components/depot/os/performance/ForecastsView';

/** Predictive forecasts for Headquarters. */
export default async function ForecastsPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(FORECASTS_PATH);
  return <ForecastsView />;
}
