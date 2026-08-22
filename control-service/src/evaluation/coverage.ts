// Which of the deployed control laws an evaluation actually exercised.
//
// ─── THE SECOND HALF OF EVERY EVALUATION ─────────────────────────────────
//
// A KPI table says how well the controller did. It cannot say WHICH
// controller was measured. For as long as `simulation/engine.ts` advanced one
// vehicle's whole trip at a time, `mpc/twoWayHold.ts` - Algorithm B, the law
// `kf` and `kb` tune - declined every pair it was ever offered, and every
// evaluation ever run was silently an evaluation of the self-equalizing
// fallback alone. Nothing in the numbers said so. A sweep over `kf` in that
// state returns a flat surface and the honest reading of a flat surface is
// "this parameter does nothing", which would have been exactly wrong.
//
// So coverage is reported next to the KPIs, at the same prominence, and a law
// at 0% is stated with its reason rather than left as an empty row.
import { CONTROL_LAWS } from '../rehearsal/deployedControlLaws.js';
import type {
  ControlLaw,
  DeclineReason,
  RehearsalDecisionRecord,
} from '../rehearsal/deployedControlLaws.js';
import type { SafetyRejectionReason } from '../mpc/types.js';

export interface LawCoverage {
  law: ControlLaw;
  /** Decisions where this law produced at least one candidate. */
  generatedAt: number;
  /** Decisions where this law's candidate was the one selected. */
  selectedAt: number;
  /** Why it produced nothing, most common first. */
  declineReasons: Array<{ reason: DeclineReason; count: number }>;
}

export interface CoverageReport {
  decisions: number;
  /** Decisions where the corridor gave the deciding bus a bus ahead at all. Everything else is structurally undecidable. */
  withLeader: number;
  /** Decisions carrying a bus BEHIND, which is the precondition for two-way holding. */
  withTrailer: number;
  atTerminal: number;
  laws: LawCoverage[];
  safetyRejectionReasons: Array<{ reason: SafetyRejectionReason; count: number }>;
  /** Decisions that ended in an actual hold instruction. */
  actionsProposed: number;
}

const ACTION_TYPE_BY_LAW: Record<ControlLaw, string> = {
  terminal_dispatch: 'terminal_dispatch_hold',
  two_way: 'two_way_hold',
  self_equalizing: 'self_equalizing_hold',
  cost_optimal: 'cost_optimal_hold',
  boarding_limit: 'boarding_limit',
};

function rank<T extends string>(counts: Map<T, number>): Array<{ reason: T; count: number }> {
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function summarizeCoverage(
  decisions: ReadonlyArray<RehearsalDecisionRecord>,
): CoverageReport {
  const generatedAt = new Map<ControlLaw, number>();
  const selectedAt = new Map<ControlLaw, number>();
  const declines = new Map<ControlLaw, Map<DeclineReason, number>>();
  const safety = new Map<SafetyRejectionReason, number>();

  for (const law of CONTROL_LAWS) {
    generatedAt.set(law, 0);
    selectedAt.set(law, 0);
    declines.set(law, new Map());
  }

  let withLeader = 0;
  let withTrailer = 0;
  let atTerminal = 0;
  let actionsProposed = 0;

  for (const decision of decisions) {
    const coverage = decision.coverage;
    if (coverage.hasLeader) withLeader++;
    if (coverage.hasTrailer) withTrailer++;
    if (coverage.atTerminal) atTerminal++;
    if (decision.selectedActionType !== 'no_control') actionsProposed++;

    for (const law of CONTROL_LAWS) {
      if ((coverage.generated[law] ?? 0) > 0) {
        generatedAt.set(law, (generatedAt.get(law) ?? 0) + 1);
      }
      const reason = coverage.declined[law];
      if (reason) {
        const bucket = declines.get(law);
        if (bucket) bucket.set(reason, (bucket.get(reason) ?? 0) + 1);
      }
      if (decision.selectedActionType === ACTION_TYPE_BY_LAW[law]) {
        selectedAt.set(law, (selectedAt.get(law) ?? 0) + 1);
      }
    }

    for (const reason of coverage.safetyRejectionReasons) {
      safety.set(reason, (safety.get(reason) ?? 0) + 1);
    }
  }

  return {
    decisions: decisions.length,
    withLeader,
    withTrailer,
    atTerminal,
    actionsProposed,
    laws: CONTROL_LAWS.map((law) => ({
      law,
      generatedAt: generatedAt.get(law) ?? 0,
      selectedAt: selectedAt.get(law) ?? 0,
      declineReasons: rank(declines.get(law) ?? new Map<DeclineReason, number>()),
    })),
    safetyRejectionReasons: rank(safety),
  };
}

/**
 * Laws that never generated a candidate, with the reason that stopped them.
 *
 * Surfaced separately from the table because it is the finding a reader most
 * needs and most easily scrolls past: a KPI comparison that looks like a
 * verdict on the controller is, if this list is non-empty, a verdict on a
 * subset of it.
 */
export function silentLaws(report: CoverageReport): Array<{ law: ControlLaw; reason: DeclineReason | null }> {
  return report.laws
    .filter((entry) => entry.generatedAt === 0)
    .map((entry) => ({ law: entry.law, reason: entry.declineReasons[0]?.reason ?? null }));
}
