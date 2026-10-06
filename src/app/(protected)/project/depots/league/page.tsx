import { requireProjectSession } from '@/lib/auth/server';
import { LeagueTable } from '@/components/depot/league/LeagueTable';
import { PageHeader } from '@/components/depot/shell/PageHeader';

const LEAGUE_PATH = '/project/depots/league';

/** Depots ranked by the efficiency index within peer groups of similar fleet size. */
export default async function DepotLeaguePage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(LEAGUE_PATH);

  return (
    <>
      <PageHeader
        title="League table"
        description="Depots ranked by efficiency index within peer groups of similar fleet size."
        provenanceLine={{ default: 'derived', indexWindow: true }}
      />
      <LeagueTable />
    </>
  );
}
