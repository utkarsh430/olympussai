// How much demand each corridor is run at, and why it cannot be one number.
//
// ─── THE DEFECT THIS FIXES, MEASURED ─────────────────────────────────────
//
// A stop boards `lambda x H` passengers in one headway and sheds
// `alightingFraction` of the load at each stop, so the load a modelled bus
// carries is PROPORTIONAL TO THE CORRIDOR'S OWN TARGET HEADWAY. The harness
// applied one invented rate - 0.8 boardings/min, chosen against a 900 s
// synthetic corridor - to every corridor it ran.
//
// This network's measured target headways are not 900 s. Of the 198
// route-directions with a measured H*, the median is 1,800 s, the upper
// quartile 3,582 s and the maximum 12,497 s. At 0.8/min against 25% alighting
// and 52 seats that implies a steady-state load of 96, 191 and 666 passengers
// respectively, so the buses ran at capacity end to end and MEASURED, real
// corridors returned 74.6-96.4% denied boardings. Saturation is the one regime
// in which the headline metric cannot respond to control at all: waiting time
// is bounded by how many seats exist rather than by how they are spaced. Every
// real-corridor number this harness produced was therefore a statement about
// the demand constant and not about the network.
//
// Confirmed by prediction rather than by hindsight: `lambda x H* / alighting`
// over 52 seats predicted saturation on exactly the three of five sampled real
// corridors that measured it (predicted load/seats 1.27, 0.65, 0.80, 1.85,
// 2.79 against measured denied shares 64.1%, 8.7%, 8.3%, 73.6%, 88.1%).
//
// ─── WHAT REPLACES IT, AND WHAT IS STILL ASSUMED ─────────────────────────
//
// The rate is inverted out of the load rather than picked: given a corridor's
// own H* and stop count, choose the lambda whose MODELLED PEAK LOAD is a
// stated share of the seats. That is not a measurement - it is the same
// invention, applied per corridor instead of once - and it is labelled
// `derived` everywhere it appears. What makes it defensible rather than
// arbitrary is that the share is the only free parameter left, it is reported
// on every row, and the three corridor presets that produced this project's
// entire evidence base already pick their own demand exactly this way (see
// `DERIVED_PEAK_LOAD_SHARE`).
//
// This module deliberately does NOT fit demand from data. `evaluation/calibrate.ts`
// does that from `stop_visits`, per stop, and a fitted stop's rate is merged
// OVER the flat rate this module supplies (`rehearsal/run.ts#CorridorOverrides`).
// So the two compose: calibration wins wherever it reaches, and this is what
// the corridor runs at everywhere else instead of a constant from another
// corridor's arithmetic.
import type { CorridorInputs } from '../rehearsal/corridor.js';
import type { ModelledInputs } from '../rehearsal/run.js';

/**
 * Peak modelled load, expressed in units of one headway's boardings.
 *
 * The engine alights a fraction `a` of the load and then boards `lambda x H`,
 * so across the stops of a trip the load follows
 *
 *     L_j = (1 - a) L_{j-1} + lambda x H,   L_0 = 0
 *     L_j = (lambda x H / a) x (1 - (1 - a)^j)
 *
 * and peaks after the LAST boarding stop. `rehearsal/run.ts` gives the final
 * stop of a route-direction a boarding rate of zero and an alighting fraction
 * of one - journeys end there - so a corridor with `stopCount` stops has
 * `stopCount - 1` boarding events.
 *
 * The `(1 - (1 - a)^j)` term is why this is not simply `H / a`. It matters at
 * the short end of this network: at 25% alighting a four-stop corridor peaks
 * at 58% of the asymptote, so sizing its demand on the asymptote would run it
 * two fifths emptier than a twenty-stop corridor it is being compared with.
 */
export function peakLoadPerHeadwayOfBoardings(
  stopCount: number,
  alightingFraction: number,
): number {
  const boardingStops = Math.max(0, Math.floor(stopCount) - 1);
  if (boardingStops === 0) return 0;
  // Nobody gets off, so the load simply accumulates one headway at a time.
  if (alightingFraction <= 0) return boardingStops;
  const retained = Math.max(0, 1 - alightingFraction);
  return (1 - Math.pow(retained, boardingStops)) / alightingFraction;
}

