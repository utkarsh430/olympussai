'use client';

import { createContext, useContext, useMemo } from 'react';
import { useDepotDetail, type DepotDetailState } from '@/hooks/useDepotDetail';

export interface DepotDetailContextValue extends DepotDetailState {
  readonly depotId: string;
}

const DepotDetailContext = createContext<DepotDetailContextValue | null>(null);

/**
 * Runs the detail poll once per depot scope, so every page under it reads the same
 * response instead of each polling.
 */
export function DepotDetailProvider({
  depotId,
  children,
}: {
  readonly depotId: string;
  readonly children: React.ReactNode;
}) {
  const state = useDepotDetail(depotId);
  const { data, error, loading, refresh } = state;
  const value = useMemo(
    () => ({ depotId, data, error, loading, refresh }),
    [depotId, data, error, loading, refresh],
  );
  return <DepotDetailContext.Provider value={value}>{children}</DepotDetailContext.Provider>;
}

export function useDepotDetailContext(): DepotDetailContextValue {
  const value = useContext(DepotDetailContext);
  if (!value) {
    throw new Error('useDepotDetailContext must be used inside <DepotDetailProvider>');
  }
  return value;
}
