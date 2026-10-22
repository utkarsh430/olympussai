import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { CHOOSE_DEPOT_PATH } from '@/lib/depot/os/workspaces';
import { DepotChooser } from '@/components/depot/os/DepotChooser';

/** A per-depot view opened from Headquarters: the person picks the depot first. */
export default async function ChooseDepotPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(CHOOSE_DEPOT_PATH);
  return (
    <Suspense fallback={null}>
      <DepotChooser />
    </Suspense>
  );
}
