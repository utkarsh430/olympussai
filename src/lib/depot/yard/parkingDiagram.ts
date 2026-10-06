import { formatMinute } from '../format';
import { formatCount } from '../format';
import type { ParkingOrder } from './parkingApi';
import { blockedSentence, laneHeading, overflowReasonText, type BlockedLine } from './parkingModel';

/** Geometry of the lane diagram, in CSS pixels. One line per lane keeps 18 lanes near 600px. */
export const SLOT_W_PX = 88;
export const SLOT_GAP_PX = 4;
export const LANE_LABEL_W_PX = 48;
export const LANE_H_PX = 28;
export const LANE_GAP_PX = 4;
const SHORT_REG_CHARS = 4;

export interface DiagramSlot {
  /** 1 is nearest the exit. */
  readonly position: number;
  readonly leftPx: number;
  readonly registration: string | null;
  /** The last four characters, enough to tell buses of one depot apart at a glance. */
  readonly shortReg: string | null;
  /** First duty "05:30", or "—" for a bus with no duty; null for a free place. */
  readonly timeText: string | null;
  readonly title: string;
}

export interface DiagramLane {
  readonly id: string;
  readonly heading: string;
  readonly topPx: number;
  readonly widthPx: number;
  readonly slots: readonly DiagramSlot[];
}

export interface DiagramOverflow {
  readonly registration: string;
  readonly timeText: string;
  readonly reason: string;
}

export interface ParkingDiagram {
  readonly lanes: readonly DiagramLane[];
  readonly widthPx: number;
  readonly heightPx: number;
  readonly overflow: readonly DiagramOverflow[];
  readonly status: BlockedLine;
  /** The diagram's one-sentence summary for assistive technology. */
  readonly summary: string;
}

export function shortRegistration(registration: string): string {
  const clean = registration.trim();
  return clean.length <= SHORT_REG_CHARS ? clean : clean.slice(-SHORT_REG_CHARS);
}

const timeOf = (minute: number | null): string => (minute === null ? '—' : formatMinute(minute));

const slotLeft = (position: number): number =>
  LANE_LABEL_W_PX + (position - 1) * (SLOT_W_PX + SLOT_GAP_PX);

/** Every place of every lane from the exit inwards, filled or free, with its pixel offset. */
export function buildParkingDiagram(order: ParkingOrder): ParkingDiagram {
  const lanes = order.lanes.map((lane, index) => {
    const byPosition = new Map(lane.slots.map((slot) => [slot.position, slot]));
    const slots = Array.from({ length: lane.depth }, (_, i) => {
      const position = i + 1;
      const slot = byPosition.get(position);
      if (!slot) {
        return {
          position,
          leftPx: slotLeft(position),
          registration: null,
          shortReg: null,
          timeText: null,
          title: `Lane ${lane.id}, place ${position}: free`,
        };
      }
      const time =
        slot.firstDutyStartMin === null
          ? 'no duty'
          : `first duty ${formatMinute(slot.firstDutyStartMin)}`;
      return {
        position,
        leftPx: slotLeft(position),
        registration: slot.registrationNumber,
        shortReg: shortRegistration(slot.registrationNumber),
        timeText: timeOf(slot.firstDutyStartMin),
        title: `Lane ${lane.id}, place ${position}: ${slot.registrationNumber}, ${time}`,
      };
    });
    return {
      id: lane.id,
      heading: laneHeading(lane),
      topPx: index * (LANE_H_PX + LANE_GAP_PX),
      widthPx: slotLeft(lane.depth + 1) - SLOT_GAP_PX,
      slots,
    };
  });
  const widthPx = lanes.reduce((max, lane) => Math.max(max, lane.widthPx), LANE_LABEL_W_PX);
  const heightPx = lanes.length === 0 ? 0 : lanes.length * (LANE_H_PX + LANE_GAP_PX) - LANE_GAP_PX;
  const places = order.lanes.reduce((sum, lane) => sum + lane.depth, 0);
  return {
    lanes,
    widthPx,
    heightPx,
    overflow: order.overflow.map((bus) => ({
      registration: bus.registrationNumber,
      timeText: timeOf(bus.firstDutyStartMin),
      reason: overflowReasonText(bus.reason),
    })),
    status: blockedSentence(order.blocked),
    summary: `${formatCount(order.lanes.length)} lanes, ${formatCount(order.parkedCount)} of ${formatCount(places)} places filled, each lane from the exit inwards.`,
  };
}
