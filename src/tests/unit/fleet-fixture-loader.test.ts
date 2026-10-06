import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/depot/log', () => ({ logDepotError: vi.fn() }));

import { logDepotError } from '@/lib/depot/log';
import { loadFleetFixture, resetFleetFixtureForTests } from '@/lib/upsrtc/fleetFixture';

const log = vi.mocked(logDepotError);

const RECORDS = [
  { regNum: 'UP1', depot_name: 'A' },
  { regNum: 'UP2', depot_name: 'B' },
];

const readOf = (body: string): ReturnType<typeof vi.fn<(file: string) => Buffer>> =>
  vi.fn<(file: string) => Buffer>(() => gzipSync(body));

describe('loadFleetFixture', () => {
  beforeEach(() => {
    resetFleetFixtureForTests();
    log.mockReset();
  });

  it('reads nothing until it is called', () => {
    const read = readOf(JSON.stringify(RECORDS));
    expect(read).not.toHaveBeenCalled();
    loadFleetFixture(read);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads the committed file and returns the full fleet with one stable identity', () => {
    const first = loadFleetFixture();
    const second = loadFleetFixture();
    expect(first).not.toBeNull();
    expect(first!.length).toBeGreaterThan(5_000);
    expect(second).toBe(first);
    expect(log).not.toHaveBeenCalled();
  });

  it('reads once, however often it is called', () => {
    const read = readOf(JSON.stringify(RECORDS));
    const first = loadFleetFixture(read);
    expect(first).toEqual(RECORDS);
    expect(loadFleetFixture(read)).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('returns null and logs once when the file is missing', () => {
    const read = vi.fn<(file: string) => Buffer>(() => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    });
    expect(loadFleetFixture(read)).toBeNull();
    expect(loadFleetFixture(read)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe('fleet-fixture');
  });

  it('returns null and logs once when the file is corrupt', () => {
    const read = vi.fn<(file: string) => Buffer>(() => Buffer.from('not gzip at all'));
    expect(loadFleetFixture(read)).toBeNull();
    expect(loadFleetFixture(read)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('returns null and logs when the content is not a usable record list', () => {
    for (const body of ['{"a":1}', '[]', '[1,2]', '[{"speed":1}]']) {
      resetFleetFixtureForTests();
      log.mockReset();
      expect(loadFleetFixture(readOf(body))).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
    }
  });
});
