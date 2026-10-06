import { YardPage } from '@/components/depot/yard/YardPage';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** Who is in this depot's yard right now, on a yard learned from where its buses park. */
export default async function DepotYardPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/yard');

  return (
    <>
      <PageHeader
        title="Yard"
        description="Who is in this depot's yard now, on a yard inferred from where buses park."
        provenanceLine={{ default: 'derived' }}
      />
      <YardPage />
    </>
  );
}
