import { scopeLabel, type ScopeDepot } from './depotNav';

/** The depot API's error body for an unknown depot; the hooks and the scope state read it. */
export const DEPOT_NOT_FOUND_MESSAGE = 'Depot not found';

export interface DepotScopeInput {
  /** The depot the address names, or null for the network scope. */
  readonly depotId: string | null;
  /** The network feed's depots; null while loading or when the feed failed. */
  readonly depots: readonly ScopeDepot[] | null;
  /** The depot detail's error text, null while loading or on success. */
  readonly detailError: string | null;
}

export interface DepotScopeState {
  /** False only when the feed positively says this depot does not exist. */
  readonly known: boolean;
  readonly label: string;
}

const UNKNOWN_LABEL = 'UPSRTC / Unknown depot';

/**
 * One decision for the top bar's scope label. A depot is unknown only
 * on positive evidence: the detail answered 404, or the network list loaded and
 * lacks the id. A depot whose data is merely loading or failed (a 503) is still
 * that depot: it shows its name if the network has it, else
 * "Depot <id>". The top bar sits above the detail provider, so it passes no
 * `detailError` and decides on the network list alone.
 */
export function depotScopeState({
  depotId,
  depots,
  detailError,
}: DepotScopeInput): DepotScopeState {
  if (depotId === null) return { known: true, label: scopeLabel(null, depots) };
  const missingFromFeed = depots !== null && !depots.some((depot) => depot.id === depotId);
  if (missingFromFeed || detailError === DEPOT_NOT_FOUND_MESSAGE) {
    return { known: false, label: UNKNOWN_LABEL };
  }
  return { known: true, label: scopeLabel(depotId, depots) };
}
