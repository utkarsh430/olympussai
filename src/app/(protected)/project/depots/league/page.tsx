import { requireProjectSession } from '@/lib/auth/server';
import { LeagueTable } from '@/components/depot/league/LeagueTable';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';

const LEAGUE_PATH = '/project/depots/league';

/** Depots ranked by the efficiency index within peer groups of similar fleet size. */
export default async function DepotLeaguePage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(LEAGUE_PATH);

  return (
    <>
      <PageHeader
        title="League table"
        description="One snapshot of the live feed, compared within peer groups of similar fleet size."
      >
        <ProvenanceBadge provenance="derived" />
      </PageHeader>
      <LeagueTable />
    </>
  );
}
