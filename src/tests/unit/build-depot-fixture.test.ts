import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { buildDepotFixture } from '../../../scripts/build-depot-fixture';

const PAYLOAD = [
  { regNum: 'UP1', depot_name: 'A', routename: 'R1', mobile: '9876543210', frameNumber: 3 },
  { regNum: 'UP2', depot_name: 'B', routename: 'R2' },
];

describe('buildDepotFixture', () => {
  it('writes one gzip of the filtered records and returns the counts', async () => {
    const write = vi.fn<(compressed: Buffer) => void>();
    const fetchPayload = vi.fn(() => Promise.resolve(PAYLOAD));
    const fixture = await buildDepotFixture(fetchPayload, write);

    expect(fetchPayload).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    const written = JSON.parse(gunzipSync(write.mock.calls[0]![0]).toString('utf8')) as unknown;
    expect(written).toEqual([
      { regNum: 'UP1', depot_name: 'A', routename: 'R1' },
      { regNum: 'UP2', depot_name: 'B', routename: 'R2' },
    ]);
    expect(fixture.counts).toMatchObject({ records: 2, depots: 2, routes: 2 });
  });

  it('writes nothing when the fetch fails or the payload is empty', async () => {
    const write = vi.fn<(compressed: Buffer) => void>();
    await expect(buildDepotFixture(() => Promise.reject(new Error('down')), write)).rejects.toThrow();
    await expect(buildDepotFixture(() => Promise.resolve([]), write)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
