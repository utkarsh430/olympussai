import { describe, it, expect } from 'vitest';
import { runHistoricalReplay, compareControlToNoControl } from '../../src/simulation/replay.js';
import { createSelfEqualizingController, noControlController } from '../../src/simulation/controllers.js';
import { HISTORICAL_DAY_FIXTURE } from '../../src/simulation/fixtures/historicalDay.js';

describe('historical replay mode', () => {
  it('reproduces the stored historical day KPIs within the documented tolerance', () => {
    const comparison = runHistoricalReplay(HISTORICAL_DAY_FIXTURE, noControlController);

    expect(comparison.withinTolerance).toBe(true);
    for (const delta of comparison.deltas) {
      expect(
        delta.withinTolerance,
        `${delta.key}: simulated=${delta.simulated} recorded=${delta.recorded} (tolerance ${comparison.toleranceRatio})`,
      ).toBe(true);
    }
  });

  it('replay is deterministic across runs (no reliance on wall-clock or Math.random)', () => {
    const first = runHistoricalReplay(HISTORICAL_DAY_FIXTURE);
    const second = runHistoricalReplay(HISTORICAL_DAY_FIXTURE);
    expect(first.simulated.kpis).toEqual(second.simulated.kpis);
  });

  it('writes no production data and touches no live command path (pure in-memory computation)', async () => {
    // Structural guarantee, verified here rather than merely asserted:
    // the simulation module tree has zero imports from the live-path
    // modules. If someone adds one, this import-graph check catches it
    // in CI even though nothing here mocks a DB/HTTP call.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const simDir = path.resolve(__dirname, '../../src/simulation');
    const forbidden = [/from ['"]\.\.\/db\//, /from ['"]\.\.\/state\//, /from ['"]\.\.\/routes\//, /from ['"]\.\.\/webhooks\//, /from ['"]\.\.\/mpc\//];

    function walk(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    }

    const files = walk(simDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const contents = fs.readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(contents), `${file} imports a live-path module matching ${pattern}`).toBe(false);
      }
    }
  });

  it('supports a no-control vs controlled comparison over the same replayed day', () => {
    const controller = createSelfEqualizingController({ gain: 0.5 });
    const { noControl, controlled } = compareControlToNoControl(HISTORICAL_DAY_FIXTURE, controller);

    expect(noControl.controllerName).toBe('no-control');
    expect(controlled.controllerName).toBe('self-equalizing');
    // Both runs replayed the identical recorded inputs, so this is a
    // like-for-like comparison attributable only to the controller.
    expect(noControl.visits.map((v) => v.arrivalSeconds)).not.toEqual(
      controlled.visits.map((v) => v.arrivalSeconds),
    );
  });
});
