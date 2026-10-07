import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_COLUMN_WIDTHS,
  coverageSentences,
  proposalColumnKeys,
  proposalRow,
  proposalTierFor,
  routeHourlyProvenance,
  serviceFigures,
} from '@/lib/depot/service/servicePageModel';
import { bandLabel, hourLabel, PROPOSAL_KIND_LABEL } from '@/lib/depot/service/serviceWording';
import { TABLE_FRAME_BORDER_PX, contentWidthAt } from '@/lib/depot/shell/geometry';
import { tableWidth } from '@/lib/depot/shell/tableWidth';
import { FIXTURE_PROPOSALS, routeHourlyFixture } from './depot-service-fixtures';

describe('service wording', () => {
  it('writes hours as HH:00 and a band from its first hour to the end of its last', () => {
    expect(hourLabel(7)).toBe('07:00');
    expect(bandLabel({ fromHour: 7, toHour: 10 })).toBe('07:00–11:00');
    expect(bandLabel({ fromHour: 23, toHour: 23 })).toBe('23:00–24:00');
  });

  it('names every proposal kind', () => {
    expect(Object.values(PROPOSAL_KIND_LABEL).every((label) => label.length > 0)).toBe(true);
  });
});

describe('service figures', () => {
  it('reads the current hour: deployed, needed, gap and samples', () => {
    const figures = serviceFigures(routeHourlyFixture());
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ['Deployed now', '10'],
      ['Need now', '8'],
      ['Gap now', '−2'],
      ['Samples', '79'],
    ]);
    expect(figures[1]?.tag).toBe('modelled');
    expect(figures[2]?.tone).toBe('better');
    expect(figures[3]?.caption).toBe('Observed since 05:02');
    expect(figures[0]?.caption).toBe('In service or on the road');
  });

  it('says what is missing without a feed clock or any observation', () => {
    const figures = serviceFigures(routeHourlyFixture({ currentHour: null, observed: null }));
    expect(figures[0]?.value).toBe('—');
    expect(figures[0]?.caption).toBe('No feed clock');
    expect(figures[3]).toMatchObject({ value: '0', caption: 'Not observed yet' });
  });
});

describe('coverage and provenance', () => {
  it('words the coverage sentences from the response', () => {
    expect(coverageSentences(routeHourlyFixture())).toEqual([
      'Observed by this server since 05:02 (79 samples).',
      'Only buses that report a route name are counted: 10 of the 14 buses in the feed report one.',
      '4 standing now carry this route’s name; they are not counted as deployed.',
      'Scheduled trips known for 12 of 40 buses seen on this route today.',
    ]);
    const one = coverageSentences(routeHourlyFixture({ standingNow: 1 }));
    expect(one).toContain('1 standing now carries this route’s name; it is not counted as deployed.');
    expect(coverageSentences(routeHourlyFixture({ standingNow: 0 }))).toHaveLength(3);
    expect(coverageSentences(routeHourlyFixture({ observed: null }))[0]).toBe(
      'Not yet observed by this server today.',
    );
  });

  it('is a MIXED line with live, derived and modelled parts and the coverage as its second', () => {
    const line = routeHourlyProvenance(routeHourlyFixture());
    expect(line.default).toBe('mixed');
    if (line.default !== 'mixed') return;
    expect(line.live).toBeTruthy();
    expect(line.derived).toBeTruthy();
    expect(line.modelled).toMatch(/demand/);
    // Most hours of a day not yet observed come from the modelled day: the line says so.
    expect(line.derived).toBe('observed and scheduled buses by hour');
    expect(line.modelled).toMatch(/^deployment in hours not observed, /);
    expect(line.second).toContain('Observed by this server since 05:02 (79 samples).');
  });
});

describe('proposal rows', () => {
  it('prints the change, source, impact and rests-on as short cell words', () => {
    const [add, hold, run] = FIXTURE_PROPOSALS.map(proposalRow);
    expect(add).toMatchObject({
      band: '07:00–11:00',
      change: 'Add 3',
      source: 'Alambagh · 6 standing',
      impact: '180–320',
      restsOn: 'B · Mixed',
      reason: FIXTURE_PROPOSALS[0]?.reason,
    });
    expect(hold).toMatchObject({ change: 'Hold 2', source: 'Alambagh · day plan', impact: '−20–0' });
    expect(run).toMatchObject({ change: 'Running time', source: '—', impact: '—', restsOn: 'A · Measured' });
    expect(run?.impactTitle).toMatch(/No modelled impact/);
    expect(run?.sourceTitle).toBe('No bus moves for this finding.');
  });

  it('says an add with no source has none identified, not that no bus moves', () => {
    const sourceless = proposalRow({ ...FIXTURE_PROPOSALS[0]!, source: null, tier: 'C' });
    expect(sourceless.source).toBe('—');
    expect(sourceless.sourceTitle).toBe('No source was identified for these buses.');
  });

  it('holds the impact ranges for the expanded row', () => {
    const add = proposalRow(FIXTURE_PROPOSALS[0]!);
    expect(add.impactLines).toEqual([
      'Passengers a day: 180 to 320',
      'Revenue a day: ₹9,400 to ₹16,800',
      'Bus-km a day: 420 to 510',
      'Cost a day: ₹15,100 to ₹18,300',
    ]);
  });
});

describe('proposals table width per tier', () => {
  it.each<[number, string]>([
    [1440, 'full'],
    [1280, 'wide'],
    [1024, 'wide'],
    [800, 'narrow'],
  ])('at %ipx the %s column set fits the frame', (viewport, tier) => {
    expect(proposalTierFor(viewport)).toBe(tier);
    const t = proposalTierFor(viewport);
    const width =
      tableWidth(PROPOSAL_COLUMN_WIDTHS, proposalColumnKeys(t), { expander: true }) +
      TABLE_FRAME_BORDER_PX;
    expect(width).toBeLessThanOrEqual(contentWidthAt(viewport));
  });

  it('gives the MODELLED headers the room a browser draws them in', () => {
    // Measured in a browser at 1440: "Needed MODELLED" 159px, "Impact pax MODELLED" 191px.
    expect(PROPOSAL_COLUMN_WIDTHS.needed).toBeGreaterThanOrEqual(160);
    expect(PROPOSAL_COLUMN_WIDTHS.impact).toBeGreaterThanOrEqual(192);
    expect(PROPOSAL_COLUMN_WIDTHS.band).toBeGreaterThanOrEqual(112);
    expect(PROPOSAL_COLUMN_WIDTHS.change).toBeGreaterThanOrEqual(128);
  });

  it('keeps every figure column from 1440 and always the band, change and rests-on', () => {
    expect(proposalColumnKeys('full')).toHaveLength(8);
    expect(proposalColumnKeys('full')).not.toContain('reason');
    for (const tier of ['full', 'wide', 'narrow'] as const) {
      expect(proposalColumnKeys(tier)).toEqual(
        expect.arrayContaining(['band', 'change', 'needed', 'impact', 'restsOn']),
      );
    }
  });
});
