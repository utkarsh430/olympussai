/**
 * Minimum-cost assignment on a rectangular matrix (the Hungarian algorithm,
 * O(n^3), shortest augmenting paths with row/column potentials).
 *
 * `Infinity` marks a forbidden pair. The result maximises the number of
 * assigned rows first, then minimises total cost among such assignments:
 * a forbidden pair is never chosen, a row whose every cell is forbidden stays
 * unassigned, and with more rows than columns the surplus rows stay
 * unassigned. Negative, NaN or ragged input throws a RangeError.
 *
 * Method: the matrix is padded to a square with zero-cost dummy cells, and each
 * forbidden cell is replaced by a penalty larger than any possible sum of real
 * costs, so the square problem minimises the number of forbidden/dummy
 * pairings before it minimises real cost. A real row matched to a dummy or
 * penalised cell is reported as -1.
 *
 * Tie rule: the answer depends only on the matrix. Rows are inserted in index
 * order and, within a shortest-path search, the strictly smaller reduced cost
 * wins, so equal reduced costs resolve to the lowest column index scanned
 * first. This is a fixed scan-order rule, not a lexicographic minimum over all
 * optimal assignments.
 */

export interface HungarianResult {
  /** Column chosen for each row, or -1 when the row is unassigned. */
  readonly rowToCol: readonly number[];
  /** Sum of the chosen finite costs. */
  readonly total: number;
}

function validate(cost: readonly (readonly number[])[]): void {
  const width = cost.length === 0 ? 0 : cost[0].length;
  cost.forEach((row, r) => {
    if (row.length !== width) {
      throw new RangeError(`Cost matrix is ragged: row ${r} has ${row.length}, expected ${width}`);
    }
    row.forEach((value, c) => {
      if (Number.isNaN(value) || value < 0 || value === -Infinity) {
        throw new RangeError(`Cost at [${r}][${c}] must be non-negative or Infinity, got ${value}`);
      }
    });
  });
}

/** Penalty that outweighs any assignment of real costs. */
function penaltyFor(cost: readonly (readonly number[])[], pairs: number): number {
  let largest = 0;
  for (const row of cost) for (const v of row) if (Number.isFinite(v) && v > largest) largest = v;
  return largest * pairs + 1;
}

/** Square min-cost perfect assignment; returns the column for each row (1-based internals). */
function solveSquare(a: readonly (readonly number[])[], n: number): number[] {
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const matchOfCol = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let row = 1; row <= n; row += 1) {
    matchOfCol[0] = row;
    let col0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[col0] = true;
      const row0 = matchOfCol[col0];
      let delta = Infinity;
      let col1 = 0;
      for (let col = 1; col <= n; col += 1) {
        if (used[col]) continue;
        const reduced = a[row0 - 1][col - 1] - u[row0] - v[col];
        if (reduced < minv[col]) {
          minv[col] = reduced;
          way[col] = col0;
        }
        if (minv[col] < delta) {
          delta = minv[col];
          col1 = col;
        }
      }
      for (let col = 0; col <= n; col += 1) {
        if (used[col]) {
          u[matchOfCol[col]] += delta;
          v[col] -= delta;
        } else {
          minv[col] -= delta;
        }
      }
      col0 = col1;
    } while (matchOfCol[col0] !== 0);
    do {
      const col1 = way[col0];
      matchOfCol[col0] = matchOfCol[col1];
      col0 = col1;
    } while (col0 !== 0);
  }
  const rowToCol = new Array<number>(n).fill(-1);
  for (let col = 1; col <= n; col += 1) rowToCol[matchOfCol[col] - 1] = col - 1;
  return rowToCol;
}

export function hungarian(cost: readonly (readonly number[])[]): HungarianResult {
  validate(cost);
  const rows = cost.length;
  const cols = rows === 0 ? 0 : cost[0].length;
  if (rows === 0 || cols === 0) return { rowToCol: new Array<number>(rows).fill(-1), total: 0 };

  const size = Math.max(rows, cols);
  const penalty = penaltyFor(cost, Math.min(rows, cols));
  const square = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      if (r >= rows || c >= cols) return 0;
      return Number.isFinite(cost[r][c]) ? cost[r][c] : penalty;
    }),
  );
  const solved = solveSquare(square, size);

  let total = 0;
  const rowToCol = Array.from({ length: rows }, (_, r) => {
    const c = solved[r];
    if (c >= cols || !Number.isFinite(cost[r][c])) return -1;
    total += cost[r][c];
    return c;
  });
  return { rowToCol, total };
}
