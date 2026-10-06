import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelledDaySentence } from '@/lib/depot/sim/operatingDayWording';
import DepotCrewPage from '@/app/(protected)/project/depots/d/[depotId]/crew/page';
import type { CrewResponse } from '@/lib/depot/crew/api';
import {
  NO_UNCOVERED_SENTENCE,
  PEOPLE_SENTENCE,
  ROSTER_NOTE,
  SHORTFALL_EXPLANATION,
  coverageLine,
  crewDisclosure,
  SLOT_NOTE,
  availabilityText,
  dutiesSentence,
  emptyCrewSentence,
  modelledStatement,
  reliefSentence,
  rosterCountSentence,
  shiftLabel,
  shiftsSentence,
  shortfallText,
  strengthSentence,
  uncoveredCountSentence,
} from '@/lib/depot/crew/crewPageModel';
import type { CrewRole, ShortfallCause } from '@/lib/depot/crew/types';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';

const hooks = vi.hoisted(() => ({ crew: null as unknown }));

vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => ({ depotId: '20' }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({ data: null, error: null }),
}));
vi.mock('@/hooks/useDepotCrew', () => ({ useDepotCrew: (): unknown => hooks.crew }));

/** Words no sentence on this page may contain, whole words, camelCase-aware. */
const FORBIDDEN = ['name', 'score', 'rank', 'rating', 'performance', 'speed', 'violation'];

const wordsOf = (text: string): string[] =>
  text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

function expectClean(text: string): void {
  const words = wordsOf(text);
  for (const word of FORBIDDEN) expect(words, `"${word}" in: ${text}`).not.toContain(word);
  expect(text).not.toMatch(/simulated/i);
}

const ROLES: readonly CrewRole[] = ['driver', 'conductor'];
const CAUSES: readonly ShortfallCause[] = ['no_slot_available', 'all_rostered', 'hours_limit'];
const COUNTS = { available: 70, weekly_off: 14, leave: 6, training: 3, absent: 7 };

describe('every sentence the crew page model can produce', () => {
  it('holds no forbidden word and never says "simulated"', () => {
    const sentences: string[] = [
      PEOPLE_SENTENCE,
      ROSTER_NOTE,
      SLOT_NOTE,
      SHORTFALL_EXPLANATION,
      NO_UNCOVERED_SENTENCE,
      modelledDaySentence({ scheduled: { n: 5, of: 200 }, duties: 158, routes: 14 }),
      modelledDaySentence({ scheduled: null, duties: 0, routes: 0 }),
      coverageLine({ shiftsRequired: 160, shiftsCovered: 160, shiftsUncovered: 0, dutiesNeedingRelief: 0 }, []),
      coverageLine({ shiftsRequired: 160, shiftsCovered: 160, shiftsUncovered: 0, dutiesNeedingRelief: 3 }, []),
      coverageLine(
        { shiftsRequired: 40, shiftsCovered: 30, shiftsUncovered: 10, dutiesNeedingRelief: 0 },
        ROLES.flatMap((role) => CAUSES.map((cause) => ({ shortfalls: [{ role, cause }] }))),
      ),
      ...crewDisclosure(BASE.summary, BASE.limits).flatMap((section) => section.lines),
      emptyCrewSentence(),
      modelledStatement({ dailyHours: 10, weeklyHours: 48 }),
      reliefSentence(0),
      reliefSentence(1),
      reliefSentence(4),
      dutiesSentence(0, 0, 0),
      dutiesSentence(1, 1, 1),
      dutiesSentence(12, 3, 2),
      shiftsSentence(0, 0, 0),
      shiftsSentence(1, 1, 0),
      shiftsSentence(40, 30, 10),
      rosterCountSentence(5, 5),
      rosterCountSentence(200, 1234),
      uncoveredCountSentence(1, 1),
      uncoveredCountSentence(200, 1234),
      shiftLabel({ dutyId: 'D-1', shiftIndex: 1, shiftCount: 2 }),
      ...ROLES.flatMap((role) => [
        strengthSentence(role, { required: 1, available: 1 }),
        strengthSentence(role, { required: 40, available: 58 }),
        availabilityText(role, COUNTS),
        ...CAUSES.map((cause) => shortfallText([{ role, cause }])),
      ]),
      shortfallText(ROLES.flatMap((role) => CAUSES.map((cause) => ({ role, cause })))),
    ];
    for (const sentence of sentences) expectClean(sentence);
  });
});

