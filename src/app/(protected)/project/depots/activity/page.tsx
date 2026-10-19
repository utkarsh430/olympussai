import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { ACTIVITY_PATH } from '@/lib/depot/os/workspaces';
import { ActivityView } from '@/components/depot/os/ai/ActivityView';

/** The AI engine's activity across the network (or the chosen region). */
export default async function NetworkActivityPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(ACTIVITY_PATH);
  return (
    <Suspense fallback={null}>
      <ActivityView />
    </Suspense>
  );
}
