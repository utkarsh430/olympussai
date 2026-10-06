import { requireProjectSession } from '@/lib/auth/server';
import { ExceptionCentre } from '@/components/depot/exceptions/ExceptionCentre';
import { PageHeader } from '@/components/depot/shell/PageHeader';

const EXCEPTIONS_PATH = '/project/depots/exceptions';

/** Depots and buses that need attention, described with the numbers behind them. */
export default async function DepotExceptionsPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(EXCEPTIONS_PATH);

  return (
    <>
      <PageHeader
        title="Exceptions"
        description="Depots and buses that stand out now, each with the figures behind it."
        provenanceLine={{ default: 'derived' }}
      />
      <ExceptionCentre />
    </>
  );
}
