import { describe, it, expect } from 'vitest';
import {
  CalibrationError,
  DEFAULT_WAIT_MIN,
  MIN_WAIT_MIN,
  describeFailure,
  outputPathProblem,
  parseCalibrationArgs,
  snapshotSourceProblem,
  parseSnapshotText,
} from '@/lib/depot/maintenance/calibrationCli';

describe('parseCalibrationArgs', () => {
  it('takes two saved snapshots as positional files', () => {
    expect(parseCalibrationArgs(['a.json', 'b.json'])).toEqual({
      ok: true,
      mode: { kind: 'files', first: 'a.json', second: 'b.json' },
      outPath: null,
      force: false,
    });
  });

  it('takes the live feed with a default wait', () => {
    expect(parseCalibrationArgs(['--live'])).toEqual({
      ok: true,
      mode: { kind: 'live', waitMin: DEFAULT_WAIT_MIN },
      outPath: null,
      force: false,
    });
  });

  it('accepts a wait and an explicit output path', () => {
    const parsed = parseCalibrationArgs(['--live', '--wait-min', '7', '--out', 'r.json']);
    expect(parsed).toEqual({
      ok: true,
      mode: { kind: 'live', waitMin: 7 },
      outPath: 'r.json',
      force: false,
    });
  });

  it('accepts --force anywhere and records it', () => {
    const parsed = parseCalibrationArgs(['--force', 'a.json', 'b.json', '--out', 'r.json']);
    expect(parsed).toMatchObject({ ok: true, outPath: 'r.json', force: true });
  });

  it('allows exactly the minimum wait and refuses anything shorter', () => {
    expect(MIN_WAIT_MIN).toBe(1);
    expect(parseCalibrationArgs(['--live', '--wait-min', '1'])).toMatchObject({
      ok: true,
      mode: { kind: 'live', waitMin: 1 },
    });
    for (const short of ['0.99', '0.01']) {
      const parsed = parseCalibrationArgs(['--live', '--wait-min', short]);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain('at least 1 minute');
    }
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

describe('outputPathProblem', () => {
  const exists = (path: string): boolean => path === 'taken.json';

  it('has no problem without an output path, or with a free one', () => {
    expect(outputPathProblem(null, false, exists)).toBeNull();
    expect(outputPathProblem('free.json', false, exists)).toBeNull();
  });

  it('refuses an existing file unless --force is given', () => {
    expect(outputPathProblem('taken.json', false, exists)).toBe(
      'The output file already exists. Choose another path, or add --force to replace it.',
    );
    expect(outputPathProblem('taken.json', true, exists)).toBeNull();
  });
});

describe('snapshotSourceProblem', () => {
  it('stops with a sentence when the app is serving its sample data', () => {
    expect(snapshotSourceProblem('fixture')).toBe(
      'The app is serving its built-in sample data, which says nothing about the unit. ' +
        'Connect it to the live feed and run this again.',
    );
  });

  it('accepts live and cached snapshots', () => {
    expect(snapshotSourceProblem('live')).toBeNull();
    expect(snapshotSourceProblem('cache')).toBeNull();
  });
});

describe('describeFailure', () => {
  it('prints a message the script raised itself', () => {
    expect(describeFailure(new CalibrationError('Both snapshots are the same.'))).toBe(
      'Both snapshots are the same.',
    );
  });

  it('never prints an upstream message: a fixed sentence and the error name only', () => {
    const upstream = new TypeError('fetch failed: https://10.0.0.7/feed?token=abc');
    const text = describeFailure(upstream);
    expect(text).toBe('Calibration failed (TypeError). The error message is not shown.');
    expect(text).not.toContain('token');
    expect(text).not.toContain('10.0.0.7');
    expect(describeFailure('plain string with token=abc')).toBe(
      'Calibration failed (unknown error). The error message is not shown.',
    );
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
