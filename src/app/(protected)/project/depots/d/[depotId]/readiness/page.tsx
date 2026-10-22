import { ReadinessBoard } from '@/components/depot/os/readiness/ReadinessBoard';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** One depot's departure readiness board. */
export default async function DepotReadinessPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/readiness');
  return <ReadinessBoard />;
}
