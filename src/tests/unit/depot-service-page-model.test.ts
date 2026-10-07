import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_COLUMN_WIDTHS,
  hasPastBand,
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
import { bandLabel, hourLabel, PROPOSAL_KIND_LABEL, SERVICE_TEXT, TIER_CELL } from '@/lib/depot/service/serviceWording';
import { PUNCTUALITY_COLUMN_KEYS, PUNCTUALITY_COLUMN_WIDTHS } from '@/lib/depot/service/punctualityModel';
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
  it('reads the current hour and the day: deployed, needed, the gap now as the lead, hours short', () => {
    const figures = serviceFigures(routeHourlyFixture());
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ['Deployed now', '10'],
      ['Needed now', '8'],
      ['Gap now', '−2'],
      ['Hours short', '8'],
    ]);
    expect(figures[1]?.tag).toBe('modelled');
    // Over is amber, the standing meaning: surplus buses are buses that could stand.
    expect(figures[2]).toMatchObject({ tone: 'standing', lead: true, caption: 'Over by 2' });
    expect(figures[3]).toMatchObject({ caption: 'Peak +5 at 17:00', tag: 'modelled' });
    expect(figures[0]?.caption).toBe('In service or on the road');
  });

  it('says what is missing without a feed clock, and when no hour is short', () => {
    const figures = serviceFigures(routeHourlyFixture({ currentHour: null, observed: null }));
    expect(figures[0]?.value).toBe('—');
    expect(figures[0]?.caption).toBe('No feed clock');
    const even = routeHourlyFixture();
    const none = serviceFigures({ ...even, hours: even.hours.map((h) => ({ ...h, gap: 0 })) });
    expect(none[3]).toMatchObject({ value: '0', caption: 'No hour short' });
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
    const [add, hold, run] = FIXTURE_PROPOSALS.map((p) => proposalRow(p));
    expect(add).toMatchObject({
      band: '07:00–11:00',
      change: 'Add 3',
      source: 'Alambagh',
      impact: '180–320 passengers',
      restsOn: 'Mixed',
      reason: FIXTURE_PROPOSALS[0]?.reason,
    });
    expect(hold).toMatchObject({ change: 'Hold 2', source: 'Alambagh', impact: '270–330 km saved' });
    expect(run).toMatchObject({ change: 'Running time', source: '—', impact: '—', restsOn: 'Derived' });
    expect(run?.impactTitle).toMatch(/No modelled impact/);
    expect(run?.sourceTitle).toBe('No bus moves for this finding.');
  });

  it('names only the depot in the source cell, so a long name fits; what it offers is in the title', () => {
    const [add, hold] = FIXTURE_PROPOSALS.map((p) => proposalRow(p));
    expect(add?.sourceTitle).toBe(
      'Alambagh: 6 buses standing in its yard in the hour before the band, as observed.',
    );
    expect(hold?.sourceTitle).toBe('Alambagh: idle buses in the modelled day plan.');
    const long = { ...FIXTURE_PROPOSALS[0]!.source!, depotName: 'VINDHYANAGAR' };
    expect(proposalRow({ ...FIXTURE_PROPOSALS[0]!, source: long }).source).toBe('VINDHYANAGAR');
  });

  it('shows the bus-km a hold saves, never its zero passengers, and all four ranges either way', () => {
    const hold = proposalRow(FIXTURE_PROPOSALS[1]!);
    expect(hold.impact).not.toMatch(/pax|passengers/);
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

describe('the change as a range', () => {
  const hours = routeHourlyFixture().hours.map((h) =>
    h.hour >= 7 && h.hour <= 10 ? { ...h, gap: [4, 19, 12, 9][h.hour - 7]! } : h,
  );

  it('shows an add as the range of its hourly gaps, the peak hour in the title and the row', () => {
    const add = proposalRow(FIXTURE_PROPOSALS[0]!, hours);
    expect(add.change).toBe('Add 4 to 19');
    expect(add.changeTitle).toBe('Add 4 to 19 buses; peak +19 at 08:00');
    expect(add.peak).toBe('Short by 4 to 19 across the band, most at 08:00 (+19).');
  });

  it('shows one figure when every hour of the band has the same gap, or no hours are given', () => {
    const even = routeHourlyFixture().hours.map((h) => (h.hour >= 7 && h.hour <= 10 ? { ...h, gap: 3 } : h));
    expect(proposalRow(FIXTURE_PROPOSALS[0]!, even)).toMatchObject({ change: 'Add 3', peak: null });
    expect(proposalRow(FIXTURE_PROPOSALS[0]!)).toMatchObject({ change: 'Add 3', peak: null });
  });

  it('keeps a hold and a finding as one figure', () => {
    expect(proposalRow(FIXTURE_PROPOSALS[1]!, hours).change).toBe('Hold 2');
    expect(proposalRow(FIXTURE_PROPOSALS[2]!, hours).change).toBe('Running time');
  });

  it('says a band already past is a note for the next day’s plan', () => {
    expect(hasPastBand(FIXTURE_PROPOSALS, 11)).toBe(true);
    expect(hasPastBand(FIXTURE_PROPOSALS, 7)).toBe(false);
    expect(hasPastBand(FIXTURE_PROPOSALS, null)).toBe(false);
    expect(SERVICE_TEXT.pastBands).toBe('Bands already past are notes for the next day’s plan.');
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
  const VIEWPORTS = [390, 640, 799, 800, 1023, 1024, 1279, 1280, 1439, 1440] as const;

  it.each([...VIEWPORTS])('at %ipx the chosen column set fits the frame', (viewport) => {
    const width =
      tableWidth(PROPOSAL_COLUMN_WIDTHS, proposalColumnKeys(proposalTierFor(viewport)), { expander: true }) +
      TABLE_FRAME_BORDER_PX;
    expect(width).toBeLessThanOrEqual(contentWidthAt(viewport));
  });

  it.each<[number, string]>([
    [1440, 'full'],
    [1280, 'wide'],
    [1024, 'wide'],
    [800, 'narrow'],
    [640, 'phone'],
    [390, 'phone'],
  ])('at %ipx shows the %s set', (viewport, tier) => {
    expect(proposalTierFor(viewport)).toBe(tier);
  });

  it('shows the band, the change and what it rests on alone on a phone; the rest is in the expanded row', () => {
    expect(proposalColumnKeys('phone')).toEqual(['band', 'change', 'restsOn']);
  });

  it('gives the headers the room a browser draws them in', () => {
    // "Needed mean MODELLED" and "Scheduled mean" carry the unit; rests-on is one word.
    expect(PROPOSAL_COLUMN_WIDTHS.needed).toBeGreaterThanOrEqual(200);
    expect(PROPOSAL_COLUMN_WIDTHS.deployed).toBeGreaterThanOrEqual(128);
    expect(PROPOSAL_COLUMN_WIDTHS.scheduled).toBeGreaterThanOrEqual(136);
    expect(PROPOSAL_COLUMN_WIDTHS.band).toBeGreaterThanOrEqual(112);
    expect(PROPOSAL_COLUMN_WIDTHS.change).toBeGreaterThanOrEqual(128);
    expect(Object.values(TIER_CELL).every((word) => !word.includes(' '))).toBe(true);
  });

  it('keeps every figure column from 1440 and always the band, change and rests-on', () => {
    expect(proposalColumnKeys('full')).toHaveLength(8);
    for (const tier of ['full', 'wide', 'narrow', 'phone'] as const) {
      expect(proposalColumnKeys(tier)).toEqual(expect.arrayContaining(['band', 'change', 'restsOn']));
    }
  });
});

describe('punctuality table width', () => {
  it.each([390, 640, 1024, 1440])('at %ipx fits the frame', (viewport) => {
    const width = tableWidth(PUNCTUALITY_COLUMN_WIDTHS, PUNCTUALITY_COLUMN_KEYS) + TABLE_FRAME_BORDER_PX;
    expect(width).toBeLessThanOrEqual(contentWidthAt(viewport));
  });
});