const BASE: CrewResponse = {
  feedNow: '2026-10-06T10:00:00Z',
  fetchedAt: '2026-10-06T10:00:05.000Z',
  source: 'live',
  stale: false,
  depotId: '20',
  depotLabel: 'Alambagh',
  operatingDate: '2026-10-06',
  provenance: 'modelled',
  summary: {
    shiftsRequired: 2,
    shiftsCovered: 1,
    shiftsUncovered: 1,
    driver: { required: 2, available: 3 },
    conductor: { required: 2, available: 1 },
    dutiesFullyCovered: 1,
    dutiesPartlyCovered: 0,
    dutiesUncovered: 1,
    dutiesNeedingRelief: 0,
  },
  day: { duties: 2, routes: 1 },
  availability: {
    driver: { available: 3, weekly_off: 1, leave: 1, training: 0, absent: 0 },
    conductor: { available: 1, weekly_off: 0, leave: 0, training: 0, absent: 0 },
  },
  uncovered: [
    {
      dutyId: 'D-2',
      route: 'ORD_1',
      shiftIndex: 0,
      shiftCount: 1,
      startMin: 420,
      endMin: 600,
      shortRoles: ['conductor'],
      reason: 'no_available_crew',
      shortfalls: [{ role: 'conductor', cause: 'all_rostered' }],
    },
  ],
  uncoveredTotal: 1,
  uncoveredCap: 200,
  roster: [
    {
      dutyId: 'D-1',
      route: 'ORD_1',
      shiftIndex: 0,
      shiftCount: 1,
      startMin: 400,
      endMin: 700,
      driverSlot: 'D-001',
      conductorSlot: 'C-001',
    },
  ],
  rosterTotal: 1,
  rosterCap: 200,
  limits: { dailyHours: 10, weeklyHours: 48 },
};

function setHook(partial: Record<string, unknown>): void {
  hooks.crew = { data: null, error: null, loading: false, refresh: () => {}, ...partial };
}

const text = (markup: string): string => markup.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'");

async function renderPage(): Promise<string> {
  const element = await DepotCrewPage({ params: Promise.resolve({ depotId: '20' }) });
  return renderToStaticMarkup(element);
}

