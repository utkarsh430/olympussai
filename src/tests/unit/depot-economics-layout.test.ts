import { describe, expect, it } from 'vitest';
import type { EconomicsDepotRow } from '@/lib/depot/revenue/api';
import {
  ECONOMICS_COLUMN_WIDTHS,
  ECONOMICS_EXPANDER_PX,
  MIN_SPARE_PX,
  ECONOMICS_SIGN_NOTE,
  ECONOMICS_TABLE_NOTE,
  breakdownButtonName,
  economicsBand,
  economicsColumnKeys,
  economicsDaySentence,
  economicsTableWidth,
  noDutyPhrase,
} from '@/lib/depot/revenue/economicsLayout';
import { EXPANDER_WIDTH_PX } from '@/components/depot/shell/tableLayout';
import { networkModelledDayLine } from '@/lib/depot/modelledDayLine';
import { TIER_FRAME_PX, type TableTier } from '@/lib/depot/revenue/tableTier';

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
    expect(ECONOMICS_TABLE_NOTE.split(/[.!?](\s|$)/).filter((s) => s.trim() !== '')).toHaveLength(
      1,
    );
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
    // The shared formula (critique round 5 §5), the date through formatPlainDate (item 8).
    expect(words[0]).toBe('Built on the modelled day for 6 Oct 2026 of every operating depot.');
    expect(words[0]).toBe(networkModelledDayLine('2026-10-06'));
    expect(words[1]).toBe('no duty in the modelled day for 6 Oct 2026');
    for (const w of words) {
      expect(w).not.toMatch(/\bran\b|\btoday\b|did not run/i);
      expect(w).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('bands ranked, no duty and under a minimum, adding up to the operating depots', () => {
    const band = economicsBand([
      depot('1', 'ok'),
      depot('2', 'ok'),
      depot('3', 'missing_component', ['earningsPerKm']),
      depot('4', 'fleet_too_small'),
      depot('5', 'peer_group_too_small'),
      depot('6', 'not_a_depot', [], 'unassigned'),
    ]);
    // Short enough that no label is ellipsised at 1440 (capture item 9).
    expect(band.map((f) => [f.label, f.value])).toEqual([
      ['Ranked', '2'],
      ['No duty in the day', '1'],
      ['Peer group too small', '2'],
    ]);
    expect(band[0]?.caption).toBe('of 5 operating depots');
    expect(band[1]?.caption).toBe('not ranked');
  });

  it('adds a fourth figure only for another missing component, so the figures add up', () => {
    const band = economicsBand([depot('1', 'ok'), depot('2', 'missing_component', ['loadFactor'])]);
    expect(band).toHaveLength(4);
    expect(band[3]?.value).toBe('1');
  });

  /*
   * Round 5 reported 1,002 px against 1,000 at 1280. The old test added a hand-set 64 px of
   * "controls" that the shell no longer draws (the expander is 24 px, the row-end chevron
   * sits in a cell's padding), ignored the frame's 2 px border, and summed with a helper that
   * counts a column without a width as 0, so a lost width could never fail it. The sum is
   * now strict, uses the shell's expander width and is pinned per tier.
   */
  it.each<[TableTier, number]>([
    ['wide', 914],
    ['medium', 914],
    ['narrow', 704],
  ])('fits the %s frame with at least 8 px to spare (%i px)', (tier, sum) => {
    expect(economicsTableWidth(tier)).toBe(sum);
    expect(economicsTableWidth(tier)).toBeLessThanOrEqual(TIER_FRAME_PX[tier] - MIN_SPARE_PX);
  });

  it('counts the expander the shell draws', () => {
    expect(ECONOMICS_EXPANDER_PX).toBe(EXPANDER_WIDTH_PX);
  });

  it('keeps RANK · DEPOT · INDEX · EARNINGS · FUEL at 800 and gives the index 150 px', () => {
    expect(economicsColumnKeys('narrow')).toEqual([
      'rank',
      'depot',
      'index',
      'earningsPerKm',
      'costPerKm',
    ]);
    expect(ECONOMICS_COLUMN_WIDTHS.index).toBe(150);
  });

  it('names the breakdown apart from the league\'s "Score breakdown" (R2-m3)', () => {
    expect(breakdownButtonName('Alambagh')).toBe('Economics breakdown for Alambagh');
  });
});
