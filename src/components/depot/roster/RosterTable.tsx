'use client';

import { useMemo } from 'react';
import { BusStateMark } from '@/components/depot/shell/BusStateMark';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { busLocationText } from '@/lib/depot/infer/locationText';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import {
  flagsShortText,
  lastHeardCell,
  locationShortText,
  scheduleCell,
} from '@/lib/depot/roster/rosterCells';
import {
  rosterColumnKeys,
  rosterColumnWidth,
  rosterShortLocation,
  type RosterColumnKey,
  type RosterTier,
} from '@/lib/depot/roster/rosterColumns';
import { BUS_STATE_ORDER, type RosterRow } from '@/lib/depot/roster/rosterModel';

export interface RosterTableProps {
  readonly rows: readonly RosterRow[];
  readonly feedNow: string | null;
  readonly selectedRegistration: string | null;
  readonly onOpen: (registration: string, opener: HTMLElement) => void;
  /** The width tier: which columns show, at what widths (`rosterColumns`). */
  readonly tier: RosterTier;
}

const DASH = '—';

/**
 * Page-level scroll with a sticky header from 640px up, where each tier's column set fits
 * its frame (`rosterColumns` pins the sums): the frame is clipped (not a scroller), so the
 * header sticks under the shell's bars; the table takes its column widths as given. On a
 * phone the frame keeps its own sideways scroll for the narrowest handsets.
 */
const FLOW_CLASS =
  'depot-table-flow min-[640px]:[&_.depot-table-frame]:overflow-clip ' +
  'min-[640px]:[&_.depot-table]:table-fixed ' +
  'min-[640px]:[&_.depot-table_th]:top-[var(--depot-sticky-top)]';

type RosterColumns = Readonly<Record<RosterColumnKey, Column<RosterRow>>>;

function buildColumnSet(
  feedNow: string | null,
  selected: string | null,
  onOpen: RosterTableProps['onOpen'],
  shortLocation: boolean,
): RosterColumns {
  return {
    registration: {
      key: 'registration',
      header: 'Registration',
      sortValue: (row) => row.bus.registrationNumber,
      title: (row) => row.bus.registrationNumber,
      render: (row) => (
        <button
          type="button"
          aria-pressed={row.bus.registrationNumber === selected}
          className="whitespace-nowrap text-left text-holo-glow underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.bus.registrationNumber, event.currentTarget);
          }}
        >
          {row.bus.registrationNumber}
        </button>
      ),
    },
    state: {
      key: 'state',
      header: 'State',
      sortValue: (row) => BUS_STATE_ORDER.indexOf(row.bus.state),
      title: (row) => BUS_STATE_LABEL[row.bus.state],
      // The square and its word at every width (a square alone is colour alone); how long
      // the bus has been quiet is LAST HEARD's to say.
      render: (row) => <BusStateMark state={row.bus.state} short />,
    },
    location: {
      key: 'location',
      header: 'Location',
      sortValue: (row) => row.bus.location,
      title: (row) => busLocationText(row.bus),
      // The long wording is the one the drawer uses too, so the two can never disagree.
      render: (row) => (shortLocation ? locationShortText(row.bus) : busLocationText(row.bus)),
    },
    route: {
      key: 'route',
      header: 'Route',
      sortValue: (row) => row.bus.routeName,
      title: (row) => row.bus.routeName ?? 'No route in the feed',
      render: (row) => row.bus.routeName ?? DASH,
    },
    start: {
      key: 'start',
      header: 'Scheduled start',
      sortValue: (row) => row.bus.scheduledStart,
      title: (row) => scheduleCell(row.bus.scheduledStart, feedNow).title,
      render: (row) => {
        const cell = scheduleCell(row.bus.scheduledStart, feedNow);
        return cell.earlierDay ? (
          <span data-testid="roster-earlier-day" className="text-depot-faint">
            {cell.text}
          </span>
        ) : (
          cell.text
        );
      },
    },
    heard: {
      key: 'heard',
      header: 'Last heard',
      sortValue: (row) => row.bus.gpsAgeMin,
      title: (row) => lastHeardCell(row.bus).text,
      render: (row) =>
        row.notHeard ? (
          <span data-testid="roster-not-heard" className="text-alert-amber">
            {row.lastHeard}
          </span>
        ) : (
          row.lastHeard
        ),
    },
    flags: {
      key: 'flags',
      header: 'Flags',
      sortValue: (row) => row.flags.length,
      title: (row) => (row.flags.length === 0 ? 'No device flag raised' : row.flags.join('; ')),
      render: (row) => flagsShortText(row.bus),
    },
  };
}

/**
 * The depot's buses: 36px rows that never wrap, the registration frozen, a cue
 * while columns are hidden to the right. The registration is the real control.
 */
export function RosterTable({
  rows,
  feedNow,
  selectedRegistration,
  onOpen,
  tier,
}: RosterTableProps) {
  const columns = useMemo(() => {
    const set = buildColumnSet(feedNow, selectedRegistration, onOpen, rosterShortLocation(tier));
    return rosterColumnKeys(tier).map((key) => ({
      ...set[key],
      width: rosterColumnWidth(key, tier),
    }));
  }, [feedNow, selectedRegistration, onOpen, tier]);
  return (
    <div className={FLOW_CLASS}>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.bus.registrationNumber}
        caption="Buses homed at this depot"
        fixedRows
        freezeFirstColumn
        overflowCue
      />
    </div>
  );
}
