'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { FiguresDisclosure } from '@/components/depot/maintenance/FiguresDisclosure';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import {
  crewDisclosure,
  crossReferenceSentence,
  emptyCrewSentence,
  modelledStatement,
} from '@/lib/depot/crew/crewPageModel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { useDepotCrew } from '@/hooks/useDepotCrew';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { AvailabilityHero } from './AvailabilityHero';
import { RosterSection } from './RosterSection';
import { UncoveredShifts } from './UncoveredShifts';

/** Placeholder footprint: coverage line, bars, then the two sections. */
const LOADING_ROWS = 10;

/**
 * The crew page body: the availability bars with one coverage line (the hero), the
 * modelled day it is built on, the shifts with no crew, the suggested roster behind a
 * disclosure, and the closing "How these figures are produced". The depot id comes from
 * the scope's provider, already validated.
 */
export function CrewPage() {
  const detail = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotCrew(detail.depotId);

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
        <StatePanel kind="empty" sentence={emptyCrewSentence()} />
        <FiguresDisclosure
          sections={[{ heading: 'What is modelled', lines: [modelledStatement(data.limits)] }]}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {stale}
      <div>
        <AvailabilityHero
          availability={data.availability}
          summary={data.summary}
          uncovered={data.uncovered}
        />
        <p className="depot-prose mt-4" data-testid="crew-modelled-day">
          {crossReferenceSentence({
            scheduled: detail.data?.outshed.coverage ?? null,
            duties: data.day.duties,
            routes: data.day.routes,
          })}
        </p>
      </div>
      <UncoveredShifts shifts={data.uncovered} total={data.uncoveredTotal} />
      <RosterSection roster={data.roster} total={data.rosterTotal} />
      <FiguresDisclosure sections={crewDisclosure(data.summary, data.limits)} />
    </div>
  );
}
