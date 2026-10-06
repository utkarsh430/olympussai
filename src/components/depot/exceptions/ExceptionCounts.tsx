import { FigureBand } from '@/components/depot/shell/FigureBand';
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

interface KindProps {
  readonly counts: Readonly<Record<ExceptionKind, number>>;
  readonly selected: ExceptionKind | null;
  readonly onToggle: (kind: ExceptionKind) => void;
}

/**
 * One kind as a band figure that is also its filter: the shared `Figure`'s layout (label
 * 11px, mono 24px value, hairline on the left, fixed width, left-packed) with the label and
 * value inside one toggle. The shared `Figure` takes no action, so this mirrors its classes.
 */
function KindFigure({ kind, counts, selected, onToggle }: KindProps & { readonly kind: ExceptionKind }) {
  const pressed = selected === kind;
  return (
    <li className="min-w-0 list-none border-l border-depot-line px-4 lg:w-[200px] lg:flex-none xl:w-[232px]">
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => onToggle(kind)}
        className="group block w-full min-w-0 text-left"
      >
        <span className="depot-label block truncate leading-4 group-hover:text-depot-ink" title={EXCEPTION_KIND_LABEL[kind]}>
          {EXCEPTION_KIND_LABEL[kind]}
        </span>
        <span
          className={`mt-1.5 block truncate font-mono text-2xl tabular-nums leading-7 underline-offset-4 group-hover:underline ${
            pressed ? 'text-holo-glow underline' : 'text-depot-ink'
          }`}
        >
          {formatCount(counts[kind] ?? 0)}
        </span>
      </button>
    </li>
  );
}

/**
 * The page's hero: two bands of kind figures (depots, buses), each figure a toggle that
 * filters its own list below (a depot kind the depot exceptions, a bus kind the bus list);
 * pressing the active figure again clears it. The totals sentence is the bands' caption.
 */
export function ExceptionCounts({
  counts,
  selected,
  onToggle,
  totalsLine,
}: KindProps & { readonly totalsLine: string }) {
  const figures = (kinds: readonly ExceptionKind[]) =>
    kinds.map((kind) => (
      <KindFigure key={kind} kind={kind} counts={counts} selected={selected} onToggle={onToggle} />
    ));
  return (
    <section aria-labelledby="exception-counts-title" data-testid="depot-exception-counts" className="mb-2">
      <h2 id="exception-counts-title" className="sr-only">
        Exceptions by kind
      </h2>
      <h3 className="depot-label mb-1">Depots</h3>
      <FigureBand label="Depot exceptions by kind">{figures(DEPOT_KINDS)}</FigureBand>
      <h3 className="depot-label -mt-2 mb-1">Buses</h3>
      <FigureBand label="Bus exceptions by kind">{figures(BUS_KINDS)}</FigureBand>
      <p className="depot-caption -mt-4 mb-6">{totalsLine}</p>
    </section>
  );
}
