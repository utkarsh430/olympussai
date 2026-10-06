import { describe, it, expect } from 'vitest';
import {
  NEXT_SERVICE_HEADER,
  SERVICE_HEADER,
  distanceNotice,
  groupSummary,
  intervalText,
  kmToNextCell,
  kmToNextText,
  preventiveGuard,
  noAttentionText,
  offRoadEmptyText,
  offRoadHeadline,
  preventiveNote,
  serviceGroupLabel,
  silenceText,
  statusWordLabel,
  workshopSentence,
} from '@/lib/depot/maintenance/text';
import * as pageModelModule from '@/lib/depot/maintenance/pageModel';
import * as textModule from '@/lib/depot/maintenance/text';
import { workshopLoad } from '@/lib/depot/maintenance/workshop';

describe('off-road sentences', () => {
  it('states the live count with the right number', () => {
    expect(offRoadHeadline(1)).toBe('1 bus is off the road now.');
    expect(offRoadHeadline(3)).toBe('3 buses are off the road now.');
  });

  it('says in one sentence why the list is empty', () => {
    expect(offRoadEmptyText()).toBe(
      'The live feed reports no bus under maintenance at this depot.',
    );
  });

  it('uses the feed vocabulary for the status word', () => {
    expect(statusWordLabel('under_maintenance')).toBe('Under maintenance');
    expect(statusWordLabel('no_signal')).toBe('No signal');
    expect(statusWordLabel('unknown')).toBe('Unknown');
  });

  it('describes silence in words, and says so when it is not known', () => {
    expect(silenceText(30)).toBe('30 min ago');
    expect(silenceText(300)).toBe('5 h ago');
    expect(silenceText(null)).toBe('unknown');
  });
});

describe('distance notice', () => {
  it('says the feed distance is unused, why, and how many buses carry it', () => {
    expect(distanceNotice({ n: 31, of: 70 })).toBe(
      "The feed's distance field is not used on this page because its unit is unconfirmed, " +
        'and only 31 of 70 buses at this depot carry it.',
    );
  });

  it('never prints a distance unit for the feed field', () => {
    expect(distanceNotice({ n: 0, of: 0 })).not.toMatch(/\bkm\b|kilomet|metres/i);
  });
});

describe('preventive sentences', () => {
  it('names the groups in words', () => {
    expect(serviceGroupLabel('overdue')).toBe('Overdue');
    expect(serviceGroupLabel('due_soon')).toBe('Due soon');
    expect(serviceGroupLabel('not_due')).toBe('Not due');
  });

  it('puts only the number in the distance cell, with a minus sign past the service', () => {
    expect(kmToNextCell(-3400)).toBe('\u22123,400');
    expect(kmToNextCell(0)).toBe('0');
    expect(kmToNextCell(9000)).toBe('9,000');
  });

  it('says in one sentence that the statuses are generated, not workshop records', () => {
    expect(preventiveGuard()).toContain('generated from a model of service history');
    expect(preventiveGuard()).toContain('not workshop records');
  });

  it('words the distance to the next service for the cell title, overdue or not', () => {
    expect(kmToNextText(-3400)).toBe('Modelled: overdue by 3,400 km');
    expect(kmToNextText(0)).toBe('Modelled: due now');
    expect(kmToNextText(800, 1500)).toBe('Modelled: due soon, 800 km to next service');
    expect(kmToNextText(9000, 1500)).toBe('Modelled: 9,000 km to next service');
  });

  it('summarises the groups against the depot fleet', () => {
    expect(groupSummary({ overdue: 6, due_soon: 9, not_due: 55 })).toBe(
      'Modelled, not workshop records: of 70 buses, 6 are modelled as overdue, ' +
        '9 as due soon and 55 as not due.',
    );
    expect(groupSummary({ overdue: 0, due_soon: 0, not_due: 0 })).toBe('The depot has no buses.');
  });

  it('says in one sentence when no bus needs a service', () => {
    expect(noAttentionText()).toBe(
      'No bus is overdue or due soon on the modelled service history.',
    );
  });

  it('states what is modelled and what due soon means', () => {
    const note = preventiveNote(1500);
    expect(note).toContain('modelled');
    expect(note).toContain('1,500 km');
    expect(note).toContain("share of buses modelled as overdue is set by the model's assumptions");
    expect(note).toContain('not derived from any record');
    expect(note).toContain('does not advance with the date');
    expect(note).toContain('follow its current route, so re-routing a bus can change its group');
    expect(note).toContain('not for planning services');
    expect(note.toLowerCase()).not.toContain('simulated');
  });

  it('prints a service interval per class', () => {
    expect(intervalText('ordinary', 10000)).toBe('Ordinary: every 10,000 km');
    expect(intervalText('ac', 8000)).toBe('AC: every 8,000 km');
  });
});

describe('column headers', () => {
  it('tag the modelled columns', () => {
    expect(SERVICE_HEADER).toBe('Status (MODELLED)');
    expect(NEXT_SERVICE_HEADER).toBe('To next service, km (MODELLED)');
  });
});

