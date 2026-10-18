import { requireProjectSession } from '@/lib/auth/server';
import { DATA_HEALTH_PATH } from '@/lib/depot/os/workspaces';
import { IntegrationHealth } from '@/components/depot/os/system/IntegrationHealth';

/** Integration health and data quality. */
export default async function IntegrationHealthPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(DATA_HEALTH_PATH);
  return <IntegrationHealth />;
}
