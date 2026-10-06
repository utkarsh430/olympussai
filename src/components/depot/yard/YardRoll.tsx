import Link from 'next/link';
import { EmptyState } from '@/components/depot/shell/DataStates';
import type { DepotBusView } from '@/lib/depot/api';
import { formatCount } from '@/lib/depot/format';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import {
  BUS_STATE_COLOUR,
  formatHeardAgo,
  type StateGroup,
  type YardModel,
} from '@/lib/depot/yard/yardModel';

export interface YardRollProps {
  readonly model: YardModel;
  /** Depot names by id, to say which yard an at-another-depot bus stands in. */
  readonly depotNames: ReadonlyMap<string, string>;
  readonly depotId: string;
}

function rosterHref(depotId: string, registration: string): string {
  return `/project/depots/d/${encodeURIComponent(depotId)}/roster?bus=${encodeURIComponent(registration)}`;
}

function BusLink({
  depotId,
  registration,
}: {
  readonly depotId: string;
  readonly registration: string;
}) {
  return (
    <Link href={rosterHref(depotId, registration)} className="depot-link font-mono text-[13px]">
      {registration}
    </Link>
  );
}

function Heading({ title, count, id }: { title: string; count: number; id: string }) {
  return (
    <h2 id={id} className="depot-section-label">
      {title} <span className="tabular-nums">({formatCount(count)})</span>
    </h2>
  );
}

function StateRows({
  groups,
  depotId,
  trailing,
}: {
  readonly groups: readonly StateGroup<DepotBusView>[];
  readonly depotId: string;
  readonly trailing: (bus: DepotBusView) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.state} data-testid={`yard-roll-state-${group.state}`}>
          <p className="mb-1 flex items-center gap-2 text-[11px] text-depot-muted">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: BUS_STATE_COLOUR[group.state] }}
            />
            {BUS_STATE_LABEL[group.state]}{' '}
            <span className="tabular-nums">({formatCount(group.buses.length)})</span>
          </p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 2xl:grid-cols-3">
            {group.buses.map((bus) => (
              <li
                key={bus.registrationNumber}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2"
              >
                <BusLink depotId={depotId} registration={bus.registrationNumber} />
                <span className="min-w-0 text-[11px] text-depot-faint">{trailing(bus)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Where an away bus is: a distance, or the other depot's yard it stands in. */
function awayDetail(bus: DepotBusView, depotNames: ReadonlyMap<string, string>): string {
  const km = bus.distanceFromYardKm;
  const otherName = bus.otherDepotId === null ? undefined : depotNames.get(bus.otherDepotId);
  const where =
    bus.location === 'at_other_yard'
      ? otherName
        ? `at ${otherName}'s yard`
        : "at another depot's yard"
      : km === null || !Number.isFinite(km)
        ? 'distance unknown'
        : `${km.toFixed(1)} km away`;
  return `${BUS_STATE_LABEL[bus.state]} · ${where} · ${formatHeardAgo(bus.gpsAgeMin)}`;
}

function heardOnly(bus: DepotBusView): string {
  return formatHeardAgo(bus.gpsAgeMin);
}

/**
 * Text twin of the map: every bus the map shows, and the ones it cannot, as links to the
 * roster. With no yard, buses are grouped by state alone.
 */
export function YardRoll({ model, depotId, depotNames }: YardRollProps) {
  if (!model.established) {
    return (
      <section aria-labelledby="yard-roll-all" className="flex flex-col gap-3">
        <Heading
          id="yard-roll-all"
          title="Buses by state"
          count={model.allGroups.reduce((sum, g) => sum + g.buses.length, 0)}
        />
        {model.allGroups.length === 0 ? (
          <EmptyState>This depot has no buses in the latest feed.</EmptyState>
        ) : (
          <div className="depot-panel p-4">
            <StateRows groups={model.allGroups} depotId={depotId} trailing={heardOnly} />
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="yard-roll">
      <section aria-labelledby="yard-roll-in">
        <Heading id="yard-roll-in" title="In the yard now" count={model.counts.inYard} />
        {model.inYardGroups.length === 0 ? (
          <EmptyState>None of this depot&apos;s buses is standing inside the yard.</EmptyState>
        ) : (
          <div className="depot-panel p-4">
            <StateRows groups={model.inYardGroups} depotId={depotId} trailing={heardOnly} />
          </div>
        )}
      </section>

      <section aria-labelledby="yard-roll-visitors">
        <Heading id="yard-roll-visitors" title="Visitors" count={model.counts.visitors} />
        {model.visitorGroups.length === 0 ? (
          <EmptyState>No bus from another depot is standing in this yard.</EmptyState>
        ) : (
          <div className="depot-panel flex flex-col gap-3 p-4">
            {model.visitorGroups.map((group) => (
              <div key={group.homeDepotName}>
                <p className="mb-1 text-[11px] text-depot-muted">
                  Home: {group.homeDepotName}{' '}
                  <span className="tabular-nums">({formatCount(group.buses.length)})</span>
                </p>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 2xl:grid-cols-3">
                  {group.buses.map((bus) => (
                    <li
                      key={bus.registrationNumber}
                      className="flex min-w-0 flex-wrap items-baseline gap-x-2"
                    >
                      <span className="font-mono text-[13px] text-depot-ink">
                        {bus.registrationNumber}
                      </span>
                      <span className="min-w-0 text-[11px] text-depot-faint">
                        {BUS_STATE_LABEL[bus.state]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="yard-roll-away">
        <Heading id="yard-roll-away" title="Away from the yard" count={model.away.total} />
        {model.away.total === 0 ? (
          <EmptyState>All of this depot&apos;s positioned buses are inside the yard.</EmptyState>
        ) : (
          <div className="depot-panel p-4">
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 xl:grid-cols-2">
              {model.away.buses.map((bus) => (
                <li
                  key={bus.registrationNumber}
                  className="flex min-w-0 flex-wrap items-baseline gap-x-2"
                >
                  <BusLink depotId={depotId} registration={bus.registrationNumber} />
                  <span className="min-w-0 text-[11px] text-depot-faint">
                    {awayDetail(bus, depotNames)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-depot-muted">
              Showing the nearest {formatCount(model.away.buses.length)} of{' '}
              {formatCount(model.away.total)}, nearest first.
            </p>
          </div>
        )}
      </section>

      {model.unknown.length > 0 ? (
        <section aria-labelledby="yard-roll-unknown">
          <Heading id="yard-roll-unknown" title="Location unknown" count={model.unknown.length} />
          <div className="depot-panel p-4">
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 2xl:grid-cols-3">
              {model.unknown.map((bus) => (
                <li
                  key={bus.registrationNumber}
                  className="flex min-w-0 flex-wrap items-baseline gap-x-2"
                >
                  <BusLink depotId={depotId} registration={bus.registrationNumber} />
                  <span className="min-w-0 text-[11px] text-depot-faint">
                    {BUS_STATE_LABEL[bus.state]} · {formatHeardAgo(bus.gpsAgeMin)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
