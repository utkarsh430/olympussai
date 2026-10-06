import Link from 'next/link';
import { rosterBusHref } from '@/lib/depot/depotNav';
import {
  axisTicks,
  barLabel,
  barTextPlacement,
  nowLabel,
  nowLinePct,
  type BoardRow,
} from '@/lib/depot/duties/dutyBoardModel';

export interface DutyTimelineProps {
  readonly depotId: string;
  readonly rows: readonly BoardRow[];
  readonly feedNow: string | null;
}

/** Fixed width of the duty label column; it stays put while the axis scrolls. */
const LABEL_COLUMN = 'w-[160px] shrink-0';
/** The track is inset 16px each side so the first and last axis labels are never clipped. */
const TRACK = 'relative mx-4 flex-1';
const PERCENT = 100;

/** The state is the bar's style; the legend says so in words. */
const BAR_STYLE: Readonly<Record<'matched' | 'unmatched', string>> = {
  matched: 'border border-solid border-holo-glow bg-holo-glow/30',
  unmatched: 'border border-dashed border-alert-crimson bg-transparent',
};

function DutyBar({ depotId, row }: { readonly depotId: string; readonly row: BoardRow }) {
  const { leftPct, widthPct, startsBeforeAxis, endsAfterAxis } = row.geometry;
  const label = barLabel(row);
  const placement = barTextPlacement({ leftPct, widthPct, textLength: label.length });
  const textStyle =
    placement === 'inside'
      ? { left: `${leftPct}%`, width: `${widthPct}%` }
      : placement === 'right'
        ? { left: `${leftPct + widthPct}%` }
        : { right: `${PERCENT - leftPct}%` };
  const clip = `${startsBeforeAxis ? 'rounded-l-none border-l-0 ' : ''}${endsAfterAxis ? 'rounded-r-none border-r-0 ' : ''}`;
  const matched = row.registrationNumber !== null;
  return (
    <>
      <div
        aria-hidden
        className={`absolute top-1.5 h-6 rounded-[3px] ${clip}${BAR_STYLE[matched ? 'matched' : 'unmatched']}`}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
      <span
        data-testid="duty-bar-text"
        data-placement={placement}
        className={`absolute top-1.5 z-[6] flex h-6 items-center whitespace-nowrap px-1 font-mono text-[11px] ${
          placement === 'inside' ? 'justify-center overflow-hidden' : ''
        }`}
        style={textStyle}
      >
        {/* The text has its own ground so the now line passes behind it, never through it. */}
        <span className="rounded-[2px] bg-depot-page/90 px-1">
          {matched ? (
            <Link
              href={rosterBusHref(depotId, label)}
              className="text-holo-glow underline-offset-2 hover:underline"
            >
              {label}
            </Link>
          ) : (
            <span aria-hidden className="text-depot-muted">
              {label}
            </span>
          )}
        </span>
      </span>
    </>
  );
}

/**
 * The hero: one row per duty on a 04:00 to 24:00 axis, in a fixed-height pane that
 * scrolls both ways inside itself, with the time axis stuck to its top and the duty
 * column stuck to its left, so 160 duties are ordinary. Each row carries its full
 * text equivalent and reason as visually hidden text; the table repeats the rows.
 */
export function DutyTimeline({ depotId, rows, feedNow }: DutyTimelineProps) {
  const ticks = axisTicks();
  const now = nowLinePct(feedNow);
  const nowText = nowLabel(feedNow);
  return (
    // relative: anything absolutely positioned inside must stay inside this frame.
    <div
      data-testid="duty-scroll-frame"
      role="region"
      aria-label="Duty timeline, scrolls inside its frame"
      tabIndex={0}
      className="relative max-h-[480px] overflow-auto rounded-md border border-depot-line bg-depot-page"
    >
      <div className="relative min-w-[900px]">
        <div className="sticky top-0 z-30 flex border-b border-depot-line bg-depot-surface">
          <div
            className={`${LABEL_COLUMN} depot-label sticky left-0 z-40 bg-depot-surface px-3 py-2`}
          >
            Duty
          </div>
          <div className={`${TRACK} h-8`}>
            {ticks.map((tick) => (
              <span
                key={tick.label}
                className="absolute top-2 -translate-x-1/2 font-mono text-[11px] text-depot-muted"
                style={{ left: `${tick.leftPct}%` }}
              >
                {tick.label}
              </span>
            ))}
            {now === null || nowText === null ? null : (
              <span
                data-testid="duty-now-label"
                className="absolute bottom-0 z-10 -translate-x-1/2 rounded-[2px] bg-alert-amber px-1 font-mono text-[11px] text-depot-page"
                style={{ left: `${now}%` }}
              >
                {nowText}
              </span>
            )}
          </div>
        </div>
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[176px] right-4">
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
              className="relative flex h-9 border-b border-depot-line last:border-b-0"
            >
              <span className="sr-only">
                {row.ariaLabel}
                {row.reason === null ? '' : ` ${row.reason}`}
              </span>
              <div
                aria-hidden
                className={`${LABEL_COLUMN} sticky left-0 z-20 flex min-w-0 flex-col justify-center bg-depot-page px-3 font-mono text-[11px] leading-4`}
              >
                <span className="truncate text-depot-ink">{row.routeName}</span>
                <span className="truncate text-depot-muted">{row.timeText}</span>
              </div>
              <div className={TRACK}>
                <DutyBar depotId={depotId} row={row} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
