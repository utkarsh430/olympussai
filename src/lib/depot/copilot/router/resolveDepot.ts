export interface DepotRef {
  readonly id: string;
  readonly name: string;
}

const MIN_PARTIAL_CHARS = 3;

const only = (matches: readonly DepotRef[]): string | null =>
  matches.length === 1 && matches[0] ? matches[0].id : null;

/**
 * The server's own lookup of a depot a question refers to. Order: exact id,
 * exact name, then a unique prefix, then a unique substring. Ambiguity or
 * absence is null: a guess here would answer about the wrong depot.
 */
export function resolveDepot(nameOrId: string, depots: readonly DepotRef[]): string | null {
  const text = nameOrId.trim().toLowerCase();
  if (text === '') return null;

  const byId = depots.find((d) => d.id === nameOrId.trim());
  if (byId) return byId.id;

  const exact = only(depots.filter((d) => d.name.toLowerCase() === text));
  if (exact) return exact;
  if (text.length < MIN_PARTIAL_CHARS) return null;

  const prefix = depots.filter((d) => d.name.toLowerCase().startsWith(text));
  if (prefix.length > 0) return only(prefix);
  return only(depots.filter((d) => d.name.toLowerCase().includes(text)));
}
