// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filesUnder, isTsSource, parseFile, textPieces } from './depot-guard-source';

/*
 * A depot page can be showing the saved sample or last-good data, so no sentence may call
 * its data live unless it is chosen only when the feed is live. Every piece of text in the
 * depot's components, libraries and pages that says "live" is listed here with why it may:
 * a provenance class label (a pill names the class, not the feed's state now), a sentence
 * worded only for the live feed, the chip's "not the live feed", or text no page shows.
 * A new one fails until it is worded for the data the page has, or added with its reason.
 */

const FOLDERS = [
  'src/components/depot',
  'src/lib/depot',
  'src/app/(protected)/project/depots',
] as const;
const LIVE = /\blive\b/i;

/** A union member or record key ('live') or a module path: code, never shown as a sentence. */
const isCode = (text: string): boolean => text === 'live' || /^[@.]?\.?\//.test(text);

/** The entry whose key ends `file`'s path: keys are path tails, so a moved folder still matches. */
function entryFor<T>(table: Readonly<Record<string, T>>, file: string): T | undefined {
  const key = Object.keys(table).find((tail) => file.endsWith(`/${tail}`));
  return key === undefined ? undefined : table[key];
}

/** Files whose text no page shows, with why. */
const NOT_SHOWN: Readonly<Record<string, string>> = {
  'lib/depot/copilot/vocabulary/describe.ts': "the copilot's word list",
  'lib/depot/maintenance/calibrationCli.ts': 'the calibration script, run in a terminal',
};

const CLASS = 'a provenance class label, not a claim that the feed is live now';
const FRESH = 'worded only for the live feed; the sample and last-good data have their own words';
const NOT_LIVE = 'says the sample is not the live feed';
const STATUS = "the feed's own status word for a bus, as the feed sends it";
const REGISTRY = "the data sources registry, naming a feed's kind and its fields";

/** A file's path tail → each permitted text, with why it may say live. */
const PERMITTED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'cockpit/CockpitMethod.tsx': {
    'The feed&apos;s own status, as it reports it (LIVE): ': CLASS,
  },
  'network/StatusMixBar.tsx': { Live: STATUS },
  'TrendPlot.tsx': { LIVE: CLASS },
  'sources/SourcesRegistry.tsx': {
    'LIVE feeds are read from the upstream service; MODELLED feeds are generated from planning assumptions; AWAITING FEED is not connected yet and its expected schema is listed so a real feed can replace the model.':
      REGISTRY,
  },
  'lib/depot/copilot/facts/answers.ts': { 'the live data': FRESH },
  'lib/depot/copilot/service/stale.ts': {
    'These figures are from sample data, not the live feed; its feed time is not known.': NOT_LIVE,
    'These figures are from sample data, not the live feed (feed time ': NOT_LIVE,
  },
  'lib/depot/feedChip.ts': {
    'Sample data, not the live feed': NOT_LIVE,
    'LIVE · ': FRESH,
    'Live feed, ': FRESH,
    'Feed status: live feed, ': FRESH,
    'Live from the feed at': FRESH,
    'Derived from the live feed at': FRESH,
    'Modelled: generated figures, anchored on the live feed at': FRESH,
  },
  'lib/depot/forecast/chartModel.ts': { 'Feed value, LIVE': CLASS },
  'lib/depot/labels.ts': { LIVE: CLASS },
  'lib/depot/maintenance/text.ts': { Live: STATUS },
  'lib/depot/provenanceLine.ts': {
    LIVE: CLASS,
    'Computed from the live feed at': FRESH,
    'Live from the feed at': FRESH,
  },
  'lib/depot/sources/registry.ts': {
    LIVE: CLASS,
    'Everything on the live pages: fleet status, yards, the league table and exceptions.': REGISTRY,
    'live | stationary | no_signal | under_maintenance | unknown': REGISTRY,
    'The feed status word, kept as sent (observed: Offline, Live, Stationary, Towing); a different vocabulary from vehicleStatus.':
      REGISTRY,
  },
};

function liveTexts(file: string): string[] {
  if (entryFor(NOT_SHOWN, file) !== undefined) return [];
  return textPieces(parseFile(file))
    .map((piece) => piece.what)
    .filter((text) => LIVE.test(text) && !isCode(text));
}

describe('no depot sentence calls the sample or last-good data live', () => {
  const files = FOLDERS.flatMap((folder) => filesUnder(folder, isTsSource));

  it('scans the components, the libraries and the pages', () => {
    for (const folder of FOLDERS) {
      expect(files.filter((f) => f.startsWith(folder)).length).toBeGreaterThan(0);
    }
  });

  it('finds "live" only in the texts listed with their reason', () => {
    const offenders = files.flatMap((file) =>
      liveTexts(file)
        .filter((text) => entryFor(PERMITTED, file)?.[text] === undefined)
        .map((text) => `${file}: ${JSON.stringify(text)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps every permitted text in its file, so the list can only shrink', () => {
    const gone = Object.entries(PERMITTED).flatMap(([tail, texts]) => {
      const matches = files.filter((file) => file.endsWith(`/${tail}`));
      const present = matches.length === 1 ? liveTexts(matches[0] ?? '') : [];
      return Object.keys(texts)
        .filter((text) => !present.includes(text))
        .map((text) => `${tail}: ${JSON.stringify(text)}`);
    });
    expect(gone).toEqual([]);
  });
});
