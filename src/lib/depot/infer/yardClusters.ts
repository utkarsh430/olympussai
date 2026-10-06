import { nearDistanceM, type NearPoint } from './geo';

/*
 * Density clustering by distance alone, with no grid: where a place begins and
 * ends depends only on how far its points are from each other, never on where
 * a cell boundary happens to fall.
 *
 * A point is a core point when at least `coreMin` points, itself included, lie
 * within `linkM` of it. Core points within `linkM` of each other are one
 * cluster. Any other point within `linkM` of a core point is a border member of
 * that core point's cluster and of no other: it never passes the link on, so a
 * line of single points cannot join two clusters. The rest belong to nothing.
 *
 * Every pair is compared once. A depot has at most a few hundred parked buses,
 * so that is tens of thousands of cheap comparisons, not worth an index.
 */

const NONE = -1;

/** For each point, the indices of the others within `linkM`, ascending. */
function neighbours(points: readonly NearPoint[], linkM: number): readonly (readonly number[])[] {
  const near: number[][] = points.map(() => []);
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (nearDistanceM(points[i]!, points[j]!) > linkM) continue;
      near[i]!.push(j);
      near[j]!.push(i);
    }
  }
  return near;
}

/** Cluster number of every core point (others NONE), numbered from the lowest index. */
function linkCores(
  near: readonly (readonly number[])[],
  isCore: readonly boolean[],
): readonly number[] {
  const clusterOf = new Array<number>(near.length).fill(NONE);
  let clusters = 0;
  for (let start = 0; start < near.length; start += 1) {
    if (!isCore[start] || clusterOf[start] !== NONE) continue;
    clusterOf[start] = clusters;
    const reached = [start];
    while (reached.length > 0) {
      const from = reached.pop() as number;
      for (const next of near[from]!) {
        if (!isCore[next] || clusterOf[next] !== NONE) continue;
        clusterOf[next] = clusters;
        reached.push(next);
      }
    }
    clusters += 1;
  }
  return clusterOf;
}

/**
 * The cluster a non-core point borders: that of its nearest core point within
 * reach, the lowest index winning an exact tie; NONE when no core point is.
 */
function borderCluster(
  index: number,
  points: readonly NearPoint[],
  near: readonly (readonly number[])[],
  isCore: readonly boolean[],
  clusterOf: readonly number[],
): number {
  let nearest = NONE;
  let nearestM = Infinity;
  for (const other of near[index]!) {
    if (!isCore[other]) continue;
    const metres = nearDistanceM(points[index]!, points[other]!);
    if (metres >= nearestM) continue;
    nearest = other;
    nearestM = metres;
  }
  return nearest === NONE ? NONE : clusterOf[nearest]!;
}

/**
 * Clusters of `points` as lists of ascending indices, largest first; clusters
 * of equal size keep the order of their lowest core index. The result is a
 * function of the points and their order alone, so callers that need an answer
 * independent of input order sort the points first.
 */
export function densityClusters(
  points: readonly NearPoint[],
  linkM: number,
  coreMin: number,
): readonly (readonly number[])[] {
  const near = neighbours(points, linkM);
  const isCore = near.map((others) => others.length + 1 >= coreMin);
  const coreClusterOf = linkCores(near, isCore);

  const count = coreClusterOf.reduce((highest, cluster) => Math.max(highest, cluster), NONE) + 1;
  const clusters: number[][] = Array.from({ length: count }, () => []);
  for (let index = 0; index < points.length; index += 1) {
    const cluster = isCore[index]
      ? coreClusterOf[index]!
      : borderCluster(index, points, near, isCore, coreClusterOf);
    if (cluster !== NONE) clusters[cluster]!.push(index);
  }
  // Array.prototype.sort is stable, so equal sizes stay in lowest-core order.
  return clusters.sort((a, b) => b.length - a.length);
}