describe('no sentence reads as a fact about a real bus', () => {
  /*
   * The guard, in two parts. (1) Every SENTENCE the module produces that says
   * overdue or due soon also says modelled: found by calling every export of the
   * wording and page-model modules, so a new export is covered without being listed.
   * (2) The status WORD in a cell ("Overdue") is not a sentence; the surfaces that show
   * it carry the tag instead (headers, section, band figures), asserted in
   * depot-maintenance-page.test.tsx and the band test below.
   */
  const CELL_WORDS: ReadonlySet<string> = new Set(['serviceGroupLabel']);
  const PROBES: readonly unknown[][] = [
    [-3400, 1500],
    [0, 1500],
    [800, 1500],
    [9000, 1500],
    [1500],
    [{ n: 31, of: 70 }],
    [{ overdue: 22, due_soon: 10, not_due: 208 }],
    [{ overdue: 1, due_soon: 0, not_due: 0 }],
    [{ overdue: 0, due_soon: 0, not_due: 0 }],
    [workshopLoad(7, 4)],
    [workshopLoad(0, 4)],
    ['overdue'],
    ['due_soon'],
    ['under_maintenance'],
    [30],
    [3, { counts: { overdue: 22, due_soon: 10, not_due: 208 }, dueSoonWithinKm: 1500 }],
    [[]],
    [
      [
        { registrationNumber: 'A', vehicleStatus: 'under_maintenance', tripStatus: null, gpsAgeMin: 5, flags: [] },
        { registrationNumber: 'B', vehicleStatus: 'under_maintenance', tripStatus: 'Stationary', gpsAgeMin: 5, flags: ['x'] },
      ],
    ],
    ['2026-10-06T10:00:00Z', 30],
    [
      { counts: { overdue: 22, due_soon: 10, not_due: 208 }, dueSoonWithinKm: 1500, intervals: ['Ordinary: every 10,000 km'] },
      { n: 31, of: 70 },
    ],
    ['ordinary', 10000],
    [],
  ];

  function stringsOf(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(stringsOf);
    if (value !== null && typeof value === 'object') {
      // A figure or row that carries the MODELLED tag is tagged where it is shown.
      if ((value as { tag?: unknown }).tag === 'modelled') return [];
      return Object.values(value).flatMap(stringsOf);
    }
    return [];
  }

  const modules: Record<string, Record<string, unknown>> = {
    text: textModule,
    pageModel: pageModelModule,
  };

  it('never lets a sentence say overdue or due soon without saying modelled', () => {
    let sentences = 0;
    for (const [name, mod] of Object.entries(modules)) {
      for (const [key, value] of Object.entries(mod)) {
        if (CELL_WORDS.has(key)) continue;
        const produced: string[] = [];
        if (typeof value === 'function') {
          for (const args of PROBES) {
            try {
              produced.push(...stringsOf((value as (...a: unknown[]) => unknown)(...args)));
            } catch {
              /* wrong shape of argument for this function: another probe fits it */
            }
          }
        } else produced.push(...stringsOf(value));
        for (const text of produced) {
          sentences += 1;
          if (/overdue|due soon/i.test(text)) {
            expect(text.toLowerCase(), `${name}.${key}: ${text}`).toContain('modelled');
          }
        }
      }
    }
    expect(sentences).toBeGreaterThan(40);
  });

  it('reaches every exported function with at least one probe', () => {
    for (const [name, mod] of Object.entries(modules)) {
      for (const [key, value] of Object.entries(mod)) {
        if (typeof value !== 'function') continue;
        const reached = PROBES.some((args) => {
          try {
            return stringsOf((value as (...a: unknown[]) => unknown)(...args)).length > 0;
          } catch {
            return false;
          }
        });
        expect(reached, `${name}.${key} is not reached by any probe; add one`).toBe(true);
      }
    }
  });
});

describe('workshopSentence', () => {
  it('says all bays are free when nothing is off the road', () => {
    expect(workshopSentence(workshopLoad(0, 4))).toBe(
      'No bus is off the road, so all 4 modelled bays are free.',
    );
  });

  it('says how many bays are free when the buses fit', () => {
    expect(workshopSentence(workshopLoad(3, 4))).toBe(
      '3 buses off the road fit in 4 modelled bays; 1 bay is free.',
    );
  });

  it('states the queue in words when the buses exceed the bays', () => {
    expect(workshopSentence(workshopLoad(7, 4))).toBe(
      '7 buses off the road against 4 modelled bays: 3 would wait for a bay.',
    );
    expect(workshopSentence(workshopLoad(5, 4))).toContain('1 would wait for a bay');
  });

  it('copes with a depot that has no modelled bay', () => {
    expect(workshopSentence(workshopLoad(2, 0))).toBe(
      'The depot has no modelled workshop bay, so 2 buses off the road would wait.',
    );
  });
});
