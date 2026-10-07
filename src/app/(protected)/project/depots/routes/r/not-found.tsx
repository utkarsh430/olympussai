import Link from 'next/link';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { ROUTES_PATH } from '@/lib/depot/nav';

/**
 * A route address whose name cannot be a feed route name. The route page's gate refuses
 * the name before anything else runs; this renders inside the depot shell.
 */
export default function RouteNotFound() {
  return (
    <>
      <PageHeader
        title="Route not found"
        description="This route address is not valid: route names are the feed's own names."
      />
      <EmptyState>
        Choose a route from the route table.{' '}
        <Link href={ROUTES_PATH} className="depot-link">
          Back to the routes
        </Link>
      </EmptyState>
    </>
  );
}
