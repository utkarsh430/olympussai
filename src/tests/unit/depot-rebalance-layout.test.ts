import { contentWidthAt } from '@/lib/depot/shell/geometry';
import { describe, expect, it } from 'vitest';
import {
  balancePreview,
  partOfPlanVaries,
  planFigures,
  samePlaceNote,
  SHORTFALL_PREVIEW,
  TRANSFER_PREVIEW,
  transferPreview,
} from '@/lib/depot/rebalance/pageLayout';
import {
  spareBeforeAfter,
  TRANSFER_COLUMNS,
  TRANSFER_TABLE_PX,
  TRANSFER_SPLIT_FROM_PX,
  transferFrameInnerPx,
} from '@/lib/depot/rebalance/transferColumns';
import type { BalanceRow, PlanSummary } from '@/lib/depot/rebalance/rebalanceModel';

const totals = (deficitDepots: number, deficit: number) => ({
  depotsInDeficit: deficitDepots,
  depotsInSurplus: 3,
  totalDeficit: deficit,
  totalSurplus: 40,
});

const SUMMARY = {
  before: totals(9, 31),
  after: totals(0, 0),
  transfers: 13,
  busesMoved: 29,
  coveredDeficit: 29,
  uncoveredDeficit: 2,
  busKm: 576.04,
} as unknown as PlanSummary;

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

describe('plan figures', () => {
  it('gives five figures with before and after in one value, the surplus side included', () => {
    const figures = planFigures(SUMMARY);
    expect(figures.map((f) => f.label)).toEqual([
      'Short depots',
      'Surplus buses',
      'Buses moved',
      'Empty running',
      'Deficit met',
    ]);
    // No label is ellipsised in its 232px figure: mono 11px with 0.12em tracking is about
    // 8.6px a character, so a label stays within 24 characters.
    for (const f of figures) expect(f.label.length).toBeLessThanOrEqual(24);
    expect(figures[0]?.value).toBe('9 → 0');
    expect(figures[1]?.value).toBe('40 → 40');
    expect(figures[1]?.caption).toBe('network, before → after');
    expect(figures[2]?.caption).toBe('in 13 transfers');
    expect(figures[3]?.value).toBe('576.0');
    expect(figures[3]?.caption).toBe('bus-km, road estimate');
    expect(figures[4]?.value).toBe('29 of 31');
    expect(figures[4]?.caption).toBe('2 buses left uncovered');
  });

  it('says every bus is covered when nothing is left', () => {
    const covered = { ...SUMMARY, uncoveredDeficit: 0 } as PlanSummary;
    expect(planFigures(covered)[4]?.caption).toBe('every short bus covered');
  });
});

describe('transfer preview', () => {
  it('shows ten and counts the rest', () => {
    const preview = transferPreview(rows(13), false, null);
    expect(TRANSFER_PREVIEW).toBe(10);
    expect(preview.rows).toHaveLength(10);
    expect(preview.hidden).toBe(3);
  });

  it('keeps a selected row that falls past the first ten', () => {
    const preview = transferPreview(rows(13), false, 't12');
    expect(preview.rows.map((r) => r.id)).toContain('t12');
    expect(preview.hidden).toBe(2);
  });

  it('shows every row when asked', () => {
    expect(transferPreview(rows(13), true, null)).toEqual({ rows: rows(13), hidden: 0 });
  });
});

describe('same place note', () => {
  it('says two depots drawn at nearly one position stand at the same place', () => {
    const note = samePlaceNote({ fromName: 'Meerut', toName: 'Bhaisali', distanceKm: 0.2 });
    expect(note).toBe(
      'Meerut and Bhaisali stand at the same place by their inferred positions (0.2 km apart).',
    );
  });

  it('says nothing for depots a real distance apart', () => {
    expect(samePlaceNote({ fromName: 'A', toName: 'B', distanceKm: 12 })).toBeNull();
  });

  it('says nothing for a distance that is not a finite, non-negative number', () => {
    for (const distanceKm of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      expect(samePlaceNote({ fromName: 'A', toName: 'B', distanceKm })).toBeNull();
    }
  });
});

describe('every-depot table', () => {
  const balance = (n: number, takesPart = true) =>
    Array.from({ length: n }, (_, i) => ({ depotId: `d${i}`, takesPart })) as unknown as BalanceRow[];

  it('shows the fifteen deepest shortfalls first', () => {
    expect(SHORTFALL_PREVIEW).toBe(15);
    expect(balancePreview(balance(119), false)).toHaveLength(15);
    expect(balancePreview(balance(119), true)).toHaveLength(119);
  });

  it('keeps the part-of-plan column only when it varies', () => {
    expect(partOfPlanVaries(balance(5))).toBe(false);
    expect(partOfPlanVaries([...balance(5), ...balance(1, false)])).toBe(true);
  });
});

describe('transfer table columns at 1440', () => {
  it('keeps transfer, buses, road km, bus-km and the decision word, no "Why?" column, and fits uncut', () => {
    expect(TRANSFER_COLUMNS.map((c) => c.key)).toEqual([
      'transfer',
      'buses',
      'roadKm',
      'busKm',
      'decision',
      'open',
    ]);
    expect(TRANSFER_COLUMNS.map((c) => c.label)).not.toContain('Why?');
    // The row is the control: its last column is the 24px chevron, with no header text.
    expect(TRANSFER_COLUMNS.at(-1)).toMatchObject({ label: '', widthPx: 24 });
    expect(TRANSFER_COLUMNS[0]?.widthPx).toBe(224);
    expect(TRANSFER_TABLE_PX).toBe(616);
    expect(transferFrameInnerPx(1440)).toBe(622);
  });

  it.each([1440, 1280, 1024, 800])('cuts no transfer column at %i px', (viewportPx) => {
    expect(TRANSFER_TABLE_PX).toBeLessThanOrEqual(transferFrameInnerPx(viewportPx));
  });

  it('puts the table above the map at 1280, where the split would cut a column', () => {
    expect(TRANSFER_SPLIT_FROM_PX).toBeGreaterThan(1280);
    expect(transferFrameInnerPx(1280)).toBe(contentWidthAt(1280) - 2);
  });

  it('says the giver and receiver figures before and after in one sentence, never below zero', () => {
    const row = {
      fromName: 'Meerut',
      toName: 'Bhaisali',
      buses: 9,
      giverSurplusBefore: 20,
      receiverDeficitBefore: 6,
    };
    expect(spareBeforeAfter(row)).toBe(
      'Meerut has 20 surplus buses before this transfer and 11 after; Bhaisali is 6 buses short before and 0 after.',
    );
  });
});
