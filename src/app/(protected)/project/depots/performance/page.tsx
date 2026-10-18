import { requireProjectSession } from '@/lib/auth/server';
import { PERFORMANCE_PATH } from '@/lib/depot/os/workspaces';
import { PerformanceView } from '@/components/depot/os/performance/PerformanceView';

/** Depot performance intelligence: rankings, peer scatter and the index breakdown. */
export default async function DepotPerformancePage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(PERFORMANCE_PATH);
  return <PerformanceView />;
}
