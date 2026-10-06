'use client';

import { createContext, useContext } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';

const DepotScopeIdContext = createContext<string | null>(null);

/**
 * Set by the depot-scope layout so every page header under it names the depot above
 * its title without each page passing it.
 */
export function DepotScopeIdProvider({
  depotId,
  children,
}: {
  readonly depotId: string;
  readonly children: React.ReactNode;
}) {
  return <DepotScopeIdContext.Provider value={depotId}>{children}</DepotScopeIdContext.Provider>;
}

/**
 * The mono label above a depot page's title: the depot's name from the network feed,
 * "Depot <id>" while it is unknown. Renders nothing outside a depot scope.
 */
export function DepotEyebrow() {
  const depotId = useContext(DepotScopeIdContext);
  // Outside a depot scope (the network pages, the not-found page) there is no feed to ask.
  return depotId === null ? null : <DepotEyebrowName depotId={depotId} />;
}

function DepotEyebrowName({ depotId }: { readonly depotId: string }) {
  const { data } = useDepotNetworkContext();
  const name = data?.depots.find((depot) => depot.id === depotId)?.name;
  return <div className="depot-eyebrow">{name ?? `Depot ${depotId}`}</div>;
}
