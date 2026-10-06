import type { DepotKind } from '../types';

/**
 * The feed lists enforcement squads, hired fleets and electric fleets beside
 * operating depots. The kind is read from the name; whole-word matching keeps
 * a place name that merely contains "HIRED" a depot.
 */
export function classifyDepotKind(name: string | null): DepotKind {
  const trimmed = name?.trim() ?? '';
  if (trimmed === '') return 'unassigned';
  if (/^ENFORCEMENT/i.test(trimmed)) return 'enforcement';
  if (/\bHIRED\b/i.test(trimmed)) return 'hired';
  if (/\bELECTRIC\b/i.test(trimmed)) return 'electric';
  return 'depot';
}
