import Link from 'next/link';
import { rosterBusHref } from '@/lib/depot/depotNav';
import {
  axisTicks,
  nowLinePct,
  nowSentence,
  type BoardRow,
} from '@/lib/depot/duties/dutyBoardModel';

export interface DutyTimelineProps {
  readonly depotId: string;
  readonly rows: readonly BoardRow[];
  readonly feedNow: string | null;
}

/** Fixed width of the duty label column; it stays put while the axis scrolls. */
const LABEL_COLUMN = 'w-[200px] shrink-0';
/** A bar at least this wide (percent of the axis) carries its own text. */
const TEXT_INSIDE_MIN_WIDTH_PCT = 16;
/** Past this point there is no room to the right of a bar for its text. */
const NO_ROOM_RIGHT_PCT = 80;
const PERCENT = 100;

/**
 * Bar styling by state. The state word is always written; the border style
 * (solid, dashed, dotted) and tint only reinforce it, so the chart reads without colour.
 */
const BAR_STYLE: Readonly<Record<BoardRow['state'], string>> = {
  assigned: 'border border-solid border-holo-glow/70 bg-holo-glow/20',
  no_bus: 'border border-dashed border-alert-amber bg-transparent',
  bus_not_in_yard: 'border border-dotted border-alert-crimson bg-transparent',
};

function BarText({ depotId, row }: { readonly depotId: string; readonly row: BoardRow }) {
  return (
    <>
      {row.stateWord}
      {row.registrationNumber === null ? null : (
        <>
          {' '}
          <Link
            href={rosterBusHref(depotId, row.registrationNumber)}
            className="text-holo-glow underline-offset-2 hover:underline"
          >
            {row.registrationNumber}
          </Link>
        </>
      )}
    </>
  );
}

function DutyBar({ depotId, row }: { readonly depotId: string; readonly row: BoardRow }) {
  const { leftPct, widthPct, startsBeforeAxis, endsAfterAxis } = row.geometry;
  const inside = widthPct >= TEXT_INSIDE_MIN_WIDTH_PCT;
  const rightEdge = leftPct + widthPct;
  const textStyle = inside
    ? { left: `${leftPct}%`, width: `${widthPct}%` }
    : rightEdge <= NO_ROOM_RIGHT_PCT
      ? { left: `${rightEdge}%` }
      : { right: `${PERCENT - leftPct}%` };
  const clip = `${startsBeforeAxis ? 'rounded-l-none border-l-0 ' : ''}${
    endsAfterAxis ? 'rounded-r-none border-r-0 ' : ''
  }`;
  return (
    <>
      <div
        aria-hidden
        title={row.ariaLabel}
        className={`absolute top-2 h-[28px] rounded-[3px] ${clip}${BAR_STYLE[row.state]}`}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
      <span
        className={`absolute top-2 flex h-[28px] items-center whitespace-nowrap font-mono text-[11px] text-depot-ink ${
          inside ? 'justify-center overflow-hidden px-1' : 'px-1.5'
        }`}
        style={textStyle}
      >
        <BarText depotId={depotId} row={row} />
      </span>
    </>
  );
}

/**
 * The hero: one row per duty, ordered by start, a bar from start to end on a
 * 04:00 to 24:00 axis. The frame scrolls sideways on its own with the duty
 * column pinned; the page never does. Each row is a text equivalent of its bar
 * (route, times, state word, registration); the table view repeats the rows.
 */
export function DutyTimeline({ depotId, rows, feedNow }: DutyTimelineProps) {
  const ticks = axisTicks();
  const now = nowLinePct(feedNow);
  return (
    <div>
      <p className="depot-prose mb-2 text-xs" data-testid="duty-now-sentence">
        {nowSentence(feedNow)}
      </p>
      {/* relative: anything absolutely positioned inside must stay inside this frame. */}
      <div
        data-testid="duty-scroll-frame"
        role="region"
        aria-label="Duty timeline, scrolls sideways"
        tabIndex={0}
        className="relative overflow-x-auto rounded-md border border-depot-line bg-depot-page"
      >
        <div className="relative min-w-[900px]">
          <div className="flex border-b border-depot-line bg-depot-surface">
            <div
              className={`${LABEL_COLUMN} depot-label sticky left-0 z-20 bg-depot-surface px-3 py-2`}
            >
              Duty (MODELLED)
            </div>
            <div className="relative h-8 flex-1">
              {ticks.map((tick) => (
                <span
                  key={tick.label}
                  className="absolute top-2 -translate-x-1/2 font-mono text-[11px] text-depot-muted"
                  style={{ left: `${tick.leftPct}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            {/* Grid and now line sit over the track area only: the label column is 200px. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-[200px] right-0"
            >
              {ticks.map((tick) => (
                <span
                  key={tick.label}
                  className="absolute inset-y-0 w-px bg-depot-line"
                  style={{ left: `${tick.leftPct}%` }}
                />
              ))}
              {now === null ? null : (
                <span
                  data-testid="duty-now-line"
                  className="absolute inset-y-0 z-[5] w-[2px] bg-alert-amber"
                  style={{ left: `${now}%` }}
                />
              )}
            </div>
            {rows.map((row) => (
              <div
                key={row.id}
                data-testid="duty-row"
                className="relative flex h-12 border-b border-depot-line last:border-b-0"
              >
                <div
                  className={`${LABEL_COLUMN} sticky left-0 z-10 flex min-w-0 flex-col justify-center bg-depot-page px-3 font-mono text-[11px] leading-4`}
                >
                  <span className="truncate text-[13px] text-depot-ink" title={row.routeName}>
                    {row.routeName}
                  </span>
                  <span className="truncate text-depot-muted">{row.timeText}</span>
                </div>
                <div className="relative flex-1">
                  <DutyBar depotId={depotId} row={row} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
