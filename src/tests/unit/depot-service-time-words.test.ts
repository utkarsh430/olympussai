import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every date and time on the route's hour-by-hour page goes through the module's
 * formatters (`formatPlainDate`, `formatFeedTimeOn`, `formatDurationMinutes`, and the
 * page's own `hourLabel`). This scan fails when one of its files cuts a timestamp by hand
 * or reads a clock.
 */

const ROOT = process.cwd();
const DIRS = ['src/components/depot/hourChart', 'src/components/depot/service'];
const MODELS = ['hourChartModel.ts', 'servicePageModel.ts', 'serviceWording.ts'].map((f) =>
  join('src/lib/depot/service', f),
);

const HAND_MADE_TIME: readonly RegExp[] = [
  /toLocale(Date|Time)?String/,
  /new Date\(/,
  /Date\.now\(/,
  /\.(slice|substring|substr)\(\s*\d+/,
  /getHours|getMinutes|toISOString/,
];

function files(): readonly string[] {
  const components = DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
      .map((name) => join(dir, name)),
  );
  return [...components, ...MODELS];
}

describe('service page time words', () => {
  it('scans the page files', () => {
    expect(files().length).toBeGreaterThanOrEqual(10);
  });

  it.each(files())('%s cuts no timestamp by hand and reads no clock', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const found = HAND_MADE_TIME.filter((pattern) => pattern.test(source)).map(String);
    expect(found).toEqual([]);
  });

  it('pads an hour only in the hour formatter', () => {
    const padded = files().filter((file) => /padStart\(/.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(padded).toEqual(['src/lib/depot/service/serviceWording.ts']);
  });
});
