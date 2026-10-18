import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { DECISIONS_PATH } from '@/lib/depot/os/workspaces';
import { DecisionCenter } from '@/components/depot/os/decisions/DecisionCenter';

/** The AI Decision Center at Headquarters (or the chosen region). */
export default async function DecisionCenterPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(DECISIONS_PATH);
  return (
    <Suspense fallback={null}>
      <DecisionCenter />
    </Suspense>
  );
}
