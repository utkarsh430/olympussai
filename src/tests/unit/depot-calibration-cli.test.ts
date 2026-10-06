import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WAIT_MIN,
  parseCalibrationArgs,
  parseSnapshotText,
} from '@/lib/depot/maintenance/calibrationCli';

describe('parseCalibrationArgs', () => {
  it('takes two saved snapshots as positional files', () => {
    expect(parseCalibrationArgs(['a.json', 'b.json'])).toEqual({
      ok: true,
      mode: { kind: 'files', first: 'a.json', second: 'b.json' },
      outPath: null,
    });
  });

  it('takes the live feed with a default wait', () => {
    expect(parseCalibrationArgs(['--live'])).toEqual({
      ok: true,
      mode: { kind: 'live', waitMin: DEFAULT_WAIT_MIN },
      outPath: null,
    });
  });

  it('accepts a wait and an explicit output path', () => {
    const parsed = parseCalibrationArgs(['--live', '--wait-min', '7', '--out', 'r.json']);
    expect(parsed).toEqual({
      ok: true,
      mode: { kind: 'live', waitMin: 7 },
      outPath: 'r.json',
    });
  });

  it.each([
    [[]],
    [['a.json']],
    [['a.json', 'b.json', 'c.json']],
    [['--live', 'a.json']],
    [['--live', '--wait-min', 'soon']],
    [['--live', '--wait-min', '0']],
    [['--live', '--out']],
    [['--bogus']],
  ])('rejects %j with a usage message', (argv) => {
    const parsed = parseCalibrationArgs(argv);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('Usage');
  });
});

describe('parseSnapshotText', () => {
  const ROW = {
    registrationNumber: 'UP32A0001',
    latitude: 26.85,
    longitude: 80.95,
    speedKmph: 0,
    ignitionOn: null,
    gpsTimestamp: null,
    receivedAt: null,
    depotId: '1',
    depotName: null,
    vehicleStatus: 'live',
    tripStatus: null,
    routeId: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: 10,
    mainPowerOn: null,
    mainVoltage: null,
    tamperCode: null,
    emergency: null,
  };

  it('reads an array of rows or an object holding rows', () => {
    expect(parseSnapshotText(JSON.stringify([ROW]))).toEqual({ ok: true, rows: [ROW] });
    expect(parseSnapshotText(JSON.stringify({ rows: [ROW] }))).toEqual({ ok: true, rows: [ROW] });
  });

  it('refuses malformed text without echoing any of it', () => {
    const parsed = parseSnapshotText('{"secret": UP32A0001');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).not.toContain('UP32A0001');
  });

  it('refuses rows that do not fit the schema without echoing them', () => {
    const parsed = parseSnapshotText(JSON.stringify([{ ...ROW, registrationNumber: '' }]));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('depot bus rows');
  });
});
