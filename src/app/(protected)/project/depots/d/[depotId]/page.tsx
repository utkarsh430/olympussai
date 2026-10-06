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
        description="What is on the road, what is standing, what is late out and what needs attention, on the latest snapshot of the feed."
      />
      <DepotCockpit />
    </>
  );
}
