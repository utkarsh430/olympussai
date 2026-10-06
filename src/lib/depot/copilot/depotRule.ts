import { NAME_LIST_MARK } from '@/lib/depot/copilot/limits';
import { clauseOf } from '@/lib/depot/copilot/figureWindow';

/** The token shape the grammar parses; only what this check reads. */
type Token =
  | { readonly kind: 'word'; readonly core: string; readonly mark: string }
  | { readonly kind: 'placeholder'; readonly id: string; readonly mark: string };

/** What this rule needs of a fact: whether it is a figure, and the depot it describes. */
interface DepotEdges {
  readonly figure: boolean;
  readonly depot?: string;
}

export type DepotProblem = 'figure_depot';

/** The list entry that holds `index`: the tokens between the commas around it, in its clause. */
function entryOf(
  tokens: readonly Token[],
  index: number,
  start: number,
  end: number,
): readonly [number, number] {
  let first = index;
  while (first > start && tokens[first - 1]?.mark !== NAME_LIST_MARK) first -= 1;
  let last = index;
  while (last < end && tokens[last]?.mark !== NAME_LIST_MARK) last += 1;
  return [first, last];
}

/**
 * Closing review M-A: "3 buses are dark at KAUSHAMBI." used AGRA's count. Where a
 * request holds more than one depot, each name and per-depot figure knows its depot
 * (`CopilotFact.depotId`). A figure with a depot is refused when, in its clause,
 *  - a name of another depot stands in the same list entry (between the same commas), or
 *  - the name it reads as belonging to is another depot's: the nearest name before it in
 *    the clause, or, with none before it, the nearest name after it.
 * A list such as "AGRA by 9 buses, KANPUR by 4 buses" keeps each figure with its own name.
 * Figures with no depot (network-wide, or a transfer between two depots) are not checked.
 */
export function depotProblem(
  tokens: readonly Token[],
  edgesOf: (id: string) => DepotEdges,
): DepotProblem | null {
  const nameDepot = (i: number): string | undefined => {
    const token = tokens[i];
    if (token?.kind !== 'placeholder') return undefined;
    const edges = edgesOf(token.id);
    return edges.figure ? undefined : edges.depot;
  };
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'placeholder') continue;
    const { figure, depot } = edgesOf(token.id);
    if (!figure || depot === undefined) continue;
    const [start, end] = clauseOf(tokens, index);
    const named = (from: number, to: number): number[] =>
      Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k).filter(
        (i) => nameDepot(i) !== undefined,
      );
    const [first, last] = entryOf(tokens, index, start, end);
    if (named(first, last).some((i) => nameDepot(i) !== depot)) return 'figure_depot';
    const reads = named(start, index - 1).at(-1) ?? named(index + 1, end)[0];
    if (reads !== undefined && nameDepot(reads) !== depot) return 'figure_depot';
  }
  return null;
}
