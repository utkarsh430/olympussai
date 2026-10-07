import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_COLUMN_WIDTHS,
  orderProposals,
  proposalColumnKeys,
  proposalGroup,
  proposalRow,
  proposalTierFor,
  serviceFigures,
} from '@/lib/depot/service/servicePageModel';
import {
  chartNote,
  coverageSentences,
  routeHourlyProvenance,
  scheduledLegendText,
} from '@/lib/depot/service/serviceCoverage';
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
  it('puts the route-name share and the standing buses in the closing disclosure', () => {
    expect(coverageSentences(routeHourlyFixture())).toEqual([
      'Only buses that report a route name are counted: 10 of the 14 buses in the feed report one.',
      '4 standing now carry this route’s name; they are not counted as deployed.',
    ]);
    const one = coverageSentences(routeHourlyFixture({ standingNow: 1 }));
    expect(one).toContain('1 standing now carries this route’s name; it is not counted as deployed.');
    expect(coverageSentences(routeHourlyFixture({ standingNow: 0 }))).toHaveLength(1);
  });

  it('says what the server observed in the chart section’s note, with the operating day', () => {
    expect(chartNote(routeHourlyFixture())).toBe(
      'Operating day 6 Oct 2026 · Observed by this server since 05:02 (79 samples)',
    );
    expect(chartNote(routeHourlyFixture({ observed: null }))).toBe(
      'Operating day 6 Oct 2026 · Not yet observed by this server today',
    );
  });

  it('names the scheduled coverage on the Scheduled legend entry, one bus in the singular', () => {
    expect(scheduledLegendText(routeHourlyFixture().scheduledCoverage)).toBe(
      'Scheduled (trips known for 12 of 40 buses)',
    );
    expect(scheduledLegendText({ n: 1, of: 1 })).toBe('Scheduled (trips known for 1 of 1 bus)');
    expect(coverageSentences(routeHourlyFixture({ routeCoverage: { n: 1, of: 1 } }))).toContain(
      'Only buses that report a route name are counted: 1 of the 1 bus in the feed reports one.',
    );
  });

  it('is one short MIXED sentence with no second sentence', () => {
    const line = routeHourlyProvenance(routeHourlyFixture());
    expect(line.default).toBe('mixed');
    if (line.default !== 'mixed') return;
    expect(line).toEqual({
      default: 'mixed',
      live: 'Buses now',
      derived: 'observed hours and scheduled trips',
      modelled: 'other hours, demand, need and proposals',
    });
    expect(line.second).toBeUndefined();
  });

  it('never names observed hours when the server has observed none', () => {
    const line = routeHourlyProvenance(routeHourlyFixture({ observed: null }));
    if (line.default !== 'mixed') throw new Error('mixed');
    expect(line.derived).toBe('scheduled trips');
    expect(line.modelled).toBe('deployment by hour, demand, need and proposals');
    expect(routeHourlyProvenance(null)).toMatchObject({ derived: 'observed hours and scheduled trips' });
  });
});

describe('proposal rows', () => {
  it('prints the change, source, impact and rests-on as short cell words', () => {
    const [add, hold, run] = FIXTURE_PROPOSALS.map(proposalRow);
    expect(add).toMatchObject({
      band: '07:00–11:00',
      change: 'Add 3',
      source: 'Alambagh',
      impact: '180–320 pax',
      restsOn: 'B · Mixed',
      reason: FIXTURE_PROPOSALS[0]?.reason,
    });
    expect(hold).toMatchObject({ change: 'Hold 2', source: 'Alambagh', impact: '270–330 km saved' });
    expect(run).toMatchObject({ change: 'Running time', source: '—', impact: '—', restsOn: 'A · Measured' });
    expect(run?.impactTitle).toMatch(/No modelled impact/);
    expect(run?.sourceTitle).toBe('No bus moves for this finding.');
  });

  it('names only the depot in the source cell, so a long name fits; what it offers is in the title', () => {
    const [add, hold] = FIXTURE_PROPOSALS.map(proposalRow);
    expect(add?.sourceTitle).toBe(
      'Alambagh: 6 buses standing in its yard in the hour before the band, as observed.',
    );
    expect(hold?.sourceTitle).toBe('Alambagh: idle buses in the modelled day plan.');
    const long = { ...FIXTURE_PROPOSALS[0]!.source!, depotName: 'VINDHYANAGAR' };
    expect(proposalRow({ ...FIXTURE_PROPOSALS[0]!, source: long }).source).toBe('VINDHYANAGAR');
  });

  it('shows the bus-km a hold saves, never its zero passengers, and all four ranges either way', () => {
    const hold = proposalRow(FIXTURE_PROPOSALS[1]!);
    expect(hold.impact).not.toMatch(/pax/);
    expect(hold.impactLines).toEqual([
      'Passengers a day: 0 to 0',
      'Revenue a day: ₹0 to ₹0',
      'Bus-km a day: −330 to −270',
      'Cost a day: −₹11,800 to −₹9,600',
    ]);
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

describe('proposal groups', () => {
  it('puts the changes first and the timetable findings after, each by start hour', () => {
    const late = { ...FIXTURE_PROPOSALS[0]!, id: 'p-late', band: { fromHour: 17, toHour: 19 } };
    const early = { ...FIXTURE_PROPOSALS[2]!, id: 'p-early', band: { fromHour: 4, toHour: 5 } };
    const ordered = orderProposals([FIXTURE_PROPOSALS[2]!, late, FIXTURE_PROPOSALS[1]!, early, FIXTURE_PROPOSALS[0]!]);
    expect(ordered.map((p) => p.id)).toEqual(['p-add-07-10', 'p-hold-12-14', 'p-late', 'p-early', 'p-run-07-09']);
    expect(ordered.map(proposalGroup)).toEqual([
      'Changes',
      'Changes',
      'Changes',
      'Timetable findings',
      'Timetable findings',
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
    // Measured in a browser at 1440: "Needed MODELLED" 159px; the impact cell's longest
    // words ("1,200–2,000 km saved") need its 192px.
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
