// getStopAreaAndGroup.php — the geography index that makes a statewide OD sweep
// possible at all, and the three upstream behaviours that decide how it is read.
//
// NO NETWORK. Every payload here is a recorded upstream body or a shape derived
// from one; the enumerator's fetcher is always injected.

import { describe, expect, it } from 'vitest';
import {
  buildStopAreaGroupUrl,
  enumerateStopAreaGroups,
  normalizeStopAreaGroupRows,
  toClassification,
  DEFAULT_PREFIX_ALPHABET,
  STOP_AREA_GROUP_RESULT_LIMIT,
  type StopAreaGroupFetchResult,
} from '../../src/ingestion/upsrtc/stopAreaGroup.js';

/** A recorded `?query=lu` response, trimmed to the rows that matter. */
const LUCKNOW_PAYLOAD = [
  { id: 8, code: '', name: 'LUCKNOW', classification: 'GROUP' },
  { id: 9430, code: 'LMH', name: 'LUMBH', classification: 'STOP_AREA' },
  { id: 22405, code: 'LDNA', name: 'LUDHIANA ', classification: 'STOP_AREA' },
];

function row(id: number, name: string, classification = 'STOP_AREA'): Record<string, unknown> {
  return { id, code: '', name, classification };
}

/** A payload of exactly the server-side cap, i.e. a KNOWN-TRUNCATED response. */
function fullPage(prefix: string): Record<string, unknown>[] {
  return Array.from({ length: STOP_AREA_GROUP_RESULT_LIMIT }, (_value, index) =>
    row(1000 + prefix.length * 100 + index, `${prefix.toUpperCase()}PLACE${index}`),
  );
}

describe('normalizeStopAreaGroupRows', () => {
  it('reads a city and a stop out of the same response, keeping the classification', () => {
    const result = normalizeStopAreaGroupRows(LUCKNOW_PAYLOAD);

    expect(result.rowCount).toBe(3);
    expect(result.rejectedRowCount).toBe(0);
    expect(result.entries[0]).toEqual({
      id: 8,
      // Empty upstream on every GROUP, and `pick` treats '' as absent.
      code: null,
      name: 'LUCKNOW',
      classification: 'GROUP',
    });
    // Trailing space trimmed: upstream ships "LUDHIANA ".
    expect(result.entries.find((entry) => entry.id === 22405)!.name).toBe('LUDHIANA');
  });

  it('treats the JSON `null` no-match answer as an empty result, not a failure', () => {
    // MEASURED: a query matching nothing answers HTTP 200 with a bare `null`
    // body, NOT `[]`. Most two-letter prefixes in the drill do exactly this, so
    // anything that threw or errored here would break enumeration outright.
    const result = normalizeStopAreaGroupRows(null);

    expect(result.entries).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.rejectedRowCount).toBe(0);
  });

  it('filters UNKNOWN, which is a bucket rather than a place', () => {
    // UNKNOWN(11000) sits in the GROUP list. Left in, it becomes an origin and a
    // destination in the sweep — 30 extra POSTs for a city that does not exist,
    // and rows attributed to a fictional place.
    const result = normalizeStopAreaGroupRows([
      { id: 11000, code: '', name: 'UNKNOWN', classification: 'GROUP' },
      { id: 11004, code: '', name: 'VARANASI', classification: 'GROUP' },
    ]);

    expect(result.entries.map((entry) => entry.name)).toEqual(['VARANASI']);
    expect(result.nonPlaceRowCount).toBe(1);
    // Not a rejection: the row was well-formed, it just is not a place.
    expect(result.rejectedRowCount).toBe(0);
  });

  it('rejects rows it cannot identify rather than inventing an id or a class', () => {
    const result = normalizeStopAreaGroupRows([
      { code: 'X', name: 'NO ID', classification: 'STOP_AREA' },
      { id: 5, classification: 'STOP_AREA' },
      { id: 6, name: 'ODD', classification: 'REGION' },
      'not an object',
    ]);

    expect(result.entries).toEqual([]);
    expect(result.rejectedRowCount).toBe(4);
  });

  it('maps only the two classifications upstream actually uses', () => {
    expect(toClassification('GROUP')).toBe('GROUP');
    expect(toClassification('STOP_AREA')).toBe('STOP_AREA');
    expect(toClassification('group')).toBe('GROUP');
    expect(toClassification('REGION')).toBeNull();
    expect(toClassification(null)).toBeNull();
  });
});

describe('buildStopAreaGroupUrl', () => {
  it('sends the query as a single encoded parameter', () => {
    expect(buildStopAreaGroupUrl('mohanlal ganj')).toContain('query=mohanlal+ganj');
  });
});

