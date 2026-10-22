import type { SchedulePlan, VehicleBlock, PieceOfWork } from '../../schedule/types';
import type { VehicleHealth } from './vehicleHealth';

/**
 * Disruption propagation: if one bus is lost at a moment of the day, which of its
 * scheduled work is lost with it, and what each recovery option would save. The block,
 * its pieces and the spare buses are the AI Scheduler's own plan for the depot; a lost
 * piece is counted in bus-hours, never in passengers, because no passenger count exists.
 */

export interface AffectedPiece {
  readonly piece: PieceOfWork;
  /** Minutes of the piece still to run at the moment of loss. */
  readonly lostMinutes: number;
  readonly status: 'done' | 'in_progress' | 'upcoming';
}

export interface RecoveryOption {
  readonly id: 'spare' | 'absorb' | 'none';
  readonly title: string;
  readonly detail: string;
  /** Bus-hours of the block's remaining work this option covers. */
  readonly coveredBusHours: number;
  /** Bus-hours still lost with this option. */
  readonly lostBusHours: number;
  /** Minutes before service resumes on the block's work, when it does. */
  readonly resumeAfterMin: number | null;
  readonly tradeOff: string;
  readonly feasible: boolean;
  /** Pieces this option covers, by id. */
  readonly covers: ReadonlySet<string>;
}

export interface Propagation {
  readonly registration: string;
  readonly block: VehicleBlock;
  readonly atMin: number;
  readonly pieces: readonly AffectedPiece[];
  readonly routesAffected: readonly string[];
  readonly lostBusHours: number;
  readonly options: readonly RecoveryOption[];
  readonly recommended: RecoveryOption['id'];
  /** Other blocks working the same routes later, which could absorb part of the loss. */
  readonly sameRouteBlocks: number;
}

/** Minutes a spare needs to leave the yard and reach the route (a planning allowance). */
export const SPARE_TURNOUT_MIN = 25;

const hours = (min: number): number => Math.round((min / 60) * 10) / 10;

export function blockOf(plan: SchedulePlan, registration: string): VehicleBlock | null {
  const blockId = plan.assignment.assignments.find((a) => a.registrationNumber === registration)?.blockId;
  return blockId ? (plan.blocks.find((b) => b.id === blockId) ?? null) : null;
}

/** Spares the plan left free that are fit to run: not overdue, not high risk. */
export function fitPlanSpares(plan: SchedulePlan, healthByReg: ReadonlyMap<string, VehicleHealth>): string[] {
  return plan.assignment.spareBuses.filter((reg) => {
    const h = healthByReg.get(reg);
    return !h || (h.band !== 'high' && h.service.group !== 'overdue' && h.state !== 'off_road' && h.state !== 'dark');
  });
}

export function propagate(
  plan: SchedulePlan,
  registration: string,
  atMin: number,
  spares: readonly string[],
): Propagation | null {
  const block = blockOf(plan, registration);
  if (!block) return null;
  const pieces: AffectedPiece[] = block.pieces.map((piece) => {
    if (piece.endMin <= atMin) return { piece, lostMinutes: 0, status: 'done' };
    if (piece.startMin <= atMin) return { piece, lostMinutes: piece.endMin - atMin, status: 'in_progress' };
    return { piece, lostMinutes: piece.endMin - piece.startMin, status: 'upcoming' };
  });
  const lostMinutes = pieces.reduce((s, p) => s + p.lostMinutes, 0);
  const remaining = pieces.filter((p) => p.lostMinutes > 0);
  const routesAffected = [...new Set(remaining.map((p) => p.piece.routeName))];

  // A spare covers everything from its arrival on.
  const arrive = atMin + SPARE_TURNOUT_MIN;
  const spareCovers = new Set<string>();
  let spareMinutes = 0;
  for (const p of remaining) {
    const from = Math.max(arrive, p.piece.startMin);
    if (from < p.piece.endMin) {
      spareMinutes += p.piece.endMin - from;
      spareCovers.add(p.piece.id);
    }
  }

  // Other blocks on the same routes can stretch to absorb the upcoming pieces' need,
  // at a longer headway; the in-progress piece's passengers still wait for a bus.
  const others = plan.blocks.filter(
    (b) => b.id !== block.id && b.pieces.some((x) => routesAffected.includes(x.routeName) && x.endMin > atMin),
  );
  const absorbable = remaining.filter((p) => p.status === 'upcoming' && others.some((b) => b.pieces.some((x) => x.routeName === p.piece.routeName && x.startMin < p.piece.endMin && x.endMin > p.piece.startMin)));
  const absorbMinutes = absorbable.reduce((s, p) => s + p.lostMinutes, 0);

  const options: RecoveryOption[] = [
    {
      id: 'spare',
      title: spares.length > 0 ? `Send spare ${spares[0]} for the rest of the block` : 'Send a spare bus',
      detail: `Leaves the yard now and joins the block after about ${SPARE_TURNOUT_MIN} minutes; its crew follows the block's shifts.`,
      coveredBusHours: hours(spareMinutes),
      lostBusHours: hours(lostMinutes - spareMinutes),
      resumeAfterMin: SPARE_TURNOUT_MIN,
      tradeOff: spares.length > 0 ? `The depot has ${spares.length - 1} fit spare${spares.length - 1 === 1 ? '' : 's'} left afterwards.` : 'No fit spare is free in the plan.',
      feasible: spares.length > 0,
      covers: spareCovers,
    },
    {
      id: 'absorb',
      title: `Stretch the ${others.length} other block${others.length === 1 ? '' : 's'} on the same routes`,
      detail: 'No extra bus: the remaining buses on the routes run at a longer headway through the lost pieces.',
      coveredBusHours: hours(absorbMinutes),
      lostBusHours: hours(lostMinutes - absorbMinutes),
      resumeAfterMin: null,
      tradeOff: 'Longer waits on those routes; the in-progress trip is not recovered.',
      feasible: others.length > 0 && absorbMinutes > 0,
      covers: new Set(absorbable.map((p) => p.piece.id)),
    },
    {
      id: 'none',
      title: 'Leave the work uncovered',
      detail: 'Cancel the remaining pieces and inform the routes.',
      coveredBusHours: 0,
      lostBusHours: hours(lostMinutes),
      resumeAfterMin: null,
      tradeOff: 'Every remaining trip of the block is lost.',
      feasible: true,
      covers: new Set(),
    },
  ];
  const recommended = options.filter((o) => o.feasible).sort((a, b) => b.coveredBusHours - a.coveredBusHours)[0]?.id ?? 'none';
  return {
    registration,
    block,
    atMin,
    pieces,
    routesAffected,
    lostBusHours: hours(lostMinutes),
    options,
    recommended,
    sameRouteBlocks: others.length,
  };
}
