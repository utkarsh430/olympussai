import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { FUEL_AUDIT_PATH } from '@/lib/depot/os/workspaces';
import { FuelAuditView } from '@/components/depot/os/finance/FuelAuditView';

/** The fuel audit across Headquarters (or the chosen region). */
export default async function FuelAuditPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(FUEL_AUDIT_PATH);
  return (
    <Suspense fallback={null}>
      <FuelAuditView />
    </Suspense>
  );
}
