import { isValidDepotId } from '../ids';
import type { ExceptionKind } from './types';
import { parseKindParam } from './pageModel';

/**
 * The exceptions page's address: `?kind=<kind>` selects a kind's figure and `?depot=<id>`
 * narrows the bus list to one depot (the depot cockpit links here with both). Each is
 * validated on entry; an unknown kind or a malformed id is ignored, never an error.
 */

const KIND = 'kind';
const DEPOT = 'depot';

export interface ExceptionEntry {
  readonly kind: ExceptionKind | null;
  readonly depotId: string | null;
}

export function entryParams(search: string): ExceptionEntry {
  const params = new URLSearchParams(search);
  const depot = params.get(DEPOT);
  return {
    kind: parseKindParam(params.get(KIND)),
    depotId: isValidDepotId(depot) ? depot : null,
  };
}

/** The query string for the page's filters, keeping any other parameter; '' when none is left. */
export function exceptionSearch(search: string, entry: ExceptionEntry): string {
  const params = new URLSearchParams(search);
  if (entry.kind === null) params.delete(KIND);
  else params.set(KIND, entry.kind);
  if (entry.depotId === null) params.delete(DEPOT);
  else params.set(DEPOT, entry.depotId);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
