import Link from 'next/link';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { barLabel, barTextPlacement, type BoardRow } from '@/lib/depot/duties/dutyBoardModel';

const PERCENT = 100;

/**
 * The state is the bar's style and the legend says it in words. Matched bars are the
 * figure (solid cyan); a bus on the road now adds a thick left edge, so how it stands
 * is a second, quieter encoding by shape, not colour. Unmatched bars are neutral: a
 * muted dashed outline with a 2px alert tick on the left, and no word inside.
 */
const MATCHED = 'border border-solid border-holo-glow bg-holo-glow/30';
const ON_ROAD_EDGE = 'border-l-4';
const UNMATCHED = 'border border-dashed border-depot-muted/60 bg-transparent';

function BarText({ depotId, row, label }: {
  readonly depotId: string;
  readonly row: BoardRow;
  readonly label: string;
}) {
  const { leftPct, widthPct } = row.geometry;
  const placement = barTextPlacement({ leftPct, widthPct, textLength: label.length });
  const style =
    placement === 'inside'
      ? { left: `${leftPct}%`, width: `${widthPct}%` }
      : placement === 'right'
        ? { left: `${leftPct + widthPct}%` }
        : { right: `${PERCENT - leftPct}%` };
  return (
    <span
      data-testid="duty-bar-text"
      data-placement={placement}
      className={`absolute top-1.5 z-[6] flex h-6 items-center whitespace-nowrap px-1 font-mono text-[11px] ${
        placement === 'inside' ? 'justify-center overflow-hidden' : ''
      }`}
      style={style}
    >
      {/* The text has its own ground so the now line passes behind it, never through it. */}
      <span className="rounded-[2px] bg-depot-page/90 px-1">
        <Link
          href={rosterBusHref(depotId, label)}
          className="text-holo-glow underline-offset-2 hover:underline"
        >
          {label}
        </Link>
      </span>
    </span>
  );
}

export function DutyBar({ depotId, row }: { readonly depotId: string; readonly row: BoardRow }) {
  const { leftPct, widthPct, startsBeforeAxis, endsAfterAxis } = row.geometry;
  const label = barLabel(row);
  const clip = `${startsBeforeAxis ? 'rounded-l-none border-l-0 ' : ''}${endsAfterAxis ? 'rounded-r-none border-r-0 ' : ''}`;
  const style =
    label === null
      ? UNMATCHED
      : `${MATCHED}${row.busStanding === 'on_road' && !startsBeforeAxis ? ` ${ON_ROAD_EDGE}` : ''}`;
  return (
    <>
      <div
        aria-hidden
        data-testid="duty-bar"
        data-standing={row.busStanding ?? 'none'}
        className={`absolute top-1.5 h-6 rounded-[3px] ${clip}${style}`}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      >
        {label === null ? (
          <span className="absolute inset-y-0 left-0 w-[2px] bg-alert-crimson" />
        ) : null}
      </div>
      {label === null ? null : <BarText depotId={depotId} row={row} label={label} />}
    </>
  );
}
