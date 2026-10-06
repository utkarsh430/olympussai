import { notFound } from 'next/navigation';
import { requireProjectSession } from '@/lib/auth/server';
import { DepotCockpit } from '@/components/depot/cockpit/DepotCockpit';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { depotHref } from '@/lib/depot/depotNav';
import { isValidDepotId } from '@/lib/depot/ids';

/** The depot cockpit: what is on the road, standing, late out, and needs attention. */
export default async function DepotCockpitPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  if (!isValidDepotId(depotId)) notFound();
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(depotHref(depotId));

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
