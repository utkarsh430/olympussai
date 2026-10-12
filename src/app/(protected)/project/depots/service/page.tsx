import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { RedistributionHeader, RedistributionScreen } from '@/components/depot/redistribution/RedistributionScreen';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { SERVICE_PATH } from '@/lib/depot/nav';

/** The AI Redistribution Engine: hourly demand against supply, the engine's transfers and their projected impact. */
export default async function RedistributionRoutePage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(SERVICE_PATH);

  return (
    <Suspense
      fallback={
        <>
          <RedistributionHeader />
          <LoadingBlock rows={8} label="Loading the network's hours" />
        </>
      }
    >
      <RedistributionScreen />
    </Suspense>
  );
}
