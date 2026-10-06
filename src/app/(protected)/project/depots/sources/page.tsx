import { requireProjectSession } from '@/lib/auth/server';
import { SourcesRegistry } from '@/components/depot/sources/SourcesRegistry';
import { PageHeader } from '@/components/depot/shell/PageHeader';

const SOURCES_PATH = '/project/depots/sources';

/** Where each figure comes from: live feeds, how well they are populated, and feeds still awaited. */
export default async function DepotSourcesPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(SOURCES_PATH);

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Every feed behind this module: whether it is live, how completely it is populated, and the schema a real feed is expected to provide."
      />
      <SourcesRegistry />
    </>
  );
}
