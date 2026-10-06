'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { BriefingCard } from '@/components/depot/copilot/BriefingCard';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { buildCockpit } from '@/lib/depot/cockpit/cockpitModel';
import type { CopilotScope } from '@/lib/depot/copilot/wire';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { DepotExceptions } from './DepotExceptions';
import { DepotHeader } from './DepotHeader';
import { OutshedTracker } from './OutshedTracker';
import { StatusBoard } from './StatusBoard';
import { VisitorList } from './VisitorList';

function CockpitLoading() {
  return (
    <div className="space-y-8" data-testid="depot-cockpit-loading">
      <LoadingBlock rows={2} rowHeight={28} label="Loading the depot" />
      <LoadingBlock rows={1} rowHeight={220} label="Loading the status board" />
      <LoadingBlock rows={6} label="Loading the outshedding tracker" />
      <LoadingBlock rows={3} label="Loading exceptions" />
      <LoadingBlock rows={3} label="Loading visitors" />
    </div>
  );
}

/** The id is well formed (the layout checked) but the current feed has no such depot. */
function UnknownDepot({ depotId }: { readonly depotId: string }) {
  return (
    <div data-testid="depot-cockpit-unknown">
      <EmptyState>
        No depot has the id {depotId} in the current feed.{' '}
        <Link href={DEPOTS_ROOT} className="depot-link">
          Back to the network overview
        </Link>
      </EmptyState>
    </div>
  );
}

/**
 * The depot manager's first screen of a shift: the depot, its status board (the
 * page's one hero), today's departures, what needs attention, and the visitors in
 * its yard, all from the scope's single detail poll. There is always something on
 * screen: placeholders, an error with Retry, or the last good data under a stale
 * strip.
 */
export function DepotCockpit() {
  const { data, error, loading, refresh, depotId } = useDepotDetailContext();
  const model = useMemo(() => (data ? buildCockpit(data) : null), [data]);
  const scope = useMemo<CopilotScope>(() => ({ kind: 'depot', depotId }), [depotId]);

  if (!data || !model) {
    if (error === DEPOT_NOT_FOUND_MESSAGE) return <UnknownDepot depotId={depotId} />;
    if (loading || !error) return <CockpitLoading />;
    return (
      <ErrorPanel
        message={`${error}. The cockpit will appear once the feed answers.`}
        onRetry={refresh}
      />
    );
  }

  return (
    <div data-testid="depot-cockpit" className="space-y-8">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <DepotHeader header={model.header} />
      <BriefingCard scope={scope} title="Depot briefing" />
      <StatusBoard board={model.board} status={data.depot.status} />
      <OutshedTracker
        depotId={depotId}
        rows={model.tracker}
        coverage={data.outshed.coverage}
        coverageSentence={model.coverageSentence}
        hasSchedules={model.hasSchedules}
        noSchedulesSentence={model.noSchedulesSentence}
      />
      <DepotExceptions depotId={depotId} lines={model.exceptions} />
      <VisitorList visitors={model.visitors} yardEstablished={model.board.yard.established} />
    </div>
  );
}
