import { requireProjectSession } from '@/lib/auth/server';
import { OVERVIEW_PATH } from '@/lib/depot/os/workspaces';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { NetworkOverview } from '@/components/depot/network/NetworkOverview';

/** Headquarters operations overview: figures, map, rankings, exceptions and the depot table. */
export default async function DepotsOverviewPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(OVERVIEW_PATH);

  return (
    <>
      <PageHeader
        title="Headquarters overview"
        description="Fleet strength, status and efficiency across every UPSRTC depot."
        provenanceLine={{ default: 'derived', indexWindow: true }}
      />
      <NetworkOverview />
    </>
  );
}
