import {
  balancePreview,
  partOfPlanVaries,
  planFigures,
  samePlaceNote,
  SHORTFALL_PREVIEW,
  TRANSFER_PREVIEW,
  transferPreview,
} from '@/lib/depot/rebalance/pageLayout';
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
  it('gives four figures with before and after in one value', () => {
    const figures = planFigures(SUMMARY);
    expect(figures.map((f) => f.label)).toEqual([
      'Short depots',
      'Buses moved',
      'Empty running',
      'Deficit covered',
    ]);
    expect(figures[0].value).toBe('9 → 0');
    expect(figures[1].caption).toBe('in 13 transfers');
    expect(figures[2].value).toBe('576.0');
    expect(figures[2].caption).toBe('bus-km, road estimate');
    expect(figures[3].value).toBe('29 of 31');
    expect(figures[3].caption).toBe('2 buses left uncovered');
  });

  it('says every bus is covered when nothing is left', () => {
    const covered = { ...SUMMARY, uncoveredDeficit: 0 } as PlanSummary;
    expect(planFigures(covered)[3].caption).toBe('every short bus covered');
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
