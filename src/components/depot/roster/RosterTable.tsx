'use client';

import { useMemo } from 'react';
import { BUS_STATE_SQUARE, BusStateMark } from '@/components/depot/shell/BusStateMark';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { busLocationText } from '@/lib/depot/infer/locationText';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import { lastHeardCell, locationShortText, scheduleCell } from '@/lib/depot/roster/rosterCells';
import {
  rosterColumnKeys,
  rosterColumnWidth,
  type RosterColumnKey,
} from '@/lib/depot/roster/rosterColumns';
import { BUS_STATE_ORDER, ROSTER_STATE_WORD, type RosterRow } from '@/lib/depot/roster/rosterModel';

export interface RosterTableProps {
  readonly rows: readonly RosterRow[];
  readonly feedNow: string | null;
  readonly selectedRegistration: string | null;
  readonly onOpen: (registration: string, opener: HTMLElement) => void;
  /** Under 640px: three short columns, the state as its square alone. */
  readonly phone: boolean;
  /** False when every row has no running value (the column is then left out). */
  readonly showRunning: boolean;
}

const DASH = '—';

/**
 * Page-level scroll with a sticky header at 1440 and wider, where every column fits: the
 * frame is clipped (not a scroller), so the header sticks under the shell's bars; the
 * table takes its column widths as given. Narrower, the frame keeps its own sideways
 * scroll, and the frozen registration and the "more columns" cue stay.
 */
const FLOW_CLASS =
  'depot-table-flow min-[1440px]:[&_.depot-table-frame]:overflow-clip ' +
  'min-[1440px]:[&_.depot-table]:table-fixed ' +
  'min-[1440px]:[&_.depot-table_th]:top-[var(--depot-sticky-top)]';

type RosterColumns = Readonly<Record<RosterColumnKey, Column<RosterRow>>>;

function buildColumnSet(
  feedNow: string | null,
  selected: string | null,
  onOpen: RosterTableProps['onOpen'],
  phone: boolean,
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
      // The word only; how long the bus has been quiet is LAST HEARD's to say. At a phone
      // the square is the state and its word is in `title`, read out, and in the drawer.
      render: (row) =>
        phone ? (
          <span
            data-testid="depot-bus-state"
            data-state={row.bus.state}
            title={BUS_STATE_LABEL[row.bus.state]}
            className="inline-flex items-center"
          >
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 ${BUS_STATE_SQUARE[row.bus.state]}`} />
            <span className="sr-only">{ROSTER_STATE_WORD[row.bus.state]}</span>
          </span>
        ) : (
          <BusStateMark state={row.bus.state} short />
        ),
    },
    location: {
      key: 'location',
      header: 'Location',
      sortValue: (row) => row.bus.location,
      title: (row) => busLocationText(row.bus),
      // The long wording is the one the drawer uses too, so the two can never disagree.
      render: (row) => (phone ? locationShortText(row.bus) : busLocationText(row.bus)),
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
    running: {
      key: 'running',
      header: 'Running',
      title: (row) => row.delay ?? 'No delay figure: no schedule for the feed date',
      render: (row) => row.delay ?? DASH,
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
      render: (row) => (row.flags.length === 0 ? DASH : row.flags.join('; ')),
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
  phone,
  showRunning,
}: RosterTableProps) {
  const columns = useMemo(() => {
    const set = buildColumnSet(feedNow, selectedRegistration, onOpen, phone);
    return rosterColumnKeys({ phone, running: showRunning }).map((key) => ({
      ...set[key],
      width: rosterColumnWidth(key, phone),
    }));
  }, [feedNow, selectedRegistration, onOpen, phone, showRunning]);
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
