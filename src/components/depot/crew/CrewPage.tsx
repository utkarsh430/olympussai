'use client';

import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { FiguresDisclosure } from '@/components/depot/maintenance/FiguresDisclosure';
import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import {
  crewDisclosure,
  EMPTY_CREW_REMEDY,
  emptyCrewSentence,
  modelledStatement,
} from '@/lib/depot/crew/crewPageModel';
import { modelledDayLine } from '@/lib/depot/modelledDayLine';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import { useDepotCrew } from '@/hooks/useDepotCrew';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { AvailabilityHero } from './AvailabilityHero';
import { CrewHeader, type CrewProvenance } from './CrewHeader';
import { RosterSection } from './RosterSection';
import { UncoveredShifts } from './UncoveredShifts';
import { SOURCES_PATH } from '@/lib/depot/nav';

/** Placeholder footprint: coverage line, bars, then the two sections. */
const LOADING_ROWS = 10;

export interface CrewPageProps {
  /** The route page's provenance declaration, passed on to the header in every state. */
  readonly provenance: CrewProvenance;
}

/**
 * The crew page: its header (the provenance line carries the modelled day), the
 * availability bars with one coverage line (the hero), the shifts with no crew, the
 * suggested roster behind a disclosure, and the closing "How these figures are produced".
 * The depot id comes from the scope's provider, already validated.
 */
export function CrewPage({ provenance }: CrewPageProps) {
  const detail = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotCrew(detail.depotId);

  if (loading) {
    return (
      <>
        <CrewHeader provenance={provenance} />
        <LoadingBlock rows={LOADING_ROWS} label="Loading the crew view" />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <CrewHeader provenance={provenance} />
        <ErrorPanel
          title={
            error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : 'Could not load crew data'
          }
          message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={refresh}
        />
      </>
    );
  }
  const stale = data.stale || error ? <StaleNotice since={data.feedNow} /> : null;
  if (data.summary.shiftsRequired === 0) {
    // Crew C: the panel's own sentence names the date, so the header adds no second one.
    return (
      <>
        <CrewHeader provenance={provenance} />
        <div className="flex flex-col gap-8">
          {stale}
          <StatePanel
            kind="empty"
            sentence={emptyCrewSentence(data.operatingDate)}
            remedy={EMPTY_CREW_REMEDY}
            action={
              <Link href={SOURCES_PATH} className="depot-link">
                Data sources
              </Link>
            }
          />
          <FiguresDisclosure
            sections={[{ heading: 'What is modelled', lines: [modelledStatement(data.limits)] }]}
          />
        </div>
      </>
    );
  }
  // The ONE modelled-day formula every page on the modelled day prints.
  const modelledDay = modelledDayLine({
    scheduled: detail.data?.outshed.coverage ?? null,
    duties: data.day.duties,
    routes: data.day.routes,
    operatingDate: data.operatingDate,
  });
  return (
    <>
      <CrewHeader provenance={provenance} modelledDay={modelledDay} />
      <div className="flex flex-col gap-8">
        {stale}
        <AvailabilityHero
          availability={data.availability}
          summary={data.summary}
          uncovered={data.uncovered}
        />
        <UncoveredShifts shifts={data.uncovered} total={data.uncoveredTotal} />
        <RosterSection roster={data.roster} total={data.rosterTotal} />
        <FiguresDisclosure
          sections={crewDisclosure(data.summary, data.limits, data.operatingDate)}
        />
      </div>
    </>
  );
}
