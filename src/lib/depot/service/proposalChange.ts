import { formatCount } from '../format';
import { changeCell, gapFigure, hourLabel } from './serviceWording';
import type { Proposal, RouteHourFigures } from './types';

/*
 * A proposal's change cell. An add's band can run from a few buses short to many, so when
 * its hours' gaps differ the cell gives their range ("Add 4 to 19") and the title and the
 * expanded row name the peak hour; the band's figure (its mean gap rounded up) would hide
 * both ends. A hold is the least every hour of its band can release, so it stays one
 * figure, as does a finding, which moves no bus.
 */

export interface ChangeWords {
  readonly change: string;
  readonly changeTitle: string;
  /** The range and the peak in a sentence for the expanded row; null for one figure. */
  readonly peak: string | null;
}

interface GapRange {
  readonly low: number;
  readonly high: number;
  readonly peakHour: number;
}

/** The band's whole hourly gaps, low to high, and the first hour at the high. */
function gapRange(p: Proposal, hours: readonly RouteHourFigures[]): GapRange | null {
  const band = hours.filter((h) => h.hour >= p.band.fromHour && h.hour <= p.band.toHour);
  if (band.length === 0) return null;
  const whole = band.map((h) => ({ hour: h.hour, gap: Math.round(h.gap) }));
  const peak = whole.reduce((best, h) => (h.gap > best.gap ? h : best));
  const low = Math.min(...whole.map((h) => h.gap));
  return { low, high: peak.gap, peakHour: peak.hour };
}

/** The change cell, its title and the peak sentence; `noSource` titles a finding. */
export function changeWords(
  p: Proposal,
  hours: readonly RouteHourFigures[],
  noSource: string,
): ChangeWords {
  const one = changeCell(p.kind, p.change);
  if (p.change === 0) return { change: one, changeTitle: noSource, peak: null };
  const range = p.change > 0 ? gapRange(p, hours) : null;
  if (range === null || range.low === range.high) {
    return { change: one, changeTitle: `${one} buses`, peak: null };
  }
  const span = `${formatCount(range.low)} to ${formatCount(range.high)}`;
  const at = hourLabel(range.peakHour);
  const peakGap = gapFigure(range.high);
  return {
    change: `Add ${span}`,
    changeTitle: `Add ${span} buses; peak ${peakGap} at ${at}`,
    peak: `Short by ${span} across the band, most at ${at} (${peakGap}).`,
  };
}
