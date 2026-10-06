'use client';

import { createContext, useContext } from 'react';
import { useDepotNetwork, type DepotNetworkState } from '@/hooks/useDepotNetwork';

const DepotNetworkContext = createContext<DepotNetworkState | null>(null);

/**
 * Runs the network poll once for the whole depot shell, so the top bar's feed
 * chip and every page read the same response instead of each polling.
 */
export function DepotNetworkProvider({ children }: { readonly children: React.ReactNode }) {
  const state = useDepotNetwork();
  return <DepotNetworkContext.Provider value={state}>{children}</DepotNetworkContext.Provider>;
}

export function useDepotNetworkContext(): DepotNetworkState {
  const state = useContext(DepotNetworkContext);
  if (!state) {
    throw new Error('useDepotNetworkContext must be used inside <DepotNetworkProvider>');
  }
  return state;
}
