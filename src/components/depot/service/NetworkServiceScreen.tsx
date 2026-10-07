'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { useNetworkHourly, type NetworkHourlyAsk } from '@/hooks/useNetworkHourly';
import { isValidDepotId } from '@/lib/depot/ids';
import { isServiceBandKey } from '@/lib/depot/service/networkHours';
import { networkProvenance } from '@/lib/depot/service/networkPageModel';
import { NETWORK_SERVICE_DESCRIPTION, NETWORK_SERVICE_TITLE } from '@/lib/depot/service/networkWording';
import type { NetworkHourlyResponse } from '@/lib/depot/service/types';
import { NetworkServicePage } from './NetworkServicePage';

/** The page's header in every state, with its one MIXED provenance line. */
export function NetworkServiceHeader({ response }: { readonly response: NetworkHourlyResponse | null }) {
  return (
    <PageHeader
      title={NETWORK_SERVICE_TITLE}
      description={NETWORK_SERVICE_DESCRIPTION}
      provenanceLine={networkProvenance(response)}
    />
  );
}

/** The first ask from the address (`?band=`, `?depot=`), each kept only when well formed. */
function initialAsk(params: URLSearchParams | null): NetworkHourlyAsk {
  const band = params?.get('band') ?? null;
  const depot = params?.get('depot') ?? null;
  return {
    band: isServiceBandKey(band) ? band : null,
    depotId: isValidDepotId(depot) ? depot : null,
    page: 0,
  };
}

/** The network's day hour by hour: the header and the page body, on one poll of the band asked. */
export function NetworkServiceScreen() {
  const params = useSearchParams();
  const [ask, setAsk] = useState<NetworkHourlyAsk>(() => initialAsk(params));
  const { data, error, loading, refresh } = useNetworkHourly(ask);
  return (
    <>
      <NetworkServiceHeader response={data} />
      <NetworkServicePage
        response={data}
        error={error}
        loading={loading}
        onRetry={refresh}
        onBand={(band) => setAsk((a) => ({ ...a, band, page: 0 }))}
        onDepot={(depotId) => setAsk((a) => ({ ...a, depotId, page: 0 }))}
        onPage={(page) => setAsk((a) => ({ ...a, page }))}
      />
    </>
  );
}