describe('enumerateStopAreaGroups', () => {
  /** Records every prefix asked about, in order. */
  function recorder(
    answer: (query: string) => unknown,
  ): { fetch: (query: string) => Promise<StopAreaGroupFetchResult>; asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      fetch: (query: string) => {
        asked.push(query);
        return Promise.resolve({ query, payload: answer(query), error: null });
      },
    };
  }

  it('drills ONLY the prefixes the server truncated, and stops at maxDepth', () => {
    // The termination rule is the whole algorithm: a response SHORTER than the
    // server-side cap is complete, so it is never extended. Only a response at
    // exactly the cap is evidence of more rows behind it.
    const alphabet = 'abc';
    const { fetch, asked } = recorder((query) =>
      query === 'a' ? fullPage(query) : [row(1, `${query.toUpperCase()}TOWN`)],
    );

    return enumerateStopAreaGroups({ alphabet, maxDepth: 2, fetch }).then((result) => {
      expect(asked).toEqual(['a', 'b', 'c', 'aa', 'ab', 'ac']);
      expect(result.queriesIssued).toBe(6);
      expect(result.truncatedPrefixes).toEqual(['a']);
      // 'a' was expanded, so nothing was left unexplored.
      expect(result.unexpandedPrefixes).toEqual([]);
      expect(result.failures).toEqual([]);
    });
  });

  it('reports a prefix it could not expand instead of implying the list is complete', () => {
    // A still-truncated prefix at maxDepth means the enumeration is knowingly
    // partial. Saying so is the difference between a bounded drill and a silent
    // one.
    const { fetch } = recorder((query) => (query.startsWith('a') ? fullPage(query) : null));

    return enumerateStopAreaGroups({ alphabet: 'ab', maxDepth: 2, fetch }).then((result) => {
      expect(result.truncatedPrefixes).toEqual(['a', 'aa', 'ab']);
      expect(result.unexpandedPrefixes).toEqual(['aa', 'ab']);
    });
  });

  it('honours maxQueries and still reports what it skipped', () => {
    const { fetch, asked } = recorder(() => fullPage('x'));

    return enumerateStopAreaGroups({ alphabet: 'abc', maxDepth: 2, maxQueries: 2, fetch }).then(
      (result) => {
        expect(asked).toEqual(['a', 'b']);
        expect(result.queriesIssued).toBe(2);
        expect(result.unexpandedPrefixes).toContain('c');
      },
    );
  });

  it('dedupes across prefixes and keeps GROUP 8 distinct from STOP_AREA 8', () => {
    // The id spaces collide numerically and mean different things: 8 is LUCKNOW
    // the city AND a valid stop area. Keying on the id alone would silently drop
    // one of them.
    const { fetch } = recorder(() => [
      { id: 8, code: '', name: 'LUCKNOW', classification: 'GROUP' },
      { id: 8, code: 'XYZ', name: 'SOME STOP', classification: 'STOP_AREA' },
    ]);

    return enumerateStopAreaGroups({ alphabet: 'ab', maxDepth: 1, fetch }).then((result) => {
      expect(result.groups).toEqual([
        { id: 8, code: null, name: 'LUCKNOW', classification: 'GROUP' },
      ]);
      expect(result.stopAreas).toEqual([
        { id: 8, code: 'XYZ', name: 'SOME STOP', classification: 'STOP_AREA' },
      ]);
    });
  });

  it('never returns UNKNOWN as a city, however many prefixes surface it', () => {
    const { fetch } = recorder(() => [
      { id: 11000, code: '', name: 'UNKNOWN', classification: 'GROUP' },
      { id: 12, code: '', name: 'PRAYAGRAJ', classification: 'GROUP' },
    ]);

    return enumerateStopAreaGroups({ alphabet: 'abcd', maxDepth: 1, fetch }).then((result) => {
      expect(result.groups.map((group) => group.name)).toEqual(['PRAYAGRAJ']);
    });
  });

  it('records a transport failure and carries on with the rest of the drill', () => {
    const asked: string[] = [];
    const fetch = (query: string): Promise<StopAreaGroupFetchResult> => {
      asked.push(query);
      return Promise.resolve(
        query === 'b'
          ? { query, payload: null, error: 'Upstream timed out after 30000ms' }
          : { query, payload: [row(1, 'A TOWN')], error: null },
      );
    };

    return enumerateStopAreaGroups({ alphabet: 'abc', maxDepth: 1, fetch }).then((result) => {
      expect(asked).toEqual(['a', 'b', 'c']);
      expect(result.failures).toEqual([
        { query: 'b', error: 'Upstream timed out after 30000ms' },
      ]);
      expect(result.stopAreas).toHaveLength(1);
    });
  });

  it('seeds the drill with the whole latin alphabet by default', () => {
    expect(DEFAULT_PREFIX_ALPHABET).toHaveLength(26);
  });
});
