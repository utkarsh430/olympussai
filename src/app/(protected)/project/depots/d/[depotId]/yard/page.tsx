import { YardPage } from '@/components/depot/yard/YardPage';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireProjectSession } from '@/lib/auth/server';

/** Who is in this depot's yard right now, on a yard learned from where its buses park. */
export default async function DepotYardPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(`/project/depots/d/${depotId}/yard`);

  return (
    <>
      <PageHeader
        title="Yard"
        description="Who is physically in this depot's yard right now. The yard is inferred from where the depot's buses park, not surveyed."
      />
      <YardPage />
    </>
  );
}
