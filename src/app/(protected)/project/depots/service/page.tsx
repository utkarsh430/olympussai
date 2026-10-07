import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { NetworkServicePage } from '@/components/depot/service/NetworkServicePage';
import { NetworkServiceHeader, NetworkServiceScreen } from '@/components/depot/service/NetworkServiceScreen';
import { SERVICE_PATH } from '@/lib/depot/nav';

/** The network's day hour by hour: routes short and over by band, the proposals and the moves. */
export default async function NetworkServiceRoutePage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(SERVICE_PATH);

  return (
    <Suspense
      fallback={
        <>
          <NetworkServiceHeader response={null} />
          <NetworkServicePage response={null} error={null} loading />
        </>
      }
    >
      <NetworkServiceScreen />
    </Suspense>
  );
}
