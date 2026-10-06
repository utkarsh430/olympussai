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

function CountGroup({
  heading,
  kinds,
  counts,
}: {
  readonly heading: string;
  readonly kinds: readonly ExceptionKind[];
  readonly counts: Readonly<Record<ExceptionKind, number>>;
}) {
  return (
    <div>
      <h3 className="depot-label mb-2">{heading}</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {kinds.map((kind) => (
          <div key={kind}>
            <dt className="font-sans text-xs text-depot-muted">{EXCEPTION_KIND_LABEL[kind]}</dt>
            <dd className="font-mono text-lg tabular-nums text-depot-ink">
              {formatCount(counts[kind] ?? 0)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Totals by kind. Bus counts are before the list cap, so they match the real totals. */
export function ExceptionCounts({
  counts,
}: {
  readonly counts: Readonly<Record<ExceptionKind, number>>;
}) {
  return (
    <section
      aria-label="Exceptions by kind"
      data-testid="depot-exception-counts"
      className="depot-panel mb-6 grid gap-5 p-4 md:grid-cols-2"
    >
      <CountGroup heading="Depots" kinds={DEPOT_KINDS} counts={counts} />
      <CountGroup heading="Buses" kinds={BUS_KINDS} counts={counts} />
    </section>
  );
}
