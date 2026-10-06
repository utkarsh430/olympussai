import { describe, expect, it } from 'vitest';
import { kpiLayout, weekTrendNote } from '@/lib/depot/network/overviewWords';
import {
  DARK_HEADER_TITLE,
  TABLE_COLUMN_SPEC,
  TABLE_FRAME_PX_1440,
  TABLE_FRAME_PX_800,
  TABLE_FRAME_PX_1024,
  TABLE_FRAME_PX_390,
  tableColumnKeys,
  tableWidthPx,
  unitStateCounts,
} from '@/lib/depot/network/unitsTable';
import type { DepotSummary, Figure, NetworkKpis } from '@/lib/depot/types';

const derived = (value: number): Figure => ({ value, provenance: 'derived' });
const KPIS: NetworkKpis = {
  fleet: derived(100),
  depots: derived(3),
  reporting: derived(90),
  onRoad: derived(70),
  stationary: derived(10),
  noSignal: derived(5),
  underMaintenance: derived(4),
  assigned: derived(60),
};

describe('overview band, in the classified state words', () => {
  it('labels the four state figures On road, Standing, Dark, Off road and never the feed field', () => {
    const { primary, secondary } = kpiLayout(KPIS, []);
    expect(primary.map((f) => f.label)).toEqual([
      'Fleet',
      'On road',
      'Standing',
      'Dark',
      'Operating depots',
    ]);
    expect(secondary.map((f) => f.label)).toEqual(['Reporting', 'Off road', 'Route assigned']);
    const words = [...primary, ...secondary].map((f) => f.label).join(' ');
    expect(words).not.toMatch(/No signal|Stationary|Maint/);
  });

  it('gives every second-row figure a caption of its own, so no free line is needed', () => {
    const { secondary } = kpiLayout(KPIS, []);
    secondary.forEach((figure) => expect(figure.note).toMatch(/of fleet/));
  });
});

describe('the week trend note', () => {
  it('names both measures in one sentence, with no MODELLED word inside it', () => {
    const note = weekTrendNote('steady over 7 days', 'up 1.2 percentage points over 7 days');
    expect(note).toBe(
      'On-road share steady over 7 days; dark rate up 1.2 percentage points over 7 days.',
    );
    expect(note).not.toMatch(/MODELLED/i);
  });

  it('says one measure alone, and nothing when neither has a trend', () => {
    expect(weekTrendNote(null, 'steady over 7 days')).toBe('Dark rate steady over 7 days.');
    expect(weekTrendNote('down 3 percentage points over 7 days', null)).toBe(
      'On-road share down 3 percentage points over 7 days.',
    );
    expect(weekTrendNote(null, null)).toBeNull();
  });
});

describe('the units table at 1440 and 800', () => {
  // Column sums against the frame: 1440 1,044 of 1,160; 1024 732 of 976; 800 452 of 752; 390 304 of 358.
  it.each([
    ['full', TABLE_FRAME_PX_1440, 1044],
    ['mid', TABLE_FRAME_PX_1024, 732],
    ['narrow', TABLE_FRAME_PX_800, 452],
    ['phone', TABLE_FRAME_PX_390, 304],
  ] as const)('fits the %s tier in its frame with INDEX always shown', (tier, frame, sum) => {
    const keys = tableColumnKeys(tier);
    expect(keys).toContain('index');
    expect(keys).not.toContain('kind');
    expect(tableWidthPx(keys)).toBe(sum);
    expect(sum).toBeLessThanOrEqual(frame);
  });

  it('uses the section 7 column sets', () => {
    expect(tableColumnKeys('mid')).toEqual(['name', 'fleet', 'onRoad', 'standing', 'dark', 'offRoad', 'mix', 'index']);
    expect(tableColumnKeys('narrow')).toEqual(['name', 'fleet', 'onRoad', 'dark', 'index']);
    expect(tableColumnKeys('phone')).toEqual(['name', 'fleet', 'index']);
  });

  it('shortens the headers, puts the unit in the header and draws the mix at 72 px plus padding', () => {
    expect(TABLE_COLUMN_SPEC.reporting).toMatchObject({ header: 'Report', unit: '%' });
    expect(TABLE_COLUMN_SPEC.assigned).toMatchObject({ header: 'Assign', unit: '%' });
    expect(TABLE_COLUMN_SPEC.mix.width).toBe(96);
    const headers = Object.values(TABLE_COLUMN_SPEC).map((spec) => spec.header);
    expect(headers).toEqual(expect.arrayContaining(['On road', 'Standing', 'Dark', 'Off road']));
    expect(headers.join(' ')).not.toMatch(/No signal|Stationary|Maint/);
  });

  it('says once what dark means, as the cockpit words it', () => {
    expect(DARK_HEADER_TITLE).toBe('Dark: no signal for 6 h or more');
  });
});

describe('a unit row in the classified states', () => {
  it('adds its four counts (in service folded into on road) up to its fleet', () => {
    const depot = {
      fleet: 40,
      states: { inService: 15, onRoad: 5, standing: 10, dark: 6, offRoad: 4 },
    } as unknown as DepotSummary;
    const counts = unitStateCounts(depot);
    expect(counts).toEqual({ onRoad: 20, standing: 10, dark: 6, offRoad: 4 });
    expect(counts.onRoad + counts.standing + counts.dark + counts.offRoad).toBe(depot.fleet);
  });
});
