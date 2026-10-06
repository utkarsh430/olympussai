import { describe, expect, it } from 'vitest';
import * as pageModelModule from '@/lib/depot/maintenance/pageModel';
import * as preventiveViewModule from '@/lib/depot/maintenance/preventiveView';
import * as textModule from '@/lib/depot/maintenance/text';
import { workshopLoad } from '@/lib/depot/maintenance/workshop';

/*
 * The rule (S51, X10): every sentence the maintenance module can produce that says
 * overdue, due soon or due now also says modelled. The walk calls every exported
 * function with arguments chosen so that EACH branch that builds such a sentence runs
 * (the overdue branch, the due-soon branch, the due-now wording, the none branch); it
 * fails if an export has no probe entry, and, for every export whose source names a
 * phrase, if no probe produced a string with that phrase (so a branch the probes miss
 * cannot pass by being "reached" through its harmless sibling).
 */

const COUNTS = { overdue: 22, due_soon: 10, not_due: 208 };
const NONE = { overdue: 0, due_soon: 0, not_due: 0 };
const PREVENTIVE = { counts: COUNTS, dueSoonWithinKm: 1500 };
const OFF_ROAD = {
  registrationNumber: 'A',
  vehicleStatus: 'under_maintenance',
  tripStatus: null,
  gpsAgeMin: 5,
  flags: [],
};
const BUS = (group: string, km: number): Record<string, unknown> => ({
  registrationNumber: `UP${km}`,
  group,
  kmToNextService: km,
  serviceClass: 'ordinary',
  odometerKm: 1000,
  ageYears: 3,
});

/** Arguments per export, each set chosen to take a different branch. */
const PROBES: Readonly<Record<string, readonly (readonly unknown[])[]>> = {
  offRoadHeadline: [[1], [3]],
  offRoadEmptyText: [[]],
  statusWordLabel: [['under_maintenance'], ['no_signal'], ['unknown']],
  silenceText: [[null], [30]],
  distanceNotice: [[{ n: 31, of: 70 }]],
  groupRowLabel: [
    ['overdue', 18],
    ['due_soon', 28],
    ['not_due', 5],
  ],
  preventiveCaption: [[]],
  preventiveGuard: [[]],
  kmToNextCell: [[-3400], [0], [800]],
  kmToNextText: [[-3400, 1500], [0, 1500], [800, 1500], [9000, 1500], [1500]],
  groupSummary: [[COUNTS], [NONE], [{ overdue: 1, due_soon: 0, not_due: 0 }]],
  noAttentionText: [[]],
  preventiveNote: [[1500]],
  serviceClassLabel: [['ordinary'], ['ac']],
  intervalText: [['ordinary', 10000]],
  workshopSentence: [
    [workshopLoad(7, 4)],
    [workshopLoad(3, 4)],
    [workshopLoad(0, 4)],
    [workshopLoad(2, 0)],
  ],
  workshopBaysNote: [[]],
  bandFigures: [
    [3, PREVENTIVE],
    [0, null],
    [1, { counts: NONE, dueSoonWithinKm: 1500 }],
  ],
  sharedOffRoad: [[[]], [[OFF_ROAD, { ...OFF_ROAD, tripStatus: 'Stationary', flags: ['x'] }]]],
  lastHeardIso: [
    ['2026-10-06T10:00:00Z', 30],
    [null, 30],
  ],
  workshopRows: [[workshopLoad(7, 4)]],
  disclosureItems: [
    [
      { ...PREVENTIVE, intervals: ['Ordinary: every 10,000 km'] },
      { n: 31, of: 70 },
    ],
  ],
  preventiveView: [
    [[BUS('overdue', -3400), BUS('due_soon', 800), BUS('not_due', 9000)], new Set()],
    [Array.from({ length: 9 }, (_, i) => BUS('overdue', -i - 1)), new Set(['overdue'])],
  ],
};

const MODULES: Readonly<Record<string, Record<string, unknown>>> = {
  text: textModule,
  pageModel: pageModelModule,
  preventiveView: preventiveViewModule,
};

