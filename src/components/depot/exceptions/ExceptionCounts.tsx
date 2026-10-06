import { formatCount } from '@/lib/depot/format';
import { EXCEPTION_KIND_LABEL } from '@/lib/depot/exceptions/describe';
import type { ExceptionKind } from '@/lib/depot/exceptions/types';

const DEPOT_KINDS: readonly ExceptionKind[] = [
  'dark_share_high',
  'off_road_high',
  'on_road_low',
  'power_cut_cluster',
];
const BUS_KINDS: readonly ExceptionKind[] = ['long_dark', 'power_cut', 'tamper_code', 'emergency'];

interface TileProps {
  readonly counts: Readonly<Record<ExceptionKind, number>>;
  readonly selected: ExceptionKind | null;
  readonly onToggle: (kind: ExceptionKind) => void;
}

function TileGroup({ heading, kinds, counts, selected, onToggle }: TileProps & {
  readonly heading: string;
  readonly kinds: readonly ExceptionKind[];
}) {
  return (
    <div className="min-w-0">
      <h3 className="depot-label mb-2">{heading}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={selected === kind}
            onClick={() => onToggle(kind)}
            className="min-w-0 rounded-[3px] border border-depot-line px-2 py-1.5 text-left hover:bg-depot-raised aria-pressed:border-holo-glow aria-pressed:bg-depot-raised"
          >
            <span className="block font-sans text-xs text-depot-muted">{EXCEPTION_KIND_LABEL[kind]}</span>
            <span className="block font-mono text-lg tabular-nums text-depot-ink">
              {formatCount(counts[kind] ?? 0)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Totals by kind, each a toggle that filters its own list below: a depot kind
 * filters the depot exceptions, a bus kind the bus exceptions. Pressing the
 * active tile again clears the filter.
 */
export function ExceptionCounts({
  counts,
  selected,
  onToggle,
  totalsLine,
}: TileProps & { readonly totalsLine: string }) {
  return (
    <section
      aria-labelledby="exception-counts-title"
      data-testid="depot-exception-counts"
      className="depot-panel mb-6 p-4"
    >
      <h2 id="exception-counts-title" className="depot-label">
        Exceptions by kind
      </h2>
      <p className="depot-prose mb-3 mt-1">{totalsLine}</p>
      <div className="grid gap-5 xl:grid-cols-2">
        <TileGroup heading="Depots" kinds={DEPOT_KINDS} counts={counts} selected={selected} onToggle={onToggle} />
        <TileGroup heading="Buses" kinds={BUS_KINDS} counts={counts} selected={selected} onToggle={onToggle} />
      </div>
    </section>
  );
}
