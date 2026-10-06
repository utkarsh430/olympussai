import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotCrewPage from '@/app/(protected)/project/depots/d/[depotId]/crew/page';
import * as crewModel from '@/lib/depot/crew/crewPageModel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';

const hooks = vi.hoisted(() => ({ crew: null as unknown }));

vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => ({
    depotId: '20',
    data: { outshed: { coverage: { n: 5, of: 200 } } },
  }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { source: 'live', stale: false, feedNow: '2026-10-06T10:00:00Z' },
    error: null,
  }),
}));
vi.mock('@/hooks/useDepotCrew', () => ({ useDepotCrew: (): unknown => hooks.crew }));

const SUMMARY = {
  shiftsRequired: 2,
  shiftsCovered: 1,
  shiftsUncovered: 1,
  driver: { required: 2, available: 2 },
  conductor: { required: 2, available: 1 },
  dutiesFullyCovered: 1,
  dutiesPartlyCovered: 1,
  dutiesUncovered: 0,
  dutiesNeedingRelief: 0,
};
const COUNTS = { available: 3, weekly_off: 1, leave: 1, training: 0, absent: 0 };
const DATA = {
  depotId: '20',
  operatingDate: '2026-10-06',
  feedNow: '2026-10-06T10:00:00Z',
  stale: false,
  day: { duties: 2, routes: 1 },
  summary: SUMMARY,
  availability: { driver: COUNTS, conductor: COUNTS },
  uncovered: [
    {
      dutyId: 'D-1',
      shiftIndex: 0,
      shiftCount: 1,
      route: 'R1',
      startMin: 400,
      endMin: 700,
      shortRoles: ['conductor'],
      shortfalls: [{ role: 'conductor', cause: 'all_rostered' }],
    },
  ],
  uncoveredTotal: 1,
  roster: [],
  rosterTotal: 0,
  rosterCap: 200,
  limits: { dailyHours: 10, weeklyHours: 48 },
};
const EMPTY = {
  ...DATA,
  day: { duties: 0, routes: 0 },
  summary: { ...SUMMARY, shiftsRequired: 0 },
  uncovered: [],
};

const STATES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['loading', { loading: true }],
  ['error', { error: 'Depot data unavailable' }],
  ['not found', { error: DEPOT_NOT_FOUND_MESSAGE }],
  ['empty', { data: EMPTY }],
  ['data', { data: DATA }],
];

function setHook(partial: Record<string, unknown>): void {
  hooks.crew = { data: null, error: null, loading: false, refresh: () => {}, ...partial };
}

async function renderPage(): Promise<HTMLElement> {
  const element = await DepotCrewPage({ params: Promise.resolve({ depotId: '20' }) });
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(element);
  return page;
}

describe('the crew page header', () => {
  beforeEach(() => setHook({}));

  it.each(STATES)(
    'pins the MODELLED provenance line and the people sentence in the %s state',
    async (_n, partial) => {
      setHook(partial);
      const page = await renderPage();
      const line = page.querySelector('[data-testid="depot-provenance-line"]');
      expect(line?.getAttribute('data-tone')).toBe('modelled');
      expect(line?.querySelector('.depot-tag')?.textContent).toBe('MODELLED');
      expect(line?.textContent).toContain('Generated from planning assumptions, not measured.');
      const people = page.querySelector('[data-testid="crew-people-sentence"]');
      expect(people?.textContent).toBe(crewModel.PEOPLE_SENTENCE);
      // directly after the provenance line's header, 8px under it (header 24px, pulled up 16px)
      expect(people?.className).toContain('-mt-4');
      expect(line?.closest('header')?.nextElementSibling).toBe(people);
    },
  );

  it('puts the dated modelled-day sentence, with the schedule coverage, in the provenance line', async () => {
    setHook({ data: DATA });
    const page = await renderPage();
    const context = page.querySelector('[data-testid="depot-provenance-context"]');
    expect(context?.textContent).toBe(
      "The live feed carries a schedule for 5 of 200 of this depot's buses at the feed time. " +
        'This page is built on the modelled day for 2026-10-06, rebuilt from the live fleet as of ' +
        'the feed time: 2 duties on 1 route.',
    );
    expect(page.querySelector('[data-testid="crew-modelled-day"]')).toBeNull();
  });

  it('says "today" and "ran" nowhere on the page in any state', async () => {
    for (const [, partial] of STATES) {
      setHook(partial);
      expect((await renderPage()).textContent).not.toMatch(/\btoday\b|\bran\b|did not run/i);
    }
  });
});

describe('a slot is only its id and role', () => {
  const ROSTER_ROW = {
    dutyId: 'D-1',
    shiftIndex: 0,
    shiftCount: 1,
    route: 'R1',
    startMin: 400,
    endMin: 700,
    driverSlot: 'D-001',
    conductorSlot: 'C-001',
  };
  /** Words that would rank, score, compare or flag a slot (whole words). */
  const SLOT_JUDGEMENTS =
    /\b(score|scored|rank|ranked|rating|best|worst|top|busiest|least|most|overtime|workload|utili[sz]ation|performance|late|absent rate|flag|flagged|fatigue|tenure|name)\b/i;

  it('shows a roster row as shift, route, times and two slot ids, and no judgement of a slot', async () => {
    setHook({ data: { ...DATA, roster: [ROSTER_ROW], rosterTotal: 1 } });
    const page = await renderPage();
    const roster = page.querySelector('section[aria-labelledby="depot-crew-roster-heading"]');
    const headers = [...(roster?.querySelectorAll('th') ?? [])].map((th) => th.textContent);
    expect(headers).toEqual(['Shift', 'Route', 'Start', 'End', 'Driver slot', 'Conductor slot']);
    expect(roster?.textContent).toContain('D-001');
    expect(roster?.textContent).toContain('C-001');
    expect(roster?.textContent).not.toMatch(SLOT_JUDGEMENTS);
  });

  it('holds no judgement of a slot in any string of the page in any state', async () => {
    for (const [, partial] of STATES) {
      setHook(partial);
      const text = (await renderPage()).textContent ?? '';
      // "Most pressing first" orders shifts, never slots; it is the one allowed phrase
      expect(text.replace(/most pressing first/gi, '')).not.toMatch(SLOT_JUDGEMENTS);
    }
  });
});

