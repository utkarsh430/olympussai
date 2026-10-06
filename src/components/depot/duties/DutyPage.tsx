'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { useDepotDuties } from '@/hooks/useDepotDuties';
import type { DutyBoardResponse } from '@/lib/depot/duties/api';
import {
  COST_SENTENCE,
  MODEL_NOTICE,
  buildBoardRows,
  crossReferenceSentence,
  emptyDutiesSentence,
  routesWithoutDutySentence,
  spareSentence,
} from '@/lib/depot/duties/dutyBoardModel';
import {
  duplicateRowsSentence,
  dutyFigures,
  locationIgnoredSentence,
  unmatchedLine,
} from '@/lib/depot/duties/dutyPageModel';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { DutyBoard } from './DutyBoard';

const LOADING_BOARD_HEIGHT_PX = 480;

/** Footprint of the board: the figure band, then the chart pane. */
function DutiesLoading() {
  return (
    <div data-testid="duties-loading" className="space-y-4">
      <LoadingBlock rows={1} rowHeight={72} label="Loading the duty figures" />
      <LoadingBlock rows={1} rowHeight={LOADING_BOARD_HEIGHT_PX} label="Loading the timeline" />
    </div>
  );
}

function UnknownDepot({ depotId }: { readonly depotId: string }) {
  return (
    <StatePanel
      kind="no-data"
      testId="duties-unknown"
      sentence={`No depot has the id ${depotId} in the current feed.`}
      action={
        <Link href={DEPOTS_ROOT} className="depot-link">
          Back to the network overview
        </Link>
      }
    />
  );
}

/** Definitions, the matching rule and limits, said once, closed by default. */
function HowProduced({
  data,
  spare,
}: {
  readonly data: DutyBoardResponse;
  readonly spare: string;
}) {
  const withoutDuty = routesWithoutDutySentence(data.routesWithoutDuty);
  const duplicates = duplicateRowsSentence(data.duplicateRowsDropped);
  return (
    <details className="border-t border-depot-line pt-3" data-testid="duties-how">
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.16em] text-depot-muted">
        How these figures are produced
      </summary>
      <div className="depot-prose mt-2 max-w-[62ch] space-y-2 text-[13px]">
        <p data-testid="duties-notice">{MODEL_NOTICE}</p>
        <p data-testid="duties-cost">{COST_SENTENCE}</p>
        <p data-testid="duties-spare">{spare}</p>
        {withoutDuty === null ? null : <p data-testid="duties-routes-without">{withoutDuty}</p>}
        {duplicates === null ? null : <p>{duplicates}</p>}
      </div>
    </details>
  );
}

/**
 * The day's modelled duties for one depot with the buses the matching proposes for
 * them. Duties are MODELLED; buses and their states are live. Nothing here assigns or
 * dispatches anything (the header sentence says so).
 */
export function DutyPage({ depotId }: { readonly depotId: string }) {
  const { data, error, loading, refresh } = useDepotDuties(depotId);
  const ignored = data?.eligibilityIgnoredLocation === true;
  const rows = useMemo(() => (data ? buildBoardRows(data.duties, ignored) : []), [data, ignored]);

  if (!data) {
    if (error === DEPOT_NOT_FOUND_MESSAGE) return <UnknownDepot depotId={depotId} />;
    if (loading || !error) return <DutiesLoading />;
    return (
      <ErrorPanel
        title="Could not load duties"
        message={error || DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }

  const routes = new Set(data.duties.map((duty) => duty.routeName)).size;
  const modelledDay = crossReferenceSentence({
    scheduled: null,
    duties: data.duties.length,
    routes,
  });
  const spare = spareSentence(data.spareBuses, {
    assigned: data.counts.assigned,
    locationIgnored: ignored,
  });
  const located = locationIgnoredSentence(data.eligibilityIgnoredLocation);
  return (
    <div data-testid="duties-page" className="flex min-w-0 flex-col gap-6">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      {rows.length === 0 ? (
        // One "no duties" sentence: the shared one, with the cause as the remedy line.
        <StatePanel
          kind="empty"
          testId="depot-empty"
          sentence={modelledDay}
          remedy={emptyDutiesSentence(data)}
          minHeight={200}
        />
      ) : (
        <>
          <div>
            <FigureBand label="Duty figures">
              {dutyFigures(data).map((f) => (
                <Figure key={f.label} label={f.label} value={f.value} caption={f.caption} />
              ))}
            </FigureBand>
            <p className="mt-2 text-[11px] text-depot-muted" data-testid="duties-modelled-day">
              {modelledDay}
              {located === null ? '' : ` ${located}`}
            </p>
          </div>
          <DutyBoard
            depotId={depotId}
            rows={rows}
            feedNow={data.feedNow}
            unmatched={unmatchedLine(data)}
          />
        </>
      )}
      <HowProduced data={data} spare={spare} />
    </div>
  );
}
