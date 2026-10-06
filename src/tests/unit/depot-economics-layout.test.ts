import { describe, expect, it } from 'vitest';
import type { EconomicsDepotRow } from '@/lib/depot/revenue/api';
import {
  ECONOMICS_COLUMN_WIDTHS,
  ECONOMICS_SIGN_NOTE,
  ECONOMICS_TABLE_NOTE,
  FRAME_AT_1440,
  breakdownButtonName,
  economicsBand,
  economicsDaySentence,
  noDutyPhrase,
} from '@/lib/depot/revenue/economicsLayout';

function depot(
  id: string,
  reason: EconomicsDepotRow['score']['reason'],
  missing: readonly string[] = [],
  kind: EconomicsDepotRow['kind'] = 'depot',
): EconomicsDepotRow {
  return {
    depotId: id,
    name: `D${id}`,
    kind,
    fleet: 40,
    lengthCoverage: { n: 0, of: 1 },
    score: { ranked: reason === 'ok', reason, missing, peerGroup: 'small' },
  } as unknown as EconomicsDepotRow;
}

describe('economics layout', () => {
  it('keeps the three facts in ONE visible sentence', () => {
    expect(ECONOMICS_TABLE_NOTE.split(/[.!?](\s|$)/).filter((s) => s.trim() !== '')).toHaveLength(1);
    expect(ECONOMICS_TABLE_NOTE).toContain('modelled and separate from the Depot Efficiency Index');
    expect(ECONOMICS_TABLE_NOTE).toContain('not profit');
    expect(ECONOMICS_TABLE_NOTE).toContain("driven by the model's assumptions");
    expect(ECONOMICS_TABLE_NOTE).toContain('not a finding about any depot');
    expect(ECONOMICS_SIGN_NOTE).toBe(
      'Change vs peer median; higher earnings and lower fuel cost are better.',
    );
  });

  it('dates the modelled day without the past tense or "today"', () => {
    const words = [economicsDaySentence('2026-10-06'), noDutyPhrase('2026-10-06'), noDutyPhrase()];
    expect(words[0]).toContain('modelled day for 2026-10-06');
    expect(words[1]).toBe('no duty in the modelled day for 2026-10-06');
    for (const w of words) expect(w).not.toMatch(/\bran\b|\btoday\b|did not run/i);
  });

  it('bands ranked, no duty and under a minimum, adding up to the operating depots', () => {
    const band = economicsBand(
      [
        depot('1', 'ok'),
        depot('2', 'ok'),
        depot('3', 'missing_component', ['earningsPerKm']),
        depot('4', 'fleet_too_small'),
        depot('5', 'peer_group_too_small'),
        depot('6', 'not_a_depot', [], 'unassigned'),
      ],
      '2026-10-06',
    );
    expect(band.map((f) => [f.label, f.value])).toEqual([
      ['Ranked', '2'],
      ['No duty in the modelled day', '1'],
      ['Under the peer-group minimum', '2'],
    ]);
    expect(band[0]?.caption).toBe('of 5 operating depots');
    expect(band[1]?.caption).toContain('2026-10-06');
  });

  it('adds a fourth figure only for another missing component, so the figures add up', () => {
    const band = economicsBand([depot('1', 'ok'), depot('2', 'missing_component', ['loadFactor'])]);
    expect(band).toHaveLength(4);
    expect(band[3]?.value).toBe('1');
  });

  it('fits every column inside the 1440 frame', () => {
    const sum = Object.values(ECONOMICS_COLUMN_WIDTHS).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(FRAME_AT_1440);
  });

  it('names the breakdown button as the league page does', () => {
    expect(breakdownButtonName('Alambagh')).toBe('Score breakdown for Alambagh');
  });
});
