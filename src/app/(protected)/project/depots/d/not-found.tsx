import Link from 'next/link';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { DEPOTS_ROOT } from '@/lib/depot/nav';

/**
 * A depot address whose id cannot be a depot id. It sits above the `[depotId]`
 * layout because that layout is what refuses the id, and a segment's not-found
 * boundary only wraps its children; here it renders inside the depot shell.
 */
export default function DepotNotFound() {
  return (
    <>
      <PageHeader
        title="Depot not found"
        description="This depot address is not valid: depot ids are the feed's home-depot numbers."
      />
      <EmptyState>
        Choose a depot from the scope switcher or the network overview.{' '}
        <Link href={DEPOTS_ROOT} className="depot-link">
          Back to the network overview
        </Link>
      </EmptyState>
    </>
  );
}
