import { CockpitIndexMeta } from '@/components/depot/cockpit/CockpitIndexMeta';
import { DepotCockpit } from '@/components/depot/cockpit/DepotCockpit';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The depot cockpit: what is on the road, standing, late out, and needs attention. */
export default async function DepotCockpitPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId);

  return (
    <>
      <PageHeader
        title="Depot cockpit"
        description="What needs attention now, what is available, and what leaves the yard next."
        provenanceLine={{ default: 'derived' }}
        controls={<CockpitIndexMeta />}
      />
      <DepotCockpit />
    </>
  );
}
