import { depotIdFromPath, depotNav, type ScopeDepot } from './depotNav';
import { NETWORK_NAV, type DepotNavGroup } from './nav';
import { depotScopeState } from './scopeState';

/**
 * Navigation model for the shell: which groups the left rail shows
 * from 1280px, and what the single strip shows below 1280px. One decision for both, so
 * the rail and the strip never disagree about the scope. Pure, so it is tested.
 */

export interface ShellNav {
  /** The depot's own group (its name and its pages), or null in network scope or for an unknown depot. */
  readonly depotGroup: DepotNavGroup | null;
  /** The network groups, always present. */
  readonly networkGroups: readonly DepotNavGroup[];
}

/**
 * The depot group leads when the address names a depot the feed does not positively
 * deny (`depotScopeState`): while the list loads or failed, the group is kept and
 * headed "Depot <id>". A malformed or unknown depot gets no depot group, so no link
 * leads to a page that cannot exist.
 */
export function shellNav(pathname: string, depots: readonly ScopeDepot[] | null): ShellNav {
  const depotId = depotIdFromPath(pathname);
  if (depotId === null) return { depotGroup: null, networkGroups: NETWORK_NAV };
  const scope = depotScopeState({ depotId, depots, detailError: null });
  if (!scope.known) return { depotGroup: null, networkGroups: NETWORK_NAV };
  const name = depots?.find((depot) => depot.id === depotId)?.name ?? `Depot ${depotId}`;
  return {
    depotGroup: { heading: name, items: depotNav(depotId) },
    networkGroups: NETWORK_NAV,
  };
}

/**
 * The prototype disclaimer as the depot shell prints it: the shared sentence without its
 * leading "Prototype.", because the PROTOTYPE pill directly before it already says so.
 * The shared constant, and every other surface that prints it, stay unchanged.
 */
export function depotDisclaimerText(sentence: string): string {
  return sentence.replace(/^Prototype\.\s+/, '');
}

/** The rail's groups from 1280px: the depot first when there is one, then the network. */
export function railGroups(nav: ShellNav): readonly DepotNavGroup[] {
  return nav.depotGroup ? [nav.depotGroup, ...nav.networkGroups] : nav.networkGroups;
}
