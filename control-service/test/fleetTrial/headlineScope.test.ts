// The headline figure, and what it is allowed to be an average of.
//
// ─── THE DEFECT THESE PIN ────────────────────────────────────────────────
//
// `oversaturated` exists to prove the harness reports NO effect past the
// denied-boarding line: past roughly a fifth of offered passengers refused,
// waiting time is bounded by how many seats exist rather than by how they are
// spaced, so a working controller correctly reports nothing there. It is a
// scenario that MUST lose.
//
// Pooled into one top-line "net passenger time" with eighteen scenarios that
// are not saturated, it dragged the urban/500 headline from +2.26% to +0.77%
// and the pooled first-time denied share from 5.6% to 52%. Nothing on the page
// said one of the ingredients was designed to fail, so the only available
// reading of the change was "the controller got three times worse overnight" -
// when what had changed was the test set.
//
// Two rules follow, and both are pinned here:
//
//   1. The headline pools only the scenarios whose numbers can be READ. A
//      scenario is excluded on MEASURED saturation, never on an id list, so
//      the rule keeps working as the library grows and never quietly drops a
//      scenario that merely has a frightening name.
//   2. The saturation FLAG and the denied SHARE it describes are one
//      expression, so they cannot disagree. Before this, the report published
//      `deniedBoardings` (refusal EVENTS) and `totalBoardings` (a headcount)
//      and no share at all; a reader dividing the two got 52% beside a flag
//      reading false, and both numbers were honest about different things.
import { describe, it, expect } from 'vitest';
import { runFleetTrial, DEFAULT_FLEET_TRIAL_SPEC, SATURATION_DENIED_SHARE } from '../../src/fleetTrial/run.js';
import { BUNCHING_SCENARIOS } from '../../src/fleetTrial/scenarios.js';
import type { ArmReport, PhaseReport } from '../../src/fleetTrial/types.js';

/** Sized per scenario, like the sibling suite: four buses each, whatever the library holds. */
const SMALL = {
  ...DEFAULT_FLEET_TRIAL_SPEC,
  corridorPreset: 'urban' as const,
  vehiclesPerPhase: BUNCHING_SCENARIOS.length * 4,
};

const report = runFleetTrial(SMALL);

const armsOf = (phase: PhaseReport): ArmReport[] => [phase.controlled, phase.uncontrolled];

describe('the denied share and the flag drawn on it', () => {
  it('publishes the share the saturation flag is decided on, on every arm it flags', () => {
    // The share was absent from the wire contract entirely. A reader who
    // wanted one had to build it from the two fields that were there -
    // `deniedBoardings / totalBoardings` - which divides refusal EVENTS by a
    // HEADCOUNT and reads about four times high. That is the exact arithmetic
    // `isSaturated`'s own docblock warns against, and it is what put 52%
    // beside a flag that said false.
    const arms: ArmReport[] = [];
    for (const phase of report.phases) {
      arms.push(...armsOf(phase), phase.allScenarios.controlled, phase.allScenarios.uncontrolled);
      for (const scenario of phase.scenarios) arms.push(scenario.controlled, scenario.uncontrolled);
    }
    expect(arms.length).toBeGreaterThan(0);

    for (const arm of arms) {
      const { firstTimeDeniedBoardings: refused, totalBoardings, deniedShare, saturated } = arm.spacing;
      const offered = refused + totalBoardings;
      expect(deniedShare).toBe(offered > 0 ? refused / offered : null);
      // The flag IS the share against the bar. Not "consistent with" - the
      // same quantity, so no future edit can move one without the other.
      expect(saturated).toBe(deniedShare !== null && deniedShare > SATURATION_DENIED_SHARE);
    }
  });
});

