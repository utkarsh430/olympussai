/**
 * Generic min-cost max-flow with integer capacities and costs.
 *
 * Successive shortest augmenting paths: each round finds the cheapest
 * source-to-sink path in the residual graph and saturates its bottleneck.
 * Because every augmentation uses a shortest path, the result is a maximum
 * flow of minimum cost. Bellman-Ford (queue based) handles the negative-cost
 * reverse arcs. Pure and deterministic: ties are broken by edge order, so the
 * same input always yields the same flow.
 */

export interface FlowEdgeInput {
  readonly from: number;
  readonly to: number;
  readonly capacity: number;
  readonly cost: number;
}

export interface FlowResult {
  readonly flow: number;
  readonly cost: number;
  /** Flow on each input edge, parallel to the input array. */
  readonly edgeFlows: readonly number[];
}

interface Arc {
  readonly to: number;
  readonly cost: number;
  capacity: number;
}

function validate(
  nodeCount: number,
  edges: readonly FlowEdgeInput[],
  source: number,
  sink: number,
): void {
  const inRange = (n: number): boolean => Number.isInteger(n) && n >= 0 && n < nodeCount;
  if (!inRange(source) || !inRange(sink)) throw new Error('source and sink must be valid nodes');
  for (const e of edges) {
    if (!inRange(e.from) || !inRange(e.to)) throw new Error('edge endpoint out of range');
    if (!Number.isInteger(e.capacity) || e.capacity < 0) {
      throw new Error('edge capacity must be a non-negative integer');
    }
    if (!Number.isInteger(e.cost)) throw new Error('edge cost must be an integer');
  }
}

export function minCostMaxFlow(
  nodeCount: number,
  edges: readonly FlowEdgeInput[],
  source: number,
  sink: number,
): FlowResult {
  validate(nodeCount, edges, source, sink);

  // Arc 2i is edge i forward, arc 2i+1 its residual twin.
  const arcs: Arc[] = [];
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  edges.forEach((e, i) => {
    arcs.push({ to: e.to, cost: e.cost, capacity: e.capacity });
    arcs.push({ to: e.from, cost: -e.cost, capacity: 0 });
    adjacency[e.from]?.push(2 * i);
    adjacency[e.to]?.push(2 * i + 1);
  });

  let totalFlow = 0;
  let totalCost = 0;

  while (source !== sink) {
    const dist = new Array<number>(nodeCount).fill(Infinity);
    const viaArc = new Array<number>(nodeCount).fill(-1);
    const queued = new Array<boolean>(nodeCount).fill(false);
    dist[source] = 0;
    const queue: number[] = [source];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head] as number;
      queued[u] = false;
      for (const a of adjacency[u] ?? []) {
        const arc = arcs[a] as Arc;
        const candidate = (dist[u] as number) + arc.cost;
        if (arc.capacity > 0 && candidate < (dist[arc.to] as number)) {
          dist[arc.to] = candidate;
          viaArc[arc.to] = a;
          if (!queued[arc.to]) {
            queued[arc.to] = true;
            queue.push(arc.to);
          }
        }
      }
    }
    if (viaArc[sink] === -1) break;

    let bottleneck = Infinity;
    for (let v = sink; v !== source; ) {
      const a = viaArc[v] as number;
      bottleneck = Math.min(bottleneck, (arcs[a] as Arc).capacity);
      v = (arcs[a ^ 1] as Arc).to;
    }
    for (let v = sink; v !== source; ) {
      const a = viaArc[v] as number;
      (arcs[a] as Arc).capacity -= bottleneck;
      (arcs[a ^ 1] as Arc).capacity += bottleneck;
      v = (arcs[a ^ 1] as Arc).to;
    }
    totalFlow += bottleneck;
    totalCost += bottleneck * (dist[sink] as number);
  }

  // The twin's residual capacity is exactly the flow pushed through the edge.
  const edgeFlows = edges.map((_, i) => (arcs[2 * i + 1] as Arc).capacity);
  return { flow: totalFlow, cost: totalCost, edgeFlows };
}
