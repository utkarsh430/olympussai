import { requireProjectSession } from '@/lib/auth/server';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { NetworkOverview } from '@/components/depot/network/NetworkOverview';

/** Headquarters overview: figures, map, rankings, exceptions and the depot table. */
export default async function DepotsOverviewPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(DEPOTS_ROOT);

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
