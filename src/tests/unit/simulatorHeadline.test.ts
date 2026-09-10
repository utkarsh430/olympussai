// The simulator's top line, and who the report on screen belongs to.
//
// Two defects, both about REPORTING and neither about the control laws.
//
// ─── 1. A HEADLINE AVERAGED WITH A SCENARIO BUILT TO LOSE ────────────────
//
// The scenario library contains `oversaturated`, which runs the corridor past
// the denied-boarding line to prove the harness reports NO effect there. Pooled
// into the single "net passenger time" figure with eighteen readable scenarios
// it dragged the urban/500 headline from +2.3% to +0.8%, and nothing on the
// page said one ingredient was designed to fail. A reader comparing that with
// last week's number would conclude the controller had got three times worse
// overnight, when the test set had changed instead.
//
// ─── 2. A REPORT BELONGING TO NOBODY IN PARTICULAR ───────────────────────
//
// `GET /v1/fleet-trial/latest` serves the last report the control-service
// process produced, to every caller. The page renders it on LOAD with no
// statement of when it was produced, at what fleet size, on which corridor, or
// whether it is the reader's own run - which is how a 60-bus diagnostic run
// reporting -7.9% came to be read off a page whose own controls said 1,000.
import { describe, it, expect } from 'vitest';
import {
  headlineNetPassengerTime,
  trialProvenance,
  trialVerdict,
  type NetPassengerTimeInput,
  type TrialProvenanceInput,
} from '@/lib/ops/fleetTrialView';

/**
 * A phase reduced to the fields the headline is built from.
 *
 * `saved` and `total` are passenger-seconds, and the percent is their ratio -
 * which is why the two phases must be summed before dividing rather than
 * averaged after.
 */
function phase(headline: { saved: number; total: number }, all: { saved: number; total: number }) {
  return {
    contrast: { passengerSecondsSaved: headline.saved },
    uncontrolled: { passengers: { totalPassengerSeconds: headline.total } },
    allScenarios: {
      contrast: { passengerSecondsSaved: all.saved },
      uncontrolled: { passengers: { totalPassengerSeconds: all.total } },
    },
  };
}

/** The measured urban/500 shape, rounded: 18 readable scenarios and one that saturates. */
function urbanReport(): NetPassengerTimeInput {
  return {
    headlineScope: {
      includedScenarioIds: Array.from({ length: 18 }, (_, i) => `s${i}`),
      excludedScenarios: [{ id: 'oversaturated', title: 'Oversaturated', deniedShare: 0.5 }],
      fellBackToAllScenarios: false,
      note: 'Averaged over 18 of 19 scenarios.',
    },
    phases: [
      phase({ saved: 246, total: 10_000 }, { saved: 95, total: 10_000 }),
      phase({ saved: 246, total: 10_000 }, { saved: 95, total: 10_000 }),
    ],
  };
}

