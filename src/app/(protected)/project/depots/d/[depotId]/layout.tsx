import { notFound } from 'next/navigation';
import { requireProjectSession } from '@/lib/auth/server';
import { DepotDetailProvider } from '@/components/depot/data/DepotDetailProvider';
import { DepotScopeIdProvider } from '@/components/depot/shell/DepotEyebrow';
import { DepotSubNav } from '@/components/depot/shell/DepotSubNav';
import { depotHref } from '@/lib/depot/depotNav';
import { isValidDepotId } from '@/lib/depot/ids';

/**
 * One depot's scope: cockpit, roster and yard share this frame. A malformed id is
 * refused before any work, so it never reaches the detail poll. The provider runs
 * one detail poll for every page under the scope. A well-formed id the feed does
 * not know is a page concern: the API answers 404 and the page says so.
 */
export default async function DepotScopeLayout({
  children,
  params,
}: {
  readonly children: React.ReactNode;
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  if (!isValidDepotId(depotId)) notFound();
  await requireProjectSession(depotHref(depotId));

  return (
    <DepotDetailProvider depotId={depotId}>
      <DepotScopeIdProvider depotId={depotId}>
        <DepotSubNav depotId={depotId} />
        {children}
      </DepotScopeIdProvider>
    </DepotDetailProvider>
  );
}
