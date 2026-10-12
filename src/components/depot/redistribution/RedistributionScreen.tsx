'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useReducer } from 'react';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { isValidDepotId } from '@/lib/depot/ids';
import { buildEngineModel } from '@/lib/depot/redistribution/engineModel';
import { engineReducer, initialEngineState } from '@/lib/depot/redistribution/engineState';
import { demonstrationScenario, scenarioDepot } from '@/lib/depot/redistribution/scenario';
import { PAGE_DESCRIPTION, PAGE_TAGLINE, PAGE_TITLE, SCENARIO_INDICATOR, SECTION } from '@/lib/depot/redistribution/wording';
import { BriefingSection } from './BriefingSection';
import { HeatmapSection } from './HeatmapSection';
import { ImpactSection } from './ImpactSection';
import { OverviewSection } from './OverviewSection';
import { RecommendationsSection } from './RecommendationsSection';
import { scrollToSection, SectionNav } from './SectionNav';
import { TimelineSection } from './TimelineSection';

/** The header's right side: the tagline and the discreet scenario indicator. */
function HeaderAside() {
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <span className="font-display text-[12px] uppercase tracking-[0.22em] text-holo-teal">{PAGE_TAGLINE}</span>
      <span
        className="depot-tag border-depot-line font-normal normal-case tracking-[0.06em] text-depot-muted"
        title="The figures on this page are a demonstration scenario, not verified operational measurements."
        data-testid="scenario-indicator"
      >
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-depot-faint" />
        {SCENARIO_INDICATOR}
      </span>
    </div>
  );
}

/** The page's header in every state. */
export function RedistributionHeader() {
  return <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} controls={<HeaderAside />} />;
}

/**
 * The AI Redistribution Engine: one state, one derived model, six sections. The address's
 * `?band=` and `?depot=` set the first selection when well formed.
 */
export function RedistributionScreen() {
  const params = useSearchParams();
  const scenario = demonstrationScenario();
  const [state, dispatch] = useReducer(
    engineReducer,
    null,
    () => {
      const depot = params?.get('depot') ?? null;
      return initialEngineState({
        band: params?.get('band') ?? null,
        depotId: isValidDepotId(depot) && scenarioDepot(scenario, depot) !== null ? depot : null,
      });
    },
  );
  const model = useMemo(() => buildEngineModel(scenario, state), [scenario, state]);

  const explore = useCallback((routeId: string) => {
    dispatch({ type: 'focusRoute', routeId });
    scrollToSection(SECTION.recommendations.id);
  }, []);

  const preview = useCallback((id: string) => {
    dispatch({ type: 'selectRec', id });
    dispatch({ type: 'impactView', view: 'side_by_side' });
    scrollToSection(SECTION.impact.id);
  }, []);

  return (
    <>
      <RedistributionHeader />
      <div className="depot-stack" data-testid="redistribution-engine">
        <SectionNav />
        <OverviewSection model={model} dispatch={dispatch} />
        <HeatmapSection model={model} state={state} dispatch={dispatch} onExplore={explore} />
        <RecommendationsSection model={model} state={state} dispatch={dispatch} onPreview={preview} />
        <ImpactSection model={model} state={state} dispatch={dispatch} />
        <TimelineSection model={model} state={state} dispatch={dispatch} />
        <BriefingSection model={model} state={state} />
      </div>
    </>
  );
}
