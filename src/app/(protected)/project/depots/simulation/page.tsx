import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { SIMULATION_PATH } from '@/lib/depot/os/workspaces';
import { ScenarioStudio } from '@/components/depot/os/performance/ScenarioStudio';

/** The Scenario Studio: what-if levers on the network's fleet distribution. */
export default async function ScenarioStudioPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(SIMULATION_PATH);
  return (
    <Suspense fallback={null}>
      <ScenarioStudio />
    </Suspense>
  );
}
