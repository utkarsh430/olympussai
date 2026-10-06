import Link from 'next/link';
import { depotHref } from '@/lib/depot/depotNav';
import type { OperatorsView } from '@/lib/depot/routes/routeRowWording';

/** A depot name that opens the depot's cockpit; plain text when it is not a real depot. */
export function DepotLink({
  depotId,
  name,
  linked,
}: {
  readonly depotId: string;
  readonly name: string;
  readonly linked: boolean;
}) {
  if (!linked) return <span title={name}>{name}</span>;
  return (
    <Link href={depotHref(depotId)} title={`Open ${name}`} className="depot-link">
      {name}
    </Link>
  );
}

/** Every operating depot with its buses; the majority named in words when the route is shared. */
export function OperatorsCell({ view }: { readonly view: OperatorsView }) {
  return (
    <span className="flex flex-col gap-0.5 whitespace-normal">
      {view.operators.map((o) => (
        <span key={o.depotId} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <DepotLink depotId={o.depotId} name={o.depotName} linked={o.linked} />
          <span className="text-depot-muted">
            {o.buses} {o.buses === 1 ? 'bus' : 'buses'}
          </span>
          {o.majority ? <span className="text-[11px] text-depot-muted">majority</span> : null}
        </span>
      ))}
      {view.note ? <span className="text-[11px] text-depot-muted">{view.note}</span> : null}
    </span>
  );
}

/** A figure with a short qualifier beneath it, in words. */
export function FigureWithNote({
  value,
  note,
}: {
  readonly value: string;
  readonly note: string | null;
}) {
  return (
    <span className="flex flex-col items-end">
      <span>{value}</span>
      {note ? (
        <span className="max-w-[14rem] whitespace-normal text-right text-[11px] text-depot-muted">
          {note}
        </span>
      ) : null}
    </span>
  );
}
