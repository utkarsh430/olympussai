'use client';

import Link from 'next/link';
import { BusStateMark } from '@/components/depot/shell/BusStateMark';
import { ShowMore } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { DepotBusView } from '@/lib/depot/api';
import { formatCount } from '@/lib/depot/format';
import { formatHeardAgo, type YardModel } from '@/lib/depot/yard/yardModel';
import { YardVisitors } from './YardVisitors';
import { NEEDS_ACTION_RULE, rollSummary } from '@/lib/depot/yard/yardPageModel';

export interface YardRollProps {
  readonly model: YardModel;
  /** Depot names by id, to say which yard an at-another-depot bus stands in. */
  readonly depotNames: ReadonlyMap<string, string>;
  readonly depotId: string;
  /** Registrations the parking order left out of every lane. */
  readonly outOfLane: ReadonlySet<string>;
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

function BusLine({
  depotId,
  bus,
  detail,
}: {
  readonly depotId: string;
  readonly bus: DepotBusView;
  readonly detail: string;
}) {
  return (
    <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-3 py-1">
      <BusLink depotId={depotId} registration={bus.registrationNumber} />
      <BusStateMark state={bus.state} short />
      <span className="min-w-0 truncate text-[11px] text-depot-muted">{detail}</span>
    </div>
  );
}

/** Where an away bus is: a distance, or the other depot's yard it stands in. */
function awayDetail(bus: DepotBusView, depotNames: ReadonlyMap<string, string>): string {
  const km = bus.distanceFromYardKm;
  const otherName = bus.otherDepotId === null ? undefined : depotNames.get(bus.otherDepotId);
  const where =
    bus.location === 'at_other_yard'
      ? `at ${otherName ? `${otherName}'s` : "another depot's"} yard`
      : km === null || !Number.isFinite(km)
        ? 'distance unknown'
        : `${km.toFixed(1)} km away`;
  return `${where} · ${formatHeardAgo(bus.gpsAgeMin)}`;
}

/** Counts by state, the buses that need action, and every bus behind "Show all N". */
function Roll({ model, depotId, outOfLane }: Omit<YardRollProps, 'depotNames'>) {
  const roll = rollSummary(model, outOfLane);
  const title = model.established ? 'In the yard now' : 'Buses by state';
  if (roll.all.length === 0) {
    return (
      <section aria-labelledby="yard-roll-in">
        <SectionLabel id="yard-roll-in" label={title} count={0} />
        <StatePanel
          kind="empty"
          sentence={
            model.established
              ? "None of this depot's buses is standing inside the yard."
              : 'This depot has no buses in the latest feed.'
          }
        />
      </section>
    );
  }
  return (
    <section aria-labelledby="yard-roll-in" data-testid="yard-roll">
      <SectionLabel id="yard-roll-in" label={title} count={roll.all.length} />
      <ul className="flex flex-wrap gap-x-6 gap-y-1" data-testid="yard-roll-counts">
        {roll.counts.map((c) => (
          <li key={c.state} className="flex items-center gap-2 text-[13px]">
            <BusStateMark state={c.state} />
            <span className="font-mono tabular-nums text-depot-ink">{formatCount(c.count)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-depot-muted">{NEEDS_ACTION_RULE}</p>
      {roll.needsAction.length === 0 ? (
        <p className="mt-1 text-[13px] text-depot-ink" data-testid="yard-roll-none">
          No bus in the yard needs action.
        </p>
      ) : (
        <ul className="mt-1" data-testid="yard-roll-action">
          {roll.needsAction.map((a) => (
            <li
              key={a.bus.registrationNumber}
              className="border-b border-depot-line last:border-b-0"
            >
              <BusLine depotId={depotId} bus={a.bus} detail={a.reasons.join(' · ')} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        <ShowMore
          items={roll.all}
          limit={0}
          label={`Every bus, ${title.toLowerCase()}`}
          itemKey={(b) => b.registrationNumber}
          renderItem={(b) => (
            <BusLine depotId={depotId} bus={b} detail={formatHeardAgo(b.gpsAgeMin)} />
          )}
        />
      </div>
    </section>
  );
}

/**
 * Text twin of the map, collapsed: counts by state with only the buses that need
 * action listed, visitors as one capped table, the nearest away buses, and buses
 * with no known location. With no yard, buses are counted by state alone.
 */
export function YardRoll({ model, depotId, depotNames, outOfLane }: YardRollProps) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Roll model={model} depotId={depotId} outOfLane={outOfLane} />
      {model.established ? <YardVisitors model={model} /> : null}
      {model.established && model.away.total > 0 ? (
        <section aria-labelledby="yard-roll-away">
          <SectionLabel
            id="yard-roll-away"
            label="Away from the yard"
            count={model.away.total}
            note={`Nearest ${formatCount(model.away.buses.length)} listed, nearest first`}
          />
          <ShowMore
            items={model.away.buses}
            label="Nearest buses away from the yard"
            itemKey={(b) => b.registrationNumber}
            renderItem={(b) => (
              <BusLine depotId={depotId} bus={b} detail={awayDetail(b, depotNames)} />
            )}
          />
        </section>
      ) : null}
      {model.unknown.length > 0 ? (
        <section aria-labelledby="yard-roll-unknown">
          <SectionLabel
            id="yard-roll-unknown"
            label="Location unknown"
            count={model.unknown.length}
          />
          <ShowMore
            items={model.unknown}
            label="Buses with no known location"
            itemKey={(b) => b.registrationNumber}
            renderItem={(b) => (
              <BusLine depotId={depotId} bus={b} detail={formatHeardAgo(b.gpsAgeMin)} />
            )}
          />
        </section>
      ) : null}
    </div>
  );
}
