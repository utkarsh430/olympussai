import { describeMix, statusSegments } from '@/components/depot/network/StatusMixBar';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { StatusBoard as StatusBoardModel } from '@/lib/depot/cockpit/cockpitModel';
import { formatCount, formatShare } from '@/lib/depot/format';
import type { StatusMix } from '@/lib/depot/types';

export interface StatusBoardProps {
  readonly board: StatusBoardModel;
  /** Upstream `vehicle_status` counts, shown as the feed reports them. */
  readonly status: StatusMix;
}

function StandingSplit({ board }: { readonly board: StatusBoardModel }) {
  const { yard, locations } = board;
  return (
    <div className="mt-4" data-testid="depot-standing-split">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="depot-section-label !mb-0">
          Where the {formatCount(board.standing)} standing buses are
        </h3>
        {yard.established ? <ProvenanceBadge provenance="derived" coverage={yard.sample} /> : null}
      </div>
      {locations === null ? (
        <p className="depot-prose mt-2 max-w-3xl" data-testid="depot-no-yard">
          {yard.sentence}
        </p>
      ) : (
        <>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
            {locations.map((cell) => (
              <div key={cell.location} className="flex items-baseline gap-2">
                <dt className="text-[13px] text-depot-muted">{cell.label}</dt>
                <dd className="text-[15px] tabular-nums text-depot-ink">
                  {formatCount(cell.count)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 font-sans text-xs text-depot-faint">
            {yard.sentence} The yard is inferred from where buses park, not surveyed.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The page's one hero: every bus of the depot in exactly one of five operational
 * states, as counts with their share of the fleet, then where the standing buses
 * are. Plain numerals, no chart: each state is a word beside its figure, so
 * nothing rests on colour. The feed's own status counts follow as a LIVE line.
 */
export function StatusBoard({ board, status }: StatusBoardProps) {
  return (
    <section
      aria-labelledby="depot-status-board-heading"
      data-testid="depot-status-board"
      className="animate-rise"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-status-board-heading" className="depot-section-label !mb-0">
          Status board
        </h2>
        <ProvenanceBadge provenance="derived" />
        <p className="font-sans text-xs text-depot-muted">
          Inferred from each bus&apos;s last report; the five states add up to the fleet of{' '}
          {formatCount(board.fleet)}.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-depot-line bg-depot-line sm:grid-cols-3 xl:grid-cols-5">
        {board.states.map((cell) => (
          <div
            key={cell.state}
            className="depot-kpi-cell"
            data-testid={`depot-state-${cell.state}`}
          >
            <dt className="depot-label break-words">{cell.label}</dt>
            <dd className="depot-hero-numeral mt-2">{formatCount(cell.count)}</dd>
            <dd className="mt-2 text-[11px] text-depot-muted">
              {formatShare(cell.count, board.fleet)} of fleet
            </dd>
          </div>
        ))}
      </dl>
      <StandingSplit board={board} />
      <div
        className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-depot-line pt-3"
        data-testid="depot-feed-status-line"
      >
        <span className="depot-label">Feed status</span>
        <ProvenanceBadge provenance="live" />
        <span className="min-w-0 text-[13px] tabular-nums text-depot-muted">
          {describeMix(statusSegments(status))}
        </span>
      </div>
    </section>
  );
}
