'use client';

import { Fragment } from 'react';
import { ExpandToggle, expandedRowId, useExpandedRows } from '@/components/depot/shell/RowExpander';
import {
  AXIS_STRIP_PX,
  AXIS_TICK_TOP_PX,
  NOW_FLAG_BOTTOM_PX,
  axisTicks,
  nowLabel,
  nowLabelAnchor,
  nowLinePct,
  type BoardRow,
} from '@/lib/depot/duties/dutyBoardModel';
import { DutyBar } from './DutyBar';
import { DutyDetail } from './DutyDetail';

export interface DutyTimelineProps {
  readonly depotId: string;
  readonly rows: readonly BoardRow[];
  readonly feedNow: string | null;
}

const TIMELINE_ID = 'duty-timeline';
/**
 * The frozen duty column: 96px on a phone (route code only; the times are in its
 * `title` and the row expander), 160px from 640px. The time area scrolls sideways
 * inside the frame beneath it.
 */
const LABEL_COLUMN = 'w-[96px] shrink-0 sm:w-[160px]';
/** The grid starts after the label column and the track's 16px inset. */
const GRID_LEFT = 'left-[112px] sm:left-[176px]';
/** The track is inset 16px each side so the first and last axis labels are never clipped. */
const TRACK = 'relative mx-4 flex-1';

const FLAG_SHIFT: Readonly<Record<'start' | 'middle' | 'end', string>> = {
  start: 'translate-x-0',
  middle: '-translate-x-1/2',
  end: '-translate-x-full',
};

/** The time axis: tick labels on its top line, the now flag on its bottom line, never over a tick. */
function Axis({ feedNow }: { readonly feedNow: string | null }) {
  const now = nowLinePct(feedNow);
  const nowText = nowLabel(feedNow);
  return (
    <div className="sticky top-0 z-30 flex border-b border-depot-line bg-depot-surface">
      <div className={`${LABEL_COLUMN} depot-label sticky left-0 z-40 bg-depot-surface px-3 py-2`}>
        Duty
      </div>
      <div className={TRACK} style={{ height: AXIS_STRIP_PX }}>
        {axisTicks().map((tick) => (
          <span
            key={tick.label}
            className="absolute -translate-x-1/2 font-mono text-[11px] leading-4 text-depot-muted"
            style={{ left: `${tick.leftPct}%`, top: AXIS_TICK_TOP_PX }}
          >
            {tick.label}
          </span>
        ))}
        {now === null || nowText === null ? null : (
          // One line, never wrapped: a wrapped flag would rise into the tick labels' line.
          <span
            data-testid="duty-now-label"
            data-anchor={nowLabelAnchor(now)}
            className={`absolute bottom-1 z-10 ${FLAG_SHIFT[nowLabelAnchor(now)]} whitespace-nowrap rounded-[2px] bg-alert-amber px-1 font-mono text-[11px] leading-4 text-depot-page`}
            style={{ left: `${now}%`, bottom: NOW_FLAG_BOTTOM_PX }}
          >
            {nowText}
          </span>
        )}
      </div>
    </div>
  );
}

function Grid({ feedNow }: { readonly feedNow: string | null }) {
  const now = nowLinePct(feedNow);
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-y-0 ${GRID_LEFT} right-4`}>
      {axisTicks().map((tick) => (
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
  );
}

/**
 * The hero: one row per duty on a 04:00 to 24:00 axis, in a fixed-height pane that
 * scrolls both ways inside itself, the time axis stuck to its top and the duty column
 * frozen at its left. Each row carries its text equivalent as visually hidden text, and
 * its expander opens the duty in full beneath it.
 */
export function DutyTimeline({ depotId, rows, feedNow }: DutyTimelineProps) {
  const expanded = useExpandedRows(false);
  return (
    // relative: anything absolutely positioned inside must stay inside this frame.
    <div
      data-testid="duty-scroll-frame"
      role="region"
      aria-label="Duty timeline, scrolls inside its frame"
      tabIndex={0}
      className="relative max-h-[480px] overflow-auto rounded-md border border-depot-line bg-depot-page"
    >
      {/* Below 640 the day keeps 900 px and scrolls sideways in the frame; from 640 the
          04:00 to 24:00 axis fits the frame, so nothing is cut at any width. */}
      <div data-testid="duty-timeline-canvas" className="relative min-w-[900px] sm:min-w-0">
        <Axis feedNow={feedNow} />
        <div className="relative">
          <Grid feedNow={feedNow} />
          {rows.map((row) => {
            const open = expanded.isOpen(row.id);
            const detailId = expandedRowId(TIMELINE_ID, row.id);
            return (
              <Fragment key={row.id}>
                <div
                  data-testid="duty-row"
                  data-open={open}
                  className={`relative flex h-9 border-b border-depot-line ${open ? 'bg-depot-surface' : ''}`}
                >
                  <span className="sr-only">{row.ariaLabel}</span>
                  <div
                    className={`${LABEL_COLUMN} sticky left-0 z-20 flex min-w-0 items-center gap-1 bg-depot-page pl-1 pr-2 font-mono text-[11px] leading-4`}
                    title={`${row.routeName}, ${row.timeText}`}
                  >
                    <ExpandToggle
                      open={open}
                      controls={detailId}
                      label={`Show duty ${row.routeName} ${row.timeText} in full`}
                      onToggle={() => expanded.toggle(row.id)}
                    />
                    <span aria-hidden className="flex min-w-0 flex-col">
                      <span className="truncate text-depot-ink">{row.routeName}</span>
                      {/* The times repeat the bar's extent: shown only above 1024 px; at
                          1024 and below they are in the title and the expander. */}
                      <span className="hidden truncate text-depot-muted min-[1025px]:block">
                        {row.spanText}
                      </span>
                    </span>
                  </div>
                  <div className={TRACK}>
                    <DutyBar depotId={depotId} row={row} />
                  </div>
                </div>
                {open ? (
                  <div
                    id={detailId}
                    className="relative z-20 border-b border-depot-line bg-depot-surface"
                  >
                    <div className="sticky left-0 w-fit max-w-[calc(100vw-48px)] px-3 py-2 sm:max-w-none">
                      <DutyDetail row={row} />
                    </div>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