const PHRASES: readonly RegExp[] = [/overdue/i, /due soon/i, /due now/i];

/**
 * Every string in a value; `checked` leaves out a data row's `group` identifier and a
 * tagged figure's `label` and `key` (identifiers and a label, not sentences: the figure's
 * tag carries MODELLED where it is shown).
 */
function stringsOf(value: unknown, checked: boolean): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringsOf(item, checked));
  if (value !== null && typeof value === 'object') {
    const tagged = (value as { tag?: unknown }).tag === 'modelled';
    return Object.entries(value)
      .filter(
        ([key]) =>
          !(
            checked &&
            (key === 'group' ||
              key === 'cappable' ||
              (tagged && (key === 'label' || key === 'key')))
          ),
      )
      .flatMap(([, inner]) => stringsOf(inner, checked));
  }
  return [];
}

function produce(fn: unknown, checked: boolean): string[] {
  const key = Object.entries(MODULES)
    .flatMap(([, mod]) => Object.entries(mod))
    .find(([, value]) => value === fn)?.[0];
  const probes = key === undefined ? [] : (PROBES[key] ?? []);
  return probes.flatMap((args) =>
    stringsOf((fn as (...a: unknown[]) => unknown)(...args), checked),
  );
}

const functions = Object.entries(MODULES).flatMap(([moduleName, mod]) =>
  Object.entries(mod)
    .filter(([, value]) => typeof value === 'function')
    .map(([key, value]) => ({ name: `${moduleName}.${key}`, key, fn: value })),
);

describe('every sentence that says overdue, due soon or due now also says modelled', () => {
  it('has a probe entry for every exported function, so a new export cannot slip past', () => {
    for (const { name, key } of functions) {
      expect(
        PROBES[key],
        `${name} has no PROBES entry; add arguments that take each branch`,
      ).toBeDefined();
    }
    for (const key of Object.keys(PROBES)) {
      expect(
        functions.some((f) => f.key === key),
        `PROBES.${key} names no export`,
      ).toBe(true);
    }
  });

  it('makes every produced sentence with those words say modelled', () => {
    let seen = 0;
    for (const { name, fn } of functions) {
      for (const text of produce(fn, true)) {
        if (!PHRASES.some((phrase) => phrase.test(text))) continue;
        seen += 1;
        expect(text.toLowerCase(), `${name}: ${text}`).toContain('modelled');
      }
    }
    expect(seen).toBeGreaterThan(12);
  });

  it('reaches, for every export whose source names a phrase, a string with that phrase', () => {
    for (const { name, fn } of functions) {
      const source = String(fn);
      const produced = produce(fn, false);
      for (const phrase of PHRASES) {
        if (!phrase.test(source)) continue;
        expect(
          produced.some((text) => phrase.test(text)),
          `${name} names ${phrase} but no probe produces it: add arguments for that branch`,
        ).toBe(true);
      }
    }
  });

  it('walks the overdue, due-soon, due-now and none branches of the distance wording', () => {
    const titles = [
      textModule.kmToNextText(-3400, 1500),
      textModule.kmToNextText(0, 1500),
      textModule.kmToNextText(800, 1500),
      textModule.kmToNextText(9000, 1500),
    ];
    expect(titles[0]).toMatch(/overdue/);
    expect(titles[1]).toMatch(/due now/);
    expect(titles[2]).toMatch(/due soon/);
    expect(titles[3]).not.toMatch(/overdue|due soon|due now/);
    for (const title of titles) expect(title).toMatch(/^Modelled/);
  });

  it('includes the table caption and the group-row wording', () => {
    expect(textModule.preventiveCaption().toLowerCase()).toContain('modelled');
    expect(textModule.groupRowLabel('overdue', 1)).toMatch(/^Modelled overdue/);
    expect(textModule.groupRowLabel('due_soon', 1)).toMatch(/^Modelled due soon/);
  });
});
