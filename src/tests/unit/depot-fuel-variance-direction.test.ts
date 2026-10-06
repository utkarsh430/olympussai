import { describe, expect, it } from 'vitest';
import {
  STAND_OUT_HEADERS,
  formatLitresPer100Km,
  formatVariance,
  nothingStandsOut,
  standOutNote,
} from '@/lib/depot/fuel/fuelStandOut';
import { FUEL_VARIANCE_FLAG_PCT } from '@/lib/depot/fuel/types';

/*
 * The variance is FUEL USED PER KILOMETRE against the peers' median. A bus that
 * stands out uses MORE fuel per kilometre. The note, the headers and every cell say it
 * in that one direction: the consumption columns rise with the variance.
 */

// A bus at 3.7 km per litre against peers at 4.4: its km per litre is BELOW its peers.
const BUS_KMPL = 3.7;
const PEERS_KMPL = 4.4;
const VARIANCE = (PEERS_KMPL / BUS_KMPL - 1) * 100;

describe('the stand-out variance reads in one direction', () => {
  it('shows consumption as litres per 100 km, so the bus figure is above its peers', () => {
    const bus = formatLitresPer100Km(BUS_KMPL);
    const peers = formatLitresPer100Km(PEERS_KMPL);
    expect(bus).toBe('27.0');
    expect(peers).toBe('22.7');
    expect(Number(bus)).toBeGreaterThan(Number(peers));
    expect(formatLitresPer100Km(0)).toBe('—');
  });

  it('says the bus uses more fuel per kilometre, with the threshold from the config', () => {
    expect(standOutNote(FUEL_VARIANCE_FLAG_PCT)).toBe(
      `Uses more than ${FUEL_VARIANCE_FLAG_PCT}% more fuel per kilometre than the median of its peers`,
    );
    expect(standOutNote(15)).not.toMatch(/above|below|km per litre|efficien/i);
  });

  it('names the consumption unit in the headers and never puts km per litre beside the variance', () => {
    expect(STAND_OUT_HEADERS.bus).toEqual({ header: 'L / 100 km' });
    expect(STAND_OUT_HEADERS.peers).toEqual({ header: "Peers' median", unit: 'L / 100 km' });
    expect(STAND_OUT_HEADERS.variance).toEqual({ header: 'Variance' });
    const all = JSON.stringify(STAND_OUT_HEADERS);
    expect(all).not.toMatch(/km per litre|above|below/i);
  });

  it('writes the variance signed, and never at or under the threshold it passed', () => {
    expect(formatVariance(VARIANCE, 15)).toBe('+18.9%');
    expect(formatVariance(18.84, 15)).toBe('+18.8%');
    expect(formatVariance(15.04, 15)).toBe('+15.04%');
    expect(formatVariance(15.001, 15)).toBe('+15.01%');
    expect(formatVariance(-3, 15)).toBe('−3.0%');
  });

  it('says no bus stands out in the same direction, with no "today"', () => {
    expect(nothingStandsOut(15)).toBe(
      'No bus uses more than 15% more fuel per kilometre than the median of its peers',
    );
  });
});
