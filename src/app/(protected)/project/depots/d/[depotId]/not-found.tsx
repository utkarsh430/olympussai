import Link from 'next/link';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { DEPOTS_ROOT } from '@/lib/depot/nav';

/** A depot address that cannot be a depot id. Renders inside the depot shell. */
export default function DepotNotFound() {
  return (
    <>
      <PageHeader title="Depot not found" description="This address does not name a depot." />
      <EmptyState>
        Depot ids are the feed&apos;s home-depot numbers, and this one is not.{' '}
        <Link href={DEPOTS_ROOT} className="depot-link">
          Back to the network overview
        </Link>
      </EmptyState>
    </>
  );
}
