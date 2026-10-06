import type { MapGeometry, MapNode } from '@/lib/depot/rebalance/mapGeometry';
import { busesWord } from '@/lib/depot/rebalance/rebalanceModel';
import { describeBalance } from './BalanceBar';

/** The card naming what the pointer is over; every figure on it is modelled. */
export function MapHoverCard({
  hover,
  geometry,
}: {
  readonly hover: string;
  readonly geometry: MapGeometry;
}) {
  const names = new Map<string, MapNode>(geometry.nodes.map((n) => [n.depotId, n]));
  const [kind, id] = [hover.slice(0, hover.indexOf(':')), hover.slice(hover.indexOf(':') + 1)];
  const node = kind === 'node' ? names.get(id) : undefined;
  const arc = kind === 'arc' ? geometry.arcs.find((a) => a.transferId === id) : undefined;
  const title = node
    ? node.depotName
    : arc
      ? `${names.get(arc.fromDepotId)?.depotName ?? arc.fromDepotId} → ${names.get(arc.toDepotId)?.depotName ?? arc.toDepotId}`
      : null;
  if (!title) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-3 top-3 z-20 rounded-[3px] border border-depot-line bg-depot-surface px-3 py-2"
    >
      <div className="text-[13px] text-depot-ink">{title}</div>
      <p className="depot-note mt-0.5">
        {node
          ? `${describeBalance(node.balance)} · modelled`
          : `${busesWord(arc?.buses ?? 0)} recommended · modelled`}
      </p>
    </div>
  );
}
