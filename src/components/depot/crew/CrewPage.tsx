'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { emptyCrewSentence } from '@/lib/depot/crew/crewPageModel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { useDepotCrew } from '@/hooks/useDepotCrew';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { AvailabilityHero } from './AvailabilityHero';
import { CrewSummary } from './CrewSummary';
import { ModelledStatement } from './ModelledStatement';
import { RosterSection } from './RosterSection';
import { UncoveredShifts } from './UncoveredShifts';

/** Placeholder footprint: summary, hero, then the two tables. */
const LOADING_ROWS = 14;

/**
 * The crew page body: today's cover in words and figures, the availability hero,
 * the shifts with no crew and why, the suggested roster, and the MODELLED
 * statement. The depot id comes from the scope's provider, already validated.
 */
export function CrewPage() {
  const { depotId } = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotCrew(depotId);

  if (loading) return <LoadingBlock rows={LOADING_ROWS} label="Loading the crew view" />;
  if (!data) {
    return (
      <ErrorPanel
        title={error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : 'Could not load crew data'}
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }
  const stale = data.stale || error ? <StaleStrip since={data.feedNow} /> : null;
  if (data.summary.shiftsRequired === 0) {
    return (
      <div className="flex flex-col gap-8">
        {stale}
        <EmptyState>{emptyCrewSentence()}</EmptyState>
        <ModelledStatement limits={data.limits} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {stale}
      <CrewSummary summary={data.summary} />
      <AvailabilityHero availability={data.availability} />
      <UncoveredShifts shifts={data.uncovered} total={data.uncoveredTotal} />
      <RosterSection roster={data.roster} total={data.rosterTotal} />
      <ModelledStatement limits={data.limits} />
    </div>
  );
}