describe('crew C, a unit with no duties', () => {
  it('is one state panel: a dated sentence, a muted line of what would change it, a link', async () => {
    setHook({ data: EMPTY });
    const page = await renderPage();
    const text = page.textContent ?? '';
    expect(text).toContain(crewModel.emptyCrewSentence('2026-10-06'));
    expect(text).toContain('for 2026-10-06');
    expect(text).toContain(crewModel.EMPTY_CREW_REMEDY);
    const link = [...page.querySelectorAll('a')].find(
      (a) => a.textContent === 'Data sources' && a.getAttribute('href') === crewModel.SOURCES_HREF,
    );
    expect(link).toBeDefined();
    // the panel says the date once; the provenance line adds no second no-duties sentence
    expect(page.querySelector('[data-testid="depot-provenance-context"]')).toBeNull();
  });
});

describe('every string the crew page model can produce', () => {
  const PROBES: Readonly<Record<string, readonly (readonly unknown[])[]>> = {
    emptyCrewSentence: [[], ['2026-10-06']],
    modelledDayPhrase: [[], ['2026-10-06']],
    shiftsSentence: [
      [1, 1, 0],
      [40, 30, 10, '2026-10-06'],
    ],
    shortfallText: [
      [
        (['no_slot_available', 'all_rostered', 'hours_limit'] as const).map((cause) => ({
          role: 'driver',
          cause,
        })),
      ],
    ],
    crossReferenceSentence: [
      [{ scheduled: { n: 5, of: 200 }, duties: 158, routes: 14, operatingDate: '2026-10-06' }],
      [{ scheduled: null, duties: 0, routes: 0, operatingDate: '2026-10-06' }],
    ],
    coverageLine: [
      [
        { shiftsRequired: 40, shiftsCovered: 30, shiftsUncovered: 10, dutiesNeedingRelief: 0 },
        [
          { shortfalls: [{ role: 'driver', cause: 'no_slot_available' }] },
          { shortfalls: [{ role: 'conductor', cause: 'hours_limit' }] },
        ],
      ],
    ],
    availabilityText: [
      ['driver', { available: 70, weekly_off: 14, leave: 6, training: 3, absent: 7 }],
    ],
    shiftLabel: [
      [{ dutyId: 'D-1', shiftIndex: 0, shiftCount: 1 }],
      [{ dutyId: 'D-1', shiftIndex: 1, shiftCount: 2 }],
    ],
    strengthSentence: [
      ['driver', { required: 1, available: 1 }],
      ['conductor', { required: 40, available: 58 }],
    ],
    dutiesSentence: [
      [1, 0, 0],
      [5, 2, 3],
    ],
    reliefSentence: [[0], [1], [3]],
    rosterCountSentence: [
      [5, 5],
      [200, 1234],
    ],
    uncoveredCountSentence: [
      [1, 1],
      [200, 1234],
    ],
    modelledStatement: [[{ dailyHours: 10, weeklyHours: 48 }]],
    crewDisclosure: [
      [{ ...SUMMARY, shiftsUncovered: 1 }, { dailyHours: 10, weeklyHours: 48 }, '2026-10-06'],
    ],
  };

  /** Exports that build no sentence: they return numbers or structures of numbers. */
  const NOT_SENTENCES: ReadonlySet<string> = new Set([
    'totalSlots',
    'availabilitySegments',
    'shortfallCounts',
    'pageOf',
  ]);

  it('probes every exported function or names it as building no sentence', () => {
    for (const [name, value] of Object.entries(crewModel)) {
      if (typeof value !== 'function') continue;
      expect(
        PROBES[name] !== undefined || NOT_SENTENCES.has(name),
        `${name} is not probed; add arguments, or list it as building no sentence`,
      ).toBe(true);
    }
  });

  it('never says today, ran or did not run, dated or not', () => {
    let seen = 0;
    const collect = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.flatMap(collect)
          : value !== null && typeof value === 'object'
            ? Object.values(value).flatMap(collect)
            : [];
    for (const [name, value] of Object.entries(crewModel)) {
      const strings =
        typeof value === 'function'
          ? (PROBES[name] ?? []).flatMap((args) =>
              collect((value as (...a: unknown[]) => unknown)(...args)),
            )
          : collect(value);
      for (const text of strings) {
        seen += 1;
        expect(text, `${name}: ${text}`).not.toMatch(/\btoday\b|\bran\b|did not run|this week/i);
      }
    }
    expect(seen).toBeGreaterThan(30);
  });

  it('dates the modelled day when the date is given', () => {
    expect(crewModel.modelledDayPhrase('2026-10-06')).toBe('in the modelled day for 2026-10-06');
    expect(crewModel.modelledDayPhrase()).toBe('in the modelled day');
    expect(crewModel.shiftsSentence(40, 38, 2, '2026-10-06')).toContain(
      'required in the modelled day for 2026-10-06;',
    );
    expect(crewModel.emptyCrewSentence('2026-10-06')).toBe(
      'No duties are modelled for this depot for 2026-10-06 (no route is seen running from it), so there are no crew shifts to cover.',
    );
  });
});
