'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, StaleNotice } from '@/components/depot/shell/DataStates';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { buildCockpit } from '@/lib/depot/cockpit/cockpitModel';
import type { CopilotScope } from '@/lib/depot/copilot/wire';
import { depotHref } from '@/lib/depot/depotNav';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { AttentionStrip } from './AttentionStrip';
import { AvailabilityBar } from './AvailabilityBar';
import { BriefingRow } from './BriefingRow';
import { COCKPIT_HOW_ID, CockpitMethod } from './CockpitMethod';
import { DepotExceptions } from './DepotExceptions';
import { OutshedTracker } from './OutshedTracker';

function CockpitLoading() {
  return (
    <div className="space-y-8" data-testid="depot-cockpit-loading">
      <StatePanel kind="loading" rows={5} sentence="Loading what needs attention" />
      <StatePanel kind="loading" rows={2} sentence="Loading availability" />
      <StatePanel kind="loading" rows={6} sentence="Loading the outshedding tracker" />
    </div>
  );
}

/** The id is well formed (the layout checked) but the current feed has no such depot. */
function UnknownDepot({ depotId }: { readonly depotId: string }) {
  return (
    <StatePanel
      kind="empty"
      testId="depot-cockpit-unknown"
      sentence={`No depot has the id ${depotId} in the current feed.`}
      action={
        <Link href={DEPOTS_ROOT} className="depot-link">
          Back to the network overview
        </Link>
      }
    />
  );
}

/**
 * The depot manager's first screen of a shift, from the scope's single detail poll:
 * what needs attention (the hero), availability, the next departures, exceptions,
 * the briefing, and how the figures are produced. There is always something on
 * screen: placeholders, an error with Retry, or the last good data under a stale strip.
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
        title="Could not load the depot cockpit"
        message={`${error}. The cockpit will appear once the feed answers.`}
        onRetry={refresh}
      />
    );
  }

  return (
    <div data-testid="depot-cockpit" className="depot-stack min-w-0">
      {data.stale || error ? <StaleNotice since={data.feedNow} /> : null}
      <AttentionStrip attention={model.attention} />
      <AvailabilityBar
        fleet={model.board.fleet}
        segments={model.availability}
        text={model.availabilityText}
        yard={model.yardLine}
        yardHref={`${depotHref(depotId)}/yard`}
        howId={COCKPIT_HOW_ID}
      />
      <OutshedTracker
        depotId={depotId}
        rows={model.tracker}
        coverageSentence={model.coverageSentence}
        hasSchedules={model.hasSchedules}
        noSchedulesSentence={model.noSchedulesSentence}
      />
      <DepotExceptions
        depotId={depotId}
        groups={model.exceptionGroups}
        depotLines={model.depotExceptions}
        feedNow={data.feedNow}
      />
      <BriefingRow scope={scope} feedNow={data.feedNow} />
      <CockpitMethod
        fleet={model.board.fleet}
        yardSentence={model.board.yard.sentence}
        yardEstablished={model.board.yard.established}
        status={data.depot.status}
      />
    </div>
  );
}