/** The peak load a corridor carries at a given boarding rate. Passengers, against the seat count. */
export function modelledPeakLoad(
  boardingRatePerMinute: number,
  targetHeadwaySeconds: number,
  alightingFraction: number,
  stopCount: number,
): number {
  const boardingsPerHeadway = (boardingRatePerMinute / 60) * targetHeadwaySeconds;
  return boardingsPerHeadway * peakLoadPerHeadwayOfBoardings(stopCount, alightingFraction);
}

export interface DerivedRateInputs {
  targetHeadwaySeconds: number;
  stopCount: number;
  alightingFraction: number;
  vehicleCapacity: number;
  /** Peak load to size the rate for, as a share of the seats. */
  peakLoadShare: number;
}

/**
 * The boarding rate whose modelled peak load is `peakLoadShare` of the seats.
 *
 * Null - never a fallback - when the corridor cannot produce a load at all: no
 * measured headway to board against, or a single stop with nowhere to board.
 * A silent substitution here would put an invented rate on a corridor whose
 * geometry says nothing, which is the defect this module exists to remove.
 */
export function derivedBoardingRatePerMinute(inputs: DerivedRateInputs): number | null {
  const { targetHeadwaySeconds, stopCount, alightingFraction, vehicleCapacity, peakLoadShare } =
    inputs;
  if (!Number.isFinite(targetHeadwaySeconds) || targetHeadwaySeconds <= 0) return null;
  if (!Number.isFinite(vehicleCapacity) || vehicleCapacity <= 0) return null;
  const unit = peakLoadPerHeadwayOfBoardings(stopCount, alightingFraction);
  if (unit <= 0) return null;
  const boardingsPerHeadway = (peakLoadShare * vehicleCapacity) / unit;
  const rate = (boardingsPerHeadway / targetHeadwaySeconds) * 60;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * The load the derived rate aims at, as a share of the seats.
 *
 * ─── WHY 0.65 AND NOT A ROUND NUMBER ─────────────────────────────────────
 *
 * Every conclusion this project has published came from three corridor
 * presets, and each of them ALREADY sizes its demand this way - the preset
 * docblocks say so in as many words ("about 29 of 60 seats", "about
 * forty-four of fifty-five", "around two thirds full"). Their peak loads are
 * 48% (urban), 65% (suburban) and 80% (inter-city) of their own seat counts.
 *
 * 0.65 is the middle of that range, and choosing it means a real corridor is
 * run in the same load regime as the presets it is being compared against -
 * which is the entire point of the comparison. `test/evaluation/demand.test.ts`
 * pins that it stays inside the presets' own span, so this constant cannot
 * drift away from the evidence it was chosen against.
 *
 * It is a CHOICE, not a measurement, and it is the only free parameter left in
 * this module. `--peak-load-share` sweeps it and every report prints it, for
 * the same reason `sim:eligibility` prints a sensitivity table over the
 * assumed running-time spread: a verdict that moves a long way across it is a
 * verdict about the assumption.
 *
 * It is also NOT the saturation bar. `report.ts#SATURATION_WARN_SHARE` is
 * about DENIED passengers, which is what a full bus produces once variance is
 * added on top of a mean load; this is the mean load itself, and it is set
 * below the seats precisely so that ordinary variance does not push a corridor
 * over.
 */
export const DERIVED_PEAK_LOAD_SHARE = 0.65;

/** Where one corridor's boarding rate came from. */
export type DemandProvenance =
  /** Named for this route-direction in the spec - a fitted value from elsewhere, or an operator's own. */
  | 'specified'
  /** Inverted out of this corridor's own headway, geometry, alighting and seats. */
  | 'derived'
  /** The one invented rate, applied to every corridor. Reproduces the harness as it was. */
  | 'global';

export interface DemandSpecResolved {
  mode: 'global' | 'derived';
  peakLoadShare: number;
  boardingRatePerMinuteByRouteDirectionId: Readonly<Record<string, number>>;
}

export interface CorridorDemand {
  routeDirectionId: string;
  boardingRatePerMinute: number;
  provenance: DemandProvenance;
  targetHeadwaySeconds: number;
  stopCount: number;
  alightingFraction: number;
  vehicleCapacity: number;
  /** Modelled peak load under this rate, in passengers. */
  peakLoad: number;
  /** `peakLoad / vehicleCapacity`. At or above 1 the corridor cannot help but saturate. */
  peakLoadShare: number;
}

/**
 * One corridor's boarding rate, and a truthful account of where it came from.
 *
 * Precedence is deliberate. A value the spec NAMES for this route-direction
 * always wins, because that is how a fit from outside this module - the one
 * `evaluation/calibrate.ts` is producing from `stop_visits` - reaches the run
 * without this module pretending to have measured anything. Failing that, the
 * derived value; failing that, the global constant.
 *
 * `mode: 'global'` is kept rather than removed so a reader can re-run an older
 * evaluation and see the saturation for themselves. It is not a fallback: a
 * corridor whose geometry cannot produce a derived rate falls back to the
 * global one and the row SAYS `global`, so nothing invented is ever labelled
 * derived.
 */
export function resolveCorridorDemand(
  corridor: Pick<CorridorInputs, 'routeDirectionId' | 'stops' | 'policy'>,
  inputs: ModelledInputs,
  spec: DemandSpecResolved,
  /**
   * Inputs that belong to THIS corridor rather than to the run.
   *
   * A `boardingRatePerMinute` here is a rate named for this corridor and ranks
   * as `specified`, above anything derived. The three trial presets arrive
   * this way: each of them already chose its own demand against its own
   * headway and seats (48%, 65% and 80% of capacity), and deriving over the
   * top would mean the preset row in a preset-versus-network comparison was
   * not the preset. Only the spec's own named map outranks it.
   */
  corridorInputs: Partial<ModelledInputs> = {},
): CorridorDemand {
  const targetHeadwaySeconds = corridor.policy.targetHeadwaySeconds;
  const stopCount = corridor.stops.length;
  const shape = {
    routeDirectionId: corridor.routeDirectionId,
    targetHeadwaySeconds,
    stopCount,
    alightingFraction: inputs.alightingFraction,
    vehicleCapacity: inputs.vehicleCapacity,
  };

  const named =
    spec.boardingRatePerMinuteByRouteDirectionId[corridor.routeDirectionId] ??
    corridorInputs.boardingRatePerMinute;
  const rateAndProvenance: { rate: number; provenance: DemandProvenance } = (() => {
    if (named !== undefined && Number.isFinite(named) && named >= 0) {
      return { rate: named, provenance: 'specified' as const };
    }
    if (spec.mode === 'derived') {
      const derived = derivedBoardingRatePerMinute({
        targetHeadwaySeconds,
        stopCount,
        alightingFraction: inputs.alightingFraction,
        vehicleCapacity: inputs.vehicleCapacity,
        peakLoadShare: spec.peakLoadShare,
      });
      if (derived !== null) return { rate: derived, provenance: 'derived' as const };
    }
    return { rate: inputs.boardingRatePerMinute, provenance: 'global' as const };
  })();

  const peakLoad = modelledPeakLoad(
    rateAndProvenance.rate,
    targetHeadwaySeconds,
    inputs.alightingFraction,
    stopCount,
  );

  return {
    ...shape,
    boardingRatePerMinute: rateAndProvenance.rate,
    provenance: rateAndProvenance.provenance,
    peakLoad,
    peakLoadShare: inputs.vehicleCapacity > 0 ? peakLoad / inputs.vehicleCapacity : 0,
  };
}

const PROVENANCE_WORDS: Record<DemandProvenance, string> = {
  specified: 'NAMED in the spec for this corridor',
  derived: "DERIVED from this corridor's own headway, stop count, alighting fraction and seats",
  global: 'the one GLOBAL invented rate, applied to every corridor alike',
};

/** What a report must say about one corridor's demand, in words. */
export function describeDemand(demand: CorridorDemand): string {
  const overloaded = demand.peakLoadShare >= 1;
  return [
    `${demand.boardingRatePerMinute.toFixed(3)} boardings/min — ${PROVENANCE_WORDS[demand.provenance]}.`,
    `Modelled peak load ${demand.peakLoad.toFixed(0)} of ${demand.vehicleCapacity} seats (${(demand.peakLoadShare * 100).toFixed(0)}%)`,
    overloaded
      ? 'which is OVER the seat count, so this corridor saturates by construction and its wait metrics cannot respond to control.'
      : 'which leaves headroom for the variance a disturbance adds.',
  ].join(' ');
}