describe('the crew page', () => {
  beforeEach(() => setHook({}));

  const STATES: readonly (readonly [string, Record<string, unknown>])[] = [
    ['loading', { loading: true }],
    ['error', { error: 'Depot data unavailable' }],
    ['not found', { error: DEPOT_NOT_FOUND_MESSAGE }],
    [
      'empty',
      { data: { ...BASE, summary: { ...BASE.summary, shiftsRequired: 0 }, uncovered: [] } },
    ],
    ['data', { data: BASE }],
  ];

  it.each(STATES)('states the people sentence in the %s state', async (_name, partial) => {
    setHook(partial);
    expect(text(await renderPage())).toContain(PEOPLE_SENTENCE);
  });

  it.each(STATES)('holds no forbidden word in the %s state', async (_name, partial) => {
    setHook(partial);
    expectClean(text(await renderPage()));
  });

  // The people sentence is the description's second
  // sentence, so it comes before the provenance line and the coverage line.
  it('puts the coverage line under the header, whose description carries the people sentence', async () => {
    setHook({ data: { ...BASE, summary: { ...BASE.summary, shiftsUncovered: 1 } } });
    const markup = await renderPage();
    const page = text(markup);
    expect(markup).toContain('data-testid="crew-coverage-line"');
    expect(page).toContain('1 of 2 shifts covered; 1 uncovered; conductors: 1 all already rostered at the time.');
    const people = markup.indexOf('No individual is assessed.');
    expect(people).toBeGreaterThan(-1);
    expect(people).toBeLessThan(markup.indexOf('depot-provenance-line'));
    expect(markup.indexOf('depot-provenance-line')).toBeLessThan(markup.indexOf('crew-coverage-line'));
    // Each role bar has one mono label, not a sans label and a mono count.
    const labels = [...markup.matchAll(/<h3 class="depot-label[^"]*" data-testid="crew-role-label">([^<]*)<\/h3>/g)];
    expect(labels.map((m) => m[1]?.replace(/ · .*/, ''))).toEqual(['Drivers', 'Conductors']);
    expect(labels.every((m) => / · \d[\d,]* slots?$/.test(m[1] ?? ''))).toBe(true);
  });

  it('says "no relief needed" in one line when every shift is covered and shows no shortfall explanation', async () => {
    const covered = { ...BASE.summary, shiftsRequired: 160, shiftsCovered: 160, shiftsUncovered: 0 };
    setHook({ data: { ...BASE, summary: covered, uncovered: [], uncoveredTotal: 0 } });
    const markup = await renderPage();
    expect(text(markup)).toContain('160 of 160 shifts covered; no relief needed.');
    expect(markup).not.toContain('crew-shortfall-explanation');
    expect(text(markup)).toContain(NO_UNCOVERED_SENTENCE);
    expect(markup).not.toContain('Short</th>');
  });

  it('keeps the shortfall explanation visible beside a shortfall, and prints the modelled-day sentence', async () => {
    setHook({ data: BASE });
    const markup = await renderPage();
    expect(markup).toContain('crew-shortfall-explanation');
    // The shared formula with the plain date (no coverage before the detail loads).
    expect(text(markup)).toContain('Built on the modelled day for 6 Oct 2026.');
    expect(text(markup)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('has no tiles, no tags in cells and no "About this page" panel; the roster is behind a closed disclosure', async () => {
    setHook({ data: BASE });
    const markup = await renderPage();
    expect(markup).not.toContain('About this page');
    expect(markup).not.toContain('Shifts required');
    // One tag per labelled surface, the
    // provenance line, "Uncovered shifts" and "Suggested roster", each on its section
    // label; none in a header cell or a cell.
    const page = new DOMParser().parseFromString(markup, 'text/html');
    const tags = [...page.querySelectorAll('.depot-tag')].filter((el) => el.textContent === 'MODELLED');
    expect(tags).toHaveLength(3);
    expect(tags[0]?.closest('[data-testid="depot-provenance-line"]')).not.toBeNull();
    const labelled = tags.slice(1).map((tag) => tag.closest('section')?.getAttribute('aria-labelledby'));
    expect(labelled).toEqual(['depot-crew-uncovered-heading', 'depot-crew-roster-heading']);
    for (const cell of page.querySelectorAll('th, td')) {
      expect(cell.textContent).not.toMatch(/MODELLED/);
    }
    // The roster opens from "SHOW ›" in its label's controls slot, closed at first.
    const toggle = page.querySelector('[aria-controls="depot-crew-roster-body"]');
    expect(toggle?.textContent).toBe('Show›');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.closest('[data-testid="depot-section-controls"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="crew-roster-body"]')?.hasAttribute('hidden')).toBe(true);
    expect(markup).not.toContain('<details open');
    expect(text(markup)).toContain('How these figures are produced');
  });

  it('words the uncovered shift per role, the shortfall explanation and the slot note', async () => {
    setHook({ data: BASE });
    const page = text(await renderPage());
    expect(page).toContain('Conductor: all available conductors are already rostered at this time.');
    expect(page).toContain('A shortfall here is an outcome of the model');
    expect(page).toContain('some of which overlap.');
    expect(page).toContain(SLOT_NOTE);
    expect(page).not.toMatch(/driver or conductor/i);
  });
});
