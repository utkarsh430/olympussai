import { nearDistanceM, type NearPoint } from './geo';

/*
 * Groups standing next to each other are one place. Clustering
 * links buses within the link distance; a compound with two parking areas whose
 * nearest buses stand a little further apart than that comes out as two groups
 * or one depending on which buses happen to stand at the edges. This step looks
 * one distance further: starting from the largest group, it takes in any group
 * whose nearest bus stands within `adjacentM` of a bus already in the place,
 * unless that would make the place wider than `maxSpanM`, and looks again after
 * each one it takes, so a chain of near groups becomes one place.
 *
 * Groups are offered in the order the clustering gives them: largest first,
 * equal sizes in the order of their lowest core index. Only groups are taken
 * in, never a bus that belongs to none.
 *
 * Every pair of grouped buses is measured once, the same cost as clustering
 * them, and the place then grows over the groups alone.
 */

/** The place grown from the largest group, and the largest group left outside it. */
export interface AdjacentPlace {
  /** Indices of the points in the place, ascending. */
  readonly members: readonly number[];
  /** Size of the largest group not taken into the place; 0 when every group was. */
  readonly rivalSize: number;
}

/** Nearest and farthest distance between every two groups, and each group's own span. */
interface GroupDistances {
  readonly gap: readonly (readonly number[])[];
  readonly reach: readonly (readonly number[])[];
  readonly span: readonly number[];
}

function measureGroups(
  points: readonly NearPoint[],
  groups: readonly (readonly number[])[],
): GroupDistances {
  const k = groups.length;
  const gap = groups.map(() => new Array<number>(k).fill(Infinity));
  const reach = groups.map(() => new Array<number>(k).fill(0));
  const span = new Array<number>(k).fill(0);
  const grouped = groups.flatMap((group, g) => group.map((index) => [index, g] as const));
  for (let i = 0; i < grouped.length; i += 1) {
    const [a, ga] = grouped[i]!;
    for (let j = i + 1; j < grouped.length; j += 1) {
      const [b, gb] = grouped[j]!;
      const metres = nearDistanceM(points[a]!, points[b]!);
      if (ga === gb) {
        span[ga] = Math.max(span[ga]!, metres);
        continue;
      }
      const lowest = Math.min(gap[ga]![gb]!, metres);
      const highest = Math.max(reach[ga]![gb]!, metres);
      gap[ga]![gb] = lowest;
      gap[gb]![ga] = lowest;
      reach[ga]![gb] = highest;
      reach[gb]![ga] = highest;
    }
  }
  return { gap, reach, span };
}

/**
 * Grow a place from the first (largest) of `groups`, as described above.
 * `groups` are lists of indices into `points`, largest first; null when there
 * are none.
 */
export function adjacentPlace(
  points: readonly NearPoint[],
  groups: readonly (readonly number[])[],
  adjacentM: number,
  maxSpanM: number,
): AdjacentPlace | null {
  if (groups.length === 0) return null;
  const { gap, reach, span } = measureGroups(points, groups);
  const inPlace = groups.map((_, g) => g === 0);
  // Distances from the place as it stands to every group, kept up to date as it grows.
  const gapTo = [...gap[0]!];
  const reachTo = [...reach[0]!];
  let placeSpan = span[0]!;

  const takeable = (g: number): boolean =>
    !inPlace[g] && gapTo[g]! <= adjacentM && Math.max(placeSpan, span[g]!, reachTo[g]!) <= maxSpanM;

  // After each group taken, look again from the largest: it may now be in reach.
  let taken = inPlace.findIndex((_, g) => takeable(g));
  while (taken !== -1) {
    inPlace[taken] = true;
    placeSpan = Math.max(placeSpan, span[taken]!, reachTo[taken]!);
    for (let g = 0; g < groups.length; g += 1) {
      gapTo[g] = Math.min(gapTo[g]!, gap[taken]![g]!);
      reachTo[g] = Math.max(reachTo[g]!, reach[taken]![g]!);
    }
    taken = inPlace.findIndex((_, g) => takeable(g));
  }

  const members = groups
    .filter((_, g) => inPlace[g])
    .flat()
    .sort((a, b) => a - b);
  const rival = groups.find((_, g) => !inPlace[g]);
  return { members, rivalSize: rival?.length ?? 0 };
}
