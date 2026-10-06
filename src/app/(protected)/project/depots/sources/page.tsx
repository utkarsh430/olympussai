import { requireProjectSession } from '@/lib/auth/server';
import { SourcesRegistry } from '@/components/depot/sources/SourcesRegistry';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { SOURCES_PATH } from '@/lib/depot/nav';

/** Where each figure comes from: live feeds, how well they are populated, and feeds still awaited. */
export default async function DepotSourcesPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(SOURCES_PATH);

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Every feed behind this module, how fully it is populated, and what a real feed must provide."
        provenanceLine={{ default: 'reference' }}
      />
      <SourcesRegistry />
    </>
  );
}
