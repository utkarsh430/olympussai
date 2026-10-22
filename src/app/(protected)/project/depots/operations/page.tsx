import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { OPERATIONS_PATH } from '@/lib/depot/os/workspaces';
import { DepotChooser } from '@/components/depot/os/DepotChooser';

/** Depot Operations at Headquarters: every depot's state and balance, each opening its readiness board. */
export default async function DepotOperationsPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(OPERATIONS_PATH);
  return (
    <Suspense fallback={null}>
      <DepotChooser
        viewKey="readiness"
        title="Depot operations"
        description="Each depot's fleet state, peak balance and open decisions. Open one for its departure readiness, roster, yard, duties and crew."
      />
    </Suspense>
  );
}
