import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotRosterPage from '@/app/(protected)/project/depots/d/[depotId]/roster/page';
import { RosterTable } from '@/components/depot/roster/RosterTable';
import type { DepotBusView } from '@/lib/depot/api';
import { drawerFacts } from '@/lib/depot/roster/drawerFacts';
import type { RosterTier } from '@/lib/depot/roster/rosterColumns';
import { buildRosterRows } from '@/lib/depot/roster/rosterModel';

const hooks = vi.hoisted(() => ({
  detail: null as unknown,
  network: null as unknown,
  params: new URLSearchParams(),
}));

vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => hooks.detail,
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => hooks.network,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (): void => {} }),
  usePathname: () => '/roster',
  useSearchParams: () => hooks.params,
}));

const FEED_NOW = '2026-10-06T09:30:00.000Z';

function bus(overrides: Partial<DepotBusView> = {}): DepotBusView {
  return {
    registrationNumber: 'UP14AB1000',
    state: 'in_service',
    location: 'in_yard',
    otherDepotId: null,
    distanceFromYardKm: null,
    latitude: null,
    longitude: null,
    speedKmph: null,
    gpsAgeMin: 2,
    vehicleStatus: 'moving',
    tripStatus: null,
    routeName: 'Lucknow - Kanpur',
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: '2026-10-06T08:51:00.000Z',
    scheduledEnd: null,
    tripDate: null,
    delayMinutes: null,
    mainPowerOn: true,
    tamperCode: null,
    ...overrides,
  } as DepotBusView;
}

const UNHEARD = bus({
  registrationNumber: 'UP14AB2000',
  state: 'on_road',
  location: 'away',
  distanceFromYardKm: 34.4,
  gpsAgeMin: 192,
  notHeardMin: 192,
  scheduledStart: '2026-10-05T13:46:00.000Z',
});

function setDetail(partial: Record<string, unknown>): void {
  hooks.detail = { data: null, error: null, loading: false, refresh: () => {}, ...partial };
}

function setFeed(data: unknown, error: string | null = null): void {
  hooks.network = { data, error };
}

const FRESH_FEED = { source: 'live', stale: false, feedNow: FEED_NOW, depots: [] };

async function render(): Promise<Document> {
  const element = await DepotRosterPage({ params: Promise.resolve({ depotId: '20' }) });
  return new DOMParser().parseFromString(renderToStaticMarkup(element), 'text/html');
}

const provenance = (doc: Document): { tone: string | null; text: string } => {
  const line = doc.querySelector('[data-testid="depot-provenance-line"]');
  return { tone: line?.getAttribute('data-tone') ?? null, text: line?.textContent ?? '' };
};

const dataState = (buses: readonly DepotBusView[]): Record<string, unknown> => ({
  data: { buses, feedNow: FEED_NOW, stale: false },
});

const PAGE_STATES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['loading', { loading: true }],
  ['error', { error: 'Depot data unavailable' }],
  ['empty', dataState([])],
  ['data', dataState([bus(), UNHEARD])],
];

describe('the roster page, provenance line in every state', () => {
  beforeEach(() => {
    hooks.params = new URLSearchParams();
    setFeed(FRESH_FEED);
  });

  it.each(PAGE_STATES)('is DERIVED from the live feed in the %s state', async (_name, partial) => {
    setDetail(partial);
    const line = provenance(await render());
    expect(line.tone).toBe('derived');
    expect(line.text).toContain('DERIVED');
    expect(line.text).toContain('Computed from the live feed at 09:30.');
    expect(line.text).not.toMatch(/MODELLED|MIXED/);
  });

  it.each([
    ['stale', { ...FRESH_FEED, stale: true }, null, 'Computed from the last good data, feed time 09:30.'],
    ['waiting', null, null, 'Waiting for the feed.'],
    ['unavailable', null, 'down', 'The feed is unavailable.'],
  ])('says the %s feed in the line and keeps the tone', async (_name, feed, error, sentence) => {
    setFeed(feed, error);
    setDetail(dataState([bus()]));
    const line = provenance(await render());
    expect(line.tone).toBe('derived');
    expect(line.text).toContain(sentence);
  });
});