describe('the net passenger time headline', () => {
  it('is the readable scenarios, and carries the all-scenarios figure beside it', () => {
    const view = headlineNetPassengerTime(urbanReport());
    expect(view.headlinePercent).toBeCloseTo(2.46, 6);
    // Never instead of. A reader must be able to see what the whole library
    // says, or the exclusion is a number being hidden rather than explained.
    expect(view.allScenariosPercent).toBeCloseTo(0.95, 6);
    expect(view.includedScenarioCount).toBe(18);
    expect(view.totalScenarioCount).toBe(19);
    expect(view.excludedScenarios.map((s) => s.title)).toEqual(['Oversaturated']);
    expect(view.differs).toBe(true);
  });

  it('sums passenger-seconds across phases before dividing, never averages two percents', () => {
    // The phases carry different fleets and different passenger bills, so a
    // mean of the two percents weights the smaller phase equally with the
    // larger one and does not even commute.
    const view = headlineNetPassengerTime({
      ...urbanReport(),
      phases: [
        phase({ saved: 100, total: 1_000 }, { saved: 100, total: 1_000 }),
        phase({ saved: 100, total: 9_000 }, { saved: 100, total: 9_000 }),
      ],
    });
    expect(view.headlinePercent).toBeCloseTo((200 / 10_000) * 100, 6);
    // The mean of the two percents would be 10.6%, five times the truth.
    expect(view.headlinePercent).not.toBeCloseTo((10 + 100 / 90) / 2, 3);
  });

  it('says nothing was excluded rather than implying something was, when nothing saturated', () => {
    const clean = urbanReport();
    clean.headlineScope = {
      includedScenarioIds: ['a', 'b'],
      excludedScenarios: [],
      fellBackToAllScenarios: false,
      note: 'Averaged over all 2 scenarios. None ran past the saturation line.',
    };
    clean.phases = [phase({ saved: 100, total: 1_000 }, { saved: 100, total: 1_000 })];
    const view = headlineNetPassengerTime(clean);
    expect(view.excludedScenarios).toHaveLength(0);
    expect(view.differs).toBe(false);
    expect(view.headlinePercent).toBe(view.allScenariosPercent);
  });

  it('reports an absent figure as absent, never as zero', () => {
    // A phase with no passenger bill at all is an absence. Zero would read as
    // "the controller changed nothing", which is a measurement.
    const view = headlineNetPassengerTime({
      ...urbanReport(),
      phases: [phase({ saved: 0, total: 0 }, { saved: 0, total: 0 })],
    });
    expect(view.headlinePercent).toBeNull();
    expect(view.allScenariosPercent).toBeNull();
  });

  it('says so when every scenario saturated and the headline had to be the full set', () => {
    const view = headlineNetPassengerTime({
      headlineScope: {
        includedScenarioIds: ['oversaturated'],
        excludedScenarios: [],
        fellBackToAllScenarios: true,
        note: 'Every scenario in this trial ran past the saturation line.',
      },
      phases: [phase({ saved: -50, total: 1_000 }, { saved: -50, total: 1_000 })],
    });
    expect(view.fellBackToAllScenarios).toBe(true);
    expect(view.headlinePercent).toBeCloseTo(-5, 6);
  });
});

describe('whose report is on the screen', () => {
  const REPORT: TrialProvenanceInput = {
    generatedAt: '2026-09-06T09:00:00.000Z',
    corridorPreset: { id: 'urban', title: '24 km city trunk', description: '' },
    vehiclesSimulated: 120,
    phases: [{ vehicleCount: 60 }, { vehicleCount: 60 }],
  };
  const NOW = new Date('2026-09-06T09:41:00.000Z');

  it('reads the fleet size off the report, not off the page controls', () => {
    // This IS the captain's bug: a 60-bus diagnostic run reporting -7.9% read
    // off a page whose own controls said 1,000. The controls describe what the
    // next run WOULD be; only the report says what this one WAS.
    const view = trialProvenance(REPORT, 'stored', NOW);
    expect(view.vehiclesPerPhase).toBe(60);
    expect(view.vehiclesSimulated).toBe(120);
    expect(view.corridorPresetId).toBe('urban');
  });

  it('says a stored report came from the service and may be somebody else’s', () => {
    const view = trialProvenance(REPORT, 'stored', NOW);
    expect(view.isThisSessionsRun).toBe(false);
    expect(view.summary).toMatch(/24 km city trunk/);
    expect(view.summary).toMatch(/60 buses/);
    // Ownership stated in words, because the page previously implied it by
    // saying nothing.
    expect(view.ownership).toMatch(/last trial this service ran/i);
    expect(view.ownership).toMatch(/may not be yours|someone else/i);
  });

  it('says a run the reader just triggered is theirs', () => {
    const view = trialProvenance(REPORT, 'this-session', NOW);
    expect(view.isThisSessionsRun).toBe(true);
    expect(view.ownership).toMatch(/you ran/i);
  });

  it('states the age of the report, so a stale one cannot pass for a fresh one', () => {
    expect(trialProvenance(REPORT, 'stored', NOW).age).toBe('41 minutes ago');
    expect(trialProvenance(REPORT, 'stored', new Date('2026-09-06T09:00:20.000Z')).age).toBe(
      'just now',
    );
    expect(trialProvenance(REPORT, 'stored', new Date('2026-09-07T11:00:00.000Z')).age).toBe(
      '26 hours ago',
    );
  });

  it('flags a report old enough that the code under test may have moved since', () => {
    expect(trialProvenance(REPORT, 'stored', NOW).stale).toBe(false);
    expect(trialProvenance(REPORT, 'stored', new Date('2026-09-06T21:00:00.000Z')).stale).toBe(
      true,
    );
    // A run the reader just triggered is never stale, whatever the clock says:
    // its timestamp comes from the service, and a skewed service clock must
    // not make a fresh run look old.
    expect(
      trialProvenance(REPORT, 'this-session', new Date('2026-09-06T21:00:00.000Z')).stale,
    ).toBe(false);
  });

  it('says nothing about age until it is given a clock, so the two renders agree', () => {
    // The console is server-rendered for the first paint and hydrated in the
    // browser. A relative age read off `new Date()` in both places is two
    // different strings and a hydration mismatch, so the clock is passed in
    // and everything time-dependent is absent until there is one.
    const view = trialProvenance(REPORT, 'stored', null);
    expect(view.age).toBeNull();
    expect(view.stale).toBe(false);
    expect(view.summary).not.toMatch(/ago/);
    // ...and everything the report itself knows is still said.
    expect(view.summary).toMatch(/24 km city trunk · 60 buses per phase/);
    expect(view.generatedAtLabel).toBe('2026-09-06T09:00:00.000Z');
  });

  it('does not invent an age from an unparseable timestamp', () => {
    const view = trialProvenance({ ...REPORT, generatedAt: 'not a date' }, 'stored', NOW);
    expect(view.age).toBeNull();
    expect(view.generatedAtLabel).toBeNull();
    // ...and still says everything it does know.
    expect(view.vehiclesPerPhase).toBe(60);
  });
});

