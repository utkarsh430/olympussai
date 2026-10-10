'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { HowProduced as ClosingDisclosure } from '@/components/depot/shell/HowProduced';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { useDepotDuties } from '@/hooks/useDepotDuties';
import type { DutyBoardResponse } from '@/lib/depot/duties/api';
import {
  COST_SENTENCE,
  ELIGIBILITY_SENTENCE,
  MODEL_NOTICE,
  buildBoardRows,
  emptyDutiesSentence,
  routesWithoutDutySentence,
  spareSentence,
} from '@/lib/depot/duties/dutyBoardModel';
import {
  duplicateRowsSentence,
  dutiesModelledDay,
  dutyFigures,
  emptyBoardSentence,
  matchingNotes,
} from '@/lib/depot/duties/dutyPageModel';
import { DEPOTS_ROOT, SOURCES_PATH } from '@/lib/depot/nav';
import { DutiesHeader } from './DutiesHeader';
import { DutyBoard } from './DutyBoard';

const LOADING_BOARD_HEIGHT_PX = 480;

/** Footprint of the board: the section label and band, then the chart pane. */
export function DutiesLoading() {
  return (
    <div data-testid="duties-loading" className="space-y-4">
      <LoadingBlock rows={1} rowHeight={88} label="Loading the duty figures" />
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
          Back to the headquarters overview
        </Link>
      }
    />
  );
}

/** Definitions, eligibility, the matching rule and limits, said once, closed by default. */
function HowProduced({ data }: { readonly data: DutyBoardResponse }) {
  const spare = spareSentence(data.spareBuses, {
    assigned: data.counts.assigned,
    locationIgnored: data.eligibilityIgnoredLocation === true,
    byStanding: data.counts.spareByStanding,
  });
  const withoutDuty = routesWithoutDutySentence(data.routesWithoutDuty);
  const duplicates = duplicateRowsSentence(data.duplicateRowsDropped);
  return (
    <ClosingDisclosure id="duties-how" testId="duties-how">
      <p className="depot-prose" data-testid="duties-notice">{MODEL_NOTICE}</p>
      <p className="depot-prose">{ELIGIBILITY_SENTENCE}</p>
      <p className="depot-prose" data-testid="duties-cost">{COST_SENTENCE}</p>
      <p className="depot-prose" data-testid="duties-spare">{spare}</p>
      {withoutDuty === null ? null : (
        <p className="depot-prose" data-testid="duties-routes-without">{withoutDuty}</p>
      )}
      {duplicates === null ? null : <p className="depot-prose">{duplicates}</p>}
    </ClosingDisclosure>
  );
}

/** The header extension and the body under it, for each state of the board. */
function useDutyBody(depotId: string): {
  readonly modelledDay?: string;
  readonly body: React.ReactNode;
} {
  const { data, error, loading, refresh } = useDepotDuties(depotId);
  const scheduled = useDepotDetailContext().data?.outshed.coverage ?? null;
  const rows = useMemo(() => (data ? buildBoardRows(data.duties) : []), [data]);
  if (!data) {
    if (error === DEPOT_NOT_FOUND_MESSAGE) return { body: <UnknownDepot depotId={depotId} /> };
    if (loading || !error) return { body: <DutiesLoading /> };
    const message = error || DEPOT_UNAVAILABLE_MESSAGE;
    return {
      body: (
        <ErrorPanel title="Could not load duties" message={message} onRetry={refresh}>
          <Link href={DEPOTS_ROOT} className="depot-link">
            Back to the headquarters overview
          </Link>
        </ErrorPanel>
      ),
    };
  }
  const stale = data.stale || error ? <StaleNotice since={data.feedNow} /> : null;
  if (rows.length === 0) {
    // One "no duties" sentence: the shared one, in the panel, not also in the line.
    const empty = (
      <StatePanel
        kind="empty"
        testId="depot-empty"
        sentence={emptyBoardSentence(data.operatingDate)}
        remedy={emptyDutiesSentence(data)}
        action={<Link href={SOURCES_PATH} className="depot-link">Data sources</Link>}
      />
    );
    return { body: <>{stale}<div className="depot-stack">{empty}<HowProduced data={data} /></div></> };
  }
  const board = (
    <DutyBoard
      depotId={depotId}
      rows={rows}
      feedNow={data.feedNow}
      figures={dutyFigures(data)}
      notes={matchingNotes(data)}
    />
  );
  return {
    modelledDay: dutiesModelledDay({
      operatingDate: data.operatingDate,
      duties: data.duties,
      scheduled,
    }),
    body: <>{stale}<div className="depot-stack">{board}<HowProduced data={data} /></div></>,
  };
}

/**
 * The duty page under its header, in every state. Duties and the matching are MODELLED;
 * bus states are derived from the live feed. Nothing here assigns or dispatches anything
 * (the header sentence says so, outside the closed disclosure).
 */
export function DutyPage({ depotId }: { readonly depotId: string }) {
  const { modelledDay, body } = useDutyBody(depotId);
  return (
    <div data-testid="duties-page" className="min-w-0">
      <DutiesHeader modelledDay={modelledDay} />
      {body}
    </div>
  );
}