describe('the headline pool', () => {
  const saturatedIds = new Set(
    report.phases.flatMap((phase) =>
      phase.scenarios
        .filter((s) => s.controlled.spacing.saturated || s.uncontrolled.spacing.saturated)
        .map((s) => s.id),
    ),
  );

  it('has something to exclude on this fixture, or it is proving nothing', () => {
    // A guard on the guards. If the library ever stops containing a scenario
    // that saturates on this corridor at this fleet size, every assertion
    // below passes vacuously and this file stops being a test.
    expect(saturatedIds.size).toBeGreaterThan(0);
    expect(saturatedIds.size).toBeLessThan(BUNCHING_SCENARIOS.length);
  });

  it('names every scenario it left out, with the share that got it left out', () => {
    const named = report.headlineScope.excludedScenarios;
    expect(new Set(named.map((s) => s.id))).toEqual(saturatedIds);
    expect(report.headlineScope.fellBackToAllScenarios).toBe(false);
    for (const excluded of named) {
      // Named with the number that decided it, so a reader can check the
      // decision rather than take it.
      expect(excluded.deniedShare).toBeGreaterThan(SATURATION_DENIED_SHARE);
      expect(excluded.title.length).toBeGreaterThan(0);
    }
    expect(report.headlineScope.includedScenarioIds).toEqual(
      BUNCHING_SCENARIOS.map((s) => s.id).filter((id) => !saturatedIds.has(id)),
    );
  });

  it('pools the readable scenarios only, and is a DIFFERENT number from the all-scenarios pool', () => {
    for (const phase of report.phases) {
      const readable = phase.scenarios.filter((s) => !saturatedIds.has(s.id));
      expect(readable.length).toBeLessThan(phase.scenarios.length);

      for (const armOf of [
        (s: { controlled: ArmReport; uncontrolled: ArmReport }) => s.controlled,
        (s: { controlled: ArmReport; uncontrolled: ArmReport }) => s.uncontrolled,
      ]) {
        const headline = armOf(phase);
        const all = armOf(phase.allScenarios);
        // Boardings add across scenarios, so this is a check on the POPULATION
        // each pool covers rather than on any derived statistic.
        expect(headline.spacing.totalBoardings).toBe(
          readable.reduce((acc, s) => acc + armOf(s).spacing.totalBoardings, 0),
        );
        expect(all.spacing.totalBoardings).toBe(
          phase.scenarios.reduce((acc, s) => acc + armOf(s).spacing.totalBoardings, 0),
        );
        expect(headline.spacing.totalBoardings).toBeLessThan(all.spacing.totalBoardings);
      }
    }
  });

  it('reports a headline that is not itself saturated, and an all-scenarios pool that still tells the truth', () => {
    for (const phase of report.phases) {
      // The whole point: no arm behind the top-line figure may be past the
      // line the figure cannot be read across.
      for (const arm of armsOf(phase)) expect(arm.spacing.saturated).toBe(false);
      // ...and the all-scenarios pool is still published, unrounded and
      // uncensored, so the reader can see what the full set says.
      expect(phase.allScenarios.contrast.passengerSecondsSavedPercent).not.toBe(
        phase.contrast.passengerSecondsSavedPercent,
      );
    }
  });

  it('scores both phases on an identical scenario set, so the two are comparable', () => {
    // Saturation is measured per arm, so the two phases could in principle
    // disagree about which scenarios saturated - and a phase comparison across
    // two different scenario sets is not a comparison. The exclusion is
    // decided once for the trial, from every arm of every phase.
    const perPhase = report.phases.map((phase) =>
      phase.scenarios.filter((s) => report.headlineScope.includedScenarioIds.includes(s.id)).map((s) => s.id),
    );
    for (const ids of perPhase) expect(ids).toEqual(report.headlineScope.includedScenarioIds);
  });

  it('keeps scenario agreement over EVERY scenario, including the excluded ones', () => {
    // The agreement line answers "is this result broad, or one scenario" and
    // it is the surface on which a scenario designed to lose should be
    // visible. Restricting it to the headline set would hide exactly what a
    // reader needs to see.
    for (const phase of report.phases) {
      expect(phase.scenarioAgreement.count).toBe(phase.scenarios.length);
    }
  });
});

describe('a trial in which nothing is readable', () => {
  it('falls back to the full set and says it did, rather than reporting an empty pool', () => {
    // Excluding every scenario would leave the headline pooling nothing: zero
    // headway samples, a null EWT and a passenger-time percent of null, which
    // renders as an em dash and reads as "the trial found nothing" rather than
    // "every scenario in this trial was past the saturation line". The
    // fallback is stated on the wire so the console can say which it is.
    const saturatedOnly = runFleetTrial({
      ...SMALL,
      scenarios: ['oversaturated'],
      vehiclesPerPhase: 8,
    });
    expect(saturatedOnly.headlineScope.fellBackToAllScenarios).toBe(true);
    expect(saturatedOnly.headlineScope.includedScenarioIds).toEqual(['oversaturated']);
    expect(saturatedOnly.headlineScope.excludedScenarios).toHaveLength(0);
    for (const phase of saturatedOnly.phases) {
      expect(phase.controlled.spacing.headwaySampleCount).toBeGreaterThan(0);
      // Identical pools, because there was nothing to leave out.
      expect(phase.contrast).toEqual(phase.allScenarios.contrast);
    }
  });
});