// ─── 3. THE ONE-LINE ANSWER ──────────────────────────────────────────────
//
// The page's first job is to say whether the controller helped. Two ways that
// sentence can lie, and both are guarded here:
//
//   * taking it off excess wait, which counts only the people at stops. The
//     trial has already found a configuration that improved excess wait 46%
//     while making total passenger time 12% worse; a page that led on excess
//     wait would have called that a success.
//   * claiming a direction off a mean the scenarios do not agree on. The
//     headline is ONE SEED per scenario, and the page already refuses to read
//     a policy-sweep row whose seeds disagree. The verdict gets the same test.
describe('the one-line verdict', () => {
  function verdictPhase(over: {
    saved: number;
    total: number;
    positive: number;
    count: number;
    ewt?: number | null;
    id?: string;
    title?: string;
  }) {
    return {
      id: over.id ?? 'occupancy_blind',
      title: over.title ?? 'Load ignored',
      contrast: {
        passengerSecondsSaved: over.saved,
        ewtImprovementPercent: over.ewt === undefined ? 20 : over.ewt,
      },
      uncontrolled: { passengers: { totalPassengerSeconds: over.total } },
      allScenarios: {
        contrast: { passengerSecondsSaved: over.saved },
        uncontrolled: { passengers: { totalPassengerSeconds: over.total } },
      },
      scenarioAgreement: { positive: over.positive, count: over.count },
    };
  }

  const scope = (over: Partial<NetPassengerTimeInput['headlineScope']> = {}) => ({
    includedScenarioIds: Array.from({ length: 16 }, (_, i) => `s${i}`),
    excludedScenarios: [
      { id: 'oversaturated', title: 'Oversaturated', deniedShare: 0.5 },
      { id: 'station_surge', title: 'Station surge', deniedShare: 0.4 },
      { id: 'building_peak', title: 'Building peak', deniedShare: 0.3 },
    ],
    fellBackToAllScenarios: false,
    note: 'Averaged over 16 of 19 scenarios.',
    ...over,
  });

  it('says the controller helped when the total fell and the scenarios agree', () => {
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [
        verdictPhase({ saved: 290, total: 10_000, positive: 16, count: 19 }),
        verdictPhase({ saved: 290, total: 10_000, positive: 16, count: 19 }),
      ],
    });
    expect(view.verdict).toBe('helped');
    expect(view.statement).toBe('The controller helped.');
    expect(view.passengerTimePercent).toBeCloseTo(2.9, 6);
    expect(view.agreeingScenarios).toBe(32);
    expect(view.totalScenariosCounted).toBe(38);
  });

  it('takes the verdict off passenger time, NOT off excess wait', () => {
    // The measured trap: excess wait improves hugely while the whole journey
    // gets worse, because the hold is paid for by everyone already aboard.
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [
        verdictPhase({ saved: -1_200, total: 10_000, positive: 2, count: 19, ewt: 46 }),
        verdictPhase({ saved: -1_200, total: 10_000, positive: 2, count: 19, ewt: 46 }),
      ],
    });
    expect(view.verdict).toBe('cost_more');
    expect(view.statement).toBe('The controller cost more than it saved.');
    // And the excess-wait figure is still published, per phase, never pooled.
    expect(view.excessWaitByPhase.map((p) => p.percent)).toEqual([46, 46]);
  });

  it('counts agreement against the sign the total actually has', () => {
    // 17 of 19 scenarios NEGATIVE is a broad bad result, not a weak one.
    // Counting only the positive scenarios would report "no effect measured".
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [verdictPhase({ saved: -500, total: 10_000, positive: 2, count: 19 })],
    });
    expect(view.verdict).toBe('cost_more');
    expect(view.agreeingScenarios).toBe(17);
  });

  it('refuses a direction the trial cannot resolve, however many scenarios agree', () => {
    // MEASURED on inter-city at 1,000 buses/phase: +0.1% net passenger time
    // with 21 of 38 scenarios agreeing. The agreement test alone passed that
    // - 21 of 38 is a majority - and the page said "the controller helped"
    // about a corridor this repo already records as zero to within +/- 0.5.
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [
        verdictPhase({ saved: 10, total: 10_000, positive: 11, count: 19 }),
        verdictPhase({ saved: 10, total: 10_000, positive: 10, count: 19 }),
      ],
    });
    expect(view.passengerTimePercent).toBeCloseTo(0.1, 6);
    expect(view.verdict).toBe('no_effect');
    expect(view.because).toMatch(/single draw/i);
  });

  it('clears the noise floor on a corridor where the effect is real', () => {
    // Urban, measured: +2.9% +/- 0.3 over six seeds — six times the spread.
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [verdictPhase({ saved: 290, total: 10_000, positive: 16, count: 19 })],
    });
    expect(view.verdict).toBe('helped');
  });

  it('applies the noise floor to a negative result too, not only a positive one', () => {
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [verdictPhase({ saved: -10, total: 10_000, positive: 2, count: 19 })],
    });
    expect(view.verdict).toBe('no_effect');
  });

  it('refuses to claim a direction the scenarios do not agree on', () => {
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [verdictPhase({ saved: 900, total: 10_000, positive: 9, count: 19 })],
    });
    expect(view.verdict).toBe('no_effect');
    expect(view.statement).toBe('This trial did not measure an effect.');
  });

  it('reads an even split as disagreement, never as agreement', () => {
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [verdictPhase({ saved: 900, total: 10_000, positive: 10, count: 20 })],
    });
    expect(view.verdict).toBe('no_effect');
  });

  it('says it cannot answer at all when every scenario saturated', () => {
    const view = trialVerdict({
      headlineScope: scope({ fellBackToAllScenarios: true, excludedScenarios: [] }),
      phases: [verdictPhase({ saved: 290, total: 10_000, positive: 19, count: 19 })],
    });
    expect(view.verdict).toBe('unreadable');
    expect(view.statement).toBe('This trial cannot say whether the controller helped.');
  });

  it('says it cannot answer when no passenger time was billed at all', () => {
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [verdictPhase({ saved: 0, total: 0, positive: 0, count: 0 })],
    });
    expect(view.verdict).toBe('unreadable');
    expect(view.passengerTimePercent).toBeNull();
  });

  it('never pools excess wait across phases, and names which phase each figure is', () => {
    const view = trialVerdict({
      headlineScope: scope(),
      phases: [
        verdictPhase({
          saved: 290,
          total: 10_000,
          positive: 16,
          count: 19,
          ewt: 24,
          id: 'occupancy_blind',
          title: 'Load ignored',
        }),
        verdictPhase({
          saved: 290,
          total: 10_000,
          positive: 16,
          count: 19,
          ewt: 22,
          id: 'occupancy_aware',
          title: 'Load weighed',
        }),
      ],
    });
    expect(view.excessWaitByPhase).toEqual([
      { id: 'occupancy_blind', title: 'Load ignored', percent: 24 },
      { id: 'occupancy_aware', title: 'Load weighed', percent: 22 },
    ]);
  });
});
