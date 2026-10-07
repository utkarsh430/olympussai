/**
 * The server's own lookup of a route a question names. A route is written as the feed
 * spells it ("VND_1613_ORD_OUT"): a token holding an underscore, or one holding a digit
 * after the word "route" ("route R-77"). It matches a route the snapshot carries
 * exactly, in any case; there is no partial match, since a guess would answer about the
 * wrong route. A route-shaped token that matches nothing is `unknown`, so the question
 * is declined with its own sentence rather than answered about something else.
 */

export type RouteFinding =
  | { readonly found: 'none' }
  | { readonly found: 'unknown' }
  | {
      readonly found: 'known';
      readonly routeName: string;
      /** The question with the route token removed, so its digits are read as nothing else. */
      readonly rest: string;
    };

const UNDERSCORED = /[a-z0-9-]*_[a-z0-9_-]*/g;
const AFTER_ROUTE = /\broute\s([a-z0-9_-]*\d[a-z0-9_-]*)/g;

interface Candidate {
  readonly token: string;
  readonly start: number;
}

function candidatesOf(text: string): readonly Candidate[] {
  const found = [
    ...[...text.matchAll(UNDERSCORED)].map((m) => ({ token: m[0], start: m.index ?? 0 })),
    ...[...text.matchAll(AFTER_ROUTE)].map((m) => ({
      token: m[1] ?? '',
      start: (m.index ?? 0) + m[0].length - (m[1] ?? '').length,
    })),
  ];
  return found.filter((c) => c.token.length > 0).sort((a, b) => a.start - b.start);
}

/** The first route a lower-cased, sanitised question names, against the snapshot's routes. */
export function findRoute(text: string, routes: readonly string[]): RouteFinding {
  const candidates = candidatesOf(text);
  if (candidates.length === 0) return { found: 'none' };
  const byLower = new Map(routes.map((r) => [r.toLowerCase(), r] as const));
  for (const candidate of candidates) {
    const routeName = byLower.get(candidate.token);
    if (routeName === undefined) continue;
    const end = candidate.start + candidate.token.length;
    return { found: 'known', routeName, rest: `${text.slice(0, candidate.start)} ${text.slice(end)}` };
  }
  return { found: 'unknown' };
}
