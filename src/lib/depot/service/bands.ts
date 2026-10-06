import { hourLabel } from './feedMinutes';
import type { HourBand, ProposalKind, RouteHourFigures } from './types';

/** Runs of consecutive hours, each at least `minHours` long, in hour order. */
export function bandsOf(hours: readonly number[], minHours: number): HourBand[] {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const bands: HourBand[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  const close = (): void => {
    if (start !== null && previous !== null && previous - start + 1 >= minHours) {
      bands.push({ fromHour: start, toHour: previous });
    }
  };
  for (const hour of sorted) {
    if (previous === null || hour !== previous + 1) {
      close();
      start = hour;
    }
    previous = hour;
  }
  close();
  return bands;
}

/** "07:00–10:00": the band from the start of its first hour to the end of its last. */
export function bandLabel(band: HourBand): string {
  const end = band.toHour + 1;
  return `${hourLabel(band.fromHour)}–${end === 24 ? '24:00' : hourLabel(end)}`;
}

export function inBand(band: HourBand, hour: number): boolean {
  return hour >= band.fromHour && hour <= band.toHour;
}

const TENTHS = 10;
const mean = (xs: readonly number[]): number =>
  Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * TENTHS) / TENTHS;

export interface BandFigures {
  readonly deployed: number;
  readonly needed: number;
  /** Mean of the hours where scheduled supply is known; null when no hour knows it. */
  readonly scheduled: number | null;
}

/** The band's mean deployed, needed and scheduled buses, one decimal. */
export function bandFigures(band: HourBand, hours: readonly RouteHourFigures[]): BandFigures {
  const rows = hours.filter((h) => inBand(band, h.hour));
  if (rows.length === 0) return { deployed: 0, needed: 0, scheduled: null };
  const known = rows.map((h) => h.scheduled).filter((s): s is number => s !== null);
  return {
    deployed: mean(rows.map((h) => h.deployed)),
    needed: mean(rows.map((h) => h.needed)),
    scheduled: known.length === 0 ? null : mean(known),
  };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX = 16;
const ID_DIGITS = 8;
const PROPOSAL_ID = /^p-[0-9a-f]{8}$/;

/** FNV-1a over the UTF-16 code units of a string, as an unsigned 32-bit number. */
function fnv1a(text: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A proposal's id: the same date, kind, route and band always give the same
 * id, so a proposal can be referred to again (by the copilot, in a decision
 * trail) without storing it. No randomness.
 */
export function proposalId(
  operatingDate: string,
  kind: ProposalKind,
  routeName: string,
  band: HourBand,
): string {
  const key = `${operatingDate}|${kind}|${routeName.length}:${routeName}|${band.fromHour}-${band.toHour}`;
  return `p-${fnv1a(key).toString(HEX).padStart(ID_DIGITS, '0')}`;
}

/** True for a string shaped as `proposalId` makes them. */
export function isProposalId(value: unknown): value is string {
  return typeof value === 'string' && PROPOSAL_ID.test(value);
}
