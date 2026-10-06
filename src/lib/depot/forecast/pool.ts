/**
 * Pooling for thin horizons. With a short history the far horizons have few
 * scored forecasts (a 28-day history has none 22 days ahead), and a quantile
 * of three errors means little. The rule: a horizon with fewer than
 * `minSamples` errors borrows whole horizons in order of distance from it,
 * the longer first on a tie (its errors are the larger, so the band errs
 * wide), until it holds at least `minSamples` or every horizon is used.
 */

/** Index order to borrow from for horizon index `i` of `count`, nearest first. */
function byDistance(i: number, count: number): number[] {
  const order: number[] = [i];
  for (let d = 1; d < count; d += 1) {
    if (i + d < count) order.push(i + d);
    if (i - d >= 0) order.push(i - d);
  }
  return order;
}

export function pooledErrors(
  raw: readonly (readonly number[])[],
  minSamples: number,
): readonly (readonly number[])[] {
  return raw.map((own, i) => {
    if (own.length >= minSamples) return own;
    const pooled: number[] = [];
    for (const j of byDistance(i, raw.length)) {
      pooled.push(...(raw[j] as readonly number[]));
      if (pooled.length >= minSamples) break;
    }
    return pooled;
  });
}