describe('the roster page, as the reader meets it', () => {
  beforeEach(() => {
    hooks.params = new URLSearchParams();
    setFeed(FRESH_FEED);
    setDetail(dataState([bus(), UNHEARD]));
  });

  it('has no sentence between the header and the table, and one count: the section label', async () => {
    const doc = await render();
    expect(doc.querySelector('h2')?.textContent).toBe('Roster · 2');
    expect(doc.body.textContent).not.toMatch(/Showing \d/);
    expect(doc.querySelector('[data-testid="depot-pager"]')).toBeNull();
  });

  it('keeps STATE to the word and says "not heard" once, in LAST HEARD, in the warning tone', async () => {
    const doc = await render();
    const row = Array.from(doc.querySelectorAll('tbody tr')).find((tr) =>
      (tr.textContent ?? '').includes('UP14AB2000'),
    );
    const cells = Array.from(row?.querySelectorAll('td') ?? []);
    const stateCell = cells[1];
    expect(stateCell?.textContent).toBe('On road');
    expect(stateCell?.getAttribute('title')).toBe('On road, no schedule in feed');
    const heard = row?.querySelector('[data-testid="roster-not-heard"]');
    expect(heard?.textContent).toBe('not heard 3 h 12 min');
    expect(heard?.className).toContain('text-alert-amber');
    expect(doc.body.textContent?.match(/not heard/g)).toHaveLength(1);
  });

  it('keeps an earlier day schedule with its date, muted, and says why in the title', async () => {
    const doc = await render();
    const muted = doc.querySelector('[data-testid="roster-earlier-day"]');
    expect(muted?.textContent).toBe('5 Oct 2026, 13:46');
    expect(muted?.className).toContain('text-depot-faint');
    expect(muted?.parentElement?.getAttribute('title')).toContain("earlier day's schedule");
    expect(doc.body.textContent).toContain('08:51');
  });

  it('never shows RUNNING as a column, even when a row has a value (the drawer has it)', async () => {
    setDetail(dataState([bus({ delayMinutes: 7 }), UNHEARD]));
    const doc = await render();
    const headers = Array.from(doc.querySelectorAll('th')).map((th) => th.textContent);
    expect(headers).not.toContain('Running');
    const facts = drawerFacts(buildRosterRows([bus({ delayMinutes: 7 })])[0]!);
    expect(facts.find((fact) => fact.label === 'Running')?.value).toBe('7 min late');
  });

  it('sets each column to its width and drops nothing at 1440', async () => {
    const doc = await render();
    const widths = Array.from(doc.querySelectorAll('th')).map((th) => th.getAttribute('style'));
    expect(widths).toEqual([
      'width:120px',
      'width:116px',
      'width:196px',
      'width:152px',
      'width:160px',
      'width:184px',
      'width:120px',
    ]);
  });

  it('pages at 25 with the shared pager only when there are more rows', async () => {
    const many = Array.from({ length: 26 }, (_, index) =>
      bus({ registrationNumber: `UP14AB${String(index).padStart(4, '0')}` }),
    );
    setDetail(dataState(many));
    const doc = await render();
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(doc.querySelector('[data-testid="depot-pager"]')?.textContent).toContain('Rows 1 to 25 of 26');
  });

  it('says what is absent, what would change it and offers one action, in both empty states', async () => {
    setDetail(dataState([]));
    const none = await render();
    expect(none.body.textContent).toContain('The feed lists no buses homed at this depot.');
    expect(none.body.textContent).toContain('Buses appear here as soon as the feed homes one');
    expect(none.querySelector('a[href$="/sources"]')?.textContent).toBe('Data sources');

    setDetail(dataState([bus()]));
    hooks.params = new URLSearchParams('state=dark');
    const unmatched = await render();
    expect(unmatched.body.textContent).toContain('No bus matches these filters.');
    expect(unmatched.body.textContent).toContain('Remove a state, a location or the search');
    expect(
      Array.from(unmatched.querySelectorAll('button')).some((b) => b.textContent === 'Clear the filters'),
    ).toBe(true);
  });

  it('names the copy of the feed that lists no buses: never "live feed" on a sample or old data', async () => {
    setDetail({ data: { buses: [], feedNow: FEED_NOW, stale: false, source: 'fixture' } });
    const sample = await render();
    expect(sample.body.textContent).toContain('The saved sample of the feed lists no buses homed at this depot.');
    expect(sample.querySelector('[data-state="empty"]')?.textContent).not.toContain('live feed');

    setDetail({ data: { buses: [], feedNow: FEED_NOW, stale: true, source: 'cache' } });
    const old = await render();
    expect(old.body.textContent).toContain('The last good copy of the feed lists no buses homed at this depot.');
    expect(old.querySelector('[data-state="empty"]')?.textContent).not.toContain('live feed');

    setDetail({ data: { buses: [], feedNow: FEED_NOW, stale: false, source: 'live' }, error: 'Depot data unavailable' });
    const failing = await render();
    expect(failing.body.textContent).toContain('The last good copy of the feed lists no buses homed at this depot.');
  });

  it('keeps the filters in the URL as other pages link to them', async () => {
    hooks.params = new URLSearchParams('state=on_road');
    const doc = await render();
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(doc.querySelector('h2')?.textContent).toBe('Roster · 1');
  });
});

