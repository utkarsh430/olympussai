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

/**
 * Every operating depot on one line (the 36px row never wraps): names only, since the
 * buses column carries the count; each depot's buses and the shared-route note are in
 * the `title`, and the majority depot is marked in words.
 */
export function OperatorsCell({ view }: { readonly view: OperatorsView }) {
  const full = [
    ...view.operators.map(
      (o) =>
        `${o.depotName}: ${o.buses} ${o.buses === 1 ? 'bus' : 'buses'}${o.majority ? ', majority' : ''}`,
    ),
    ...(view.note ? [view.note] : []),
  ].join('; ');
  return (
    <span className="block min-w-0 truncate" title={full}>
      {view.operators.map((o, i) => (
        <span key={o.depotId}>
          {i > 0 ? ', ' : null}
          <DepotLink depotId={o.depotId} name={o.depotName} linked={o.linked} />
          {o.majority ? <span className="text-[11px] text-depot-muted"> majority</span> : null}
        </span>
      ))}
    </span>
  );
}

/** A figure whose qualifier (or, for a dash, its reason) is in the `title`, not a second line. */
export function FigureWithNote({
  value,
  note,
}: {
  readonly value: string;
  readonly note: string | null;
}) {
  return <span title={note ?? undefined}>{value}</span>;
}