describe('the roster table at a phone', () => {
  function table(tier: RosterTier): Document {
    const rows = buildRosterRows([bus(), UNHEARD]);
    const markup = renderToStaticMarkup(
      <RosterTable
        rows={rows}
        feedNow={FEED_NOW}
        onOpen={() => {}}
        tier={tier}
      />,
    );
    return new DOMParser().parseFromString(markup, 'text/html');
  }
  const headers = (doc: Document): (string | null)[] =>
    Array.from(doc.querySelectorAll('th')).map((th) => th.textContent);

  it('keeps registration, the state square AND its word, and the short location', () => {
    const doc = table('phone');
    expect(headers(doc)).toEqual(['Registration', 'State', 'Location']);
    const cells = Array.from(doc.querySelectorAll('tbody tr:nth-child(2) td'));
    expect(cells.map((cell) => cell.textContent)).toEqual(['UP14AB2000', 'On road', '34 km']);
    expect(cells[1]?.getAttribute('title')).toBe('On road, no schedule in feed');
    // The word is on screen, not only read out: a square alone is colour alone.
    expect(cells[1]?.querySelector('.sr-only')).toBeNull();
    expect(cells[1]?.querySelector('[aria-hidden]')).not.toBeNull();
    expect(doc.body.textContent).toContain('Yard');
    expect(doc.body.textContent).not.toContain('Other depot');
  });

  it('drops RUNNING everywhere and SCHEDULED START below 1280; LAST HEARD stays at 1024 and 800', () => {
    expect(headers(table('wide'))).toEqual([
      'Registration',
      'State',
      'Location',
      'Route',
      'Scheduled start',
      'Last heard',
      'Flags',
    ]);
    expect(headers(table('medium'))).toEqual([
      'Registration',
      'State',
      'Location',
      'Route',
      'Last heard',
      'Flags',
    ]);
    const narrow = table('narrow');
    expect(headers(narrow)).toEqual(['Registration', 'State', 'Location', 'Last heard']);
    expect(narrow.querySelector('tbody tr:nth-child(2) td:nth-child(3)')?.textContent).toBe('34 km');
  });

  it('writes FLAGS in its short words, with the full words in the title', () => {
    const rows = buildRosterRows([bus({ mainPowerOn: false, tamperCode: '7' })]);
    const markup = renderToStaticMarkup(
      <RosterTable rows={rows} feedNow={FEED_NOW} onOpen={() => {}} tier="wide" />,
    );
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    const flags = doc.querySelector('tbody tr:nth-child(1) td:last-child');
    expect(flags?.textContent).toBe('Power off +1');
    expect(flags?.getAttribute('title')).toBe('Main power off; Tamper code 7');
  });
});

describe('every string the roster can produce', () => {
  const STATES = ['in_service', 'on_road', 'standing', 'dark', 'off_road'] as const;
  const LOCATIONS = ['in_yard', 'at_other_yard', 'away', 'unknown'] as const;
  const AGES = [0, 5, 61, 200, 3000, 20000] as const;
  const FLEET: readonly DepotBusView[] = STATES.flatMap((state, si) =>
    LOCATIONS.flatMap((location, li) =>
      AGES.map((age, ai) =>
        bus({
          registrationNumber: `UP14${si}${li}${ai}`,
          state,
          location,
          distanceFromYardKm: location === 'away' ? 12.6 + ai : null,
          gpsAgeMin: age,
          notHeardMin: age > 60 && state !== 'dark' && state !== 'off_road' ? age : null,
          delayMinutes: ai === 2 ? -4 : ai === 3 ? 9 : null,
          mainPowerOn: ai === 1 ? false : true,
          tamperCode: ai === 4 ? '7' : null,
          scheduledStart: ai % 2 === 0 ? '2026-10-05T13:46:00.000Z' : '2026-10-06T08:51:00.000Z',
          routeName: ai === 5 ? null : 'Lucknow - Kanpur',
        }),
      ),
    ),
  );

  /** Visible text, plus every title and aria-label, of the page and of each bus's drawer facts. */
  function allStrings(doc: Document, rows: ReturnType<typeof buildRosterRows>): string[] {
    const attrs = Array.from(doc.querySelectorAll('[title],[aria-label]')).flatMap((el) => [
      el.getAttribute('title') ?? '',
      el.getAttribute('aria-label') ?? '',
    ]);
    const facts = rows.flatMap((row) => drawerFacts(row).map((f) => `${f.label} ${f.value}`));
    const cells = Array.from(doc.querySelectorAll('td, th, h2, p, button, option')).map(
      (el) => el.textContent ?? '',
    );
    const walker = doc.createTreeWalker(doc.body, 4);
    const nodes: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node.textContent ?? '');
    return [...cells, ...attrs, ...facts, ...nodes];
  }

  it('has no ISO stamp, no raw minutes above an hour, no "simulated" and no tag in a cell', async () => {
    hooks.params = new URLSearchParams();
    setFeed(FRESH_FEED);
    const rows = buildRosterRows(FLEET);
    setDetail(dataState(FLEET));
    const doc = await render();
    for (const text of allStrings(doc, rows)) {
      expect(text).not.toMatch(/simulated/i);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(text.match(/\b(?:6[1-9]|[7-9]\d|\d{3,}) min\b/)?.[0] ?? null).toBeNull();
      expect(text).not.toMatch(/MODELLED/);
    }
    expect(doc.querySelectorAll('tbody .depot-tag')).toHaveLength(0);
  });
});
