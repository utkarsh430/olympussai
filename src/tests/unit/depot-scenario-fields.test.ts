import { describe, expect, it } from 'vitest';
import {
  MAX_FLEET_ADJUSTMENT,
  MAX_SPARE_RATIO,
  MAX_SURGE_PERCENT,
  MAX_TRANSFER_KM,
  MIN_SPARE_RATIO,
  MIN_SURGE_PERCENT,
  MIN_TRANSFER_KM,
} from '@/lib/depot/optimise/config';
import { runScenario } from '@/lib/depot/optimise/scenario';
import { FIELD_LABELS, describeClamp } from '@/lib/depot/rebalance/scenarioFields';

const NAMES: Readonly<Record<string, string>> = { 'agra-depot': 'Agra', kanpur: 'Kanpur' };
const nameOf = (id: string): string => NAMES[id] ?? id;

describe('describeClamp', () => {
  it('quotes the spare ratio in percent, as the planner typed it', () => {
    expect(describeClamp('Spare ratio 0.5 was outside 0 to 0.3; using 0.3', nameOf)).toBe(
      'Spare ratio 50% was outside 0% to 30%; using 30%',
    );
  });

  it('quotes the distance in kilometres', () => {
    expect(
      describeClamp('Maximum transfer distance 5000 was outside 25 to 600; using 600', nameOf),
    ).toBe('Maximum transfer distance 5000 km was outside 25 to 600 km; using 600 km');
  });

  it('names the depot instead of quoting its id, with the unit of each change', () => {
    expect(
      describeClamp(
        'Fleet adjustment for agra-depot 900 was outside -500 to 500; using 500',
        nameOf,
      ),
    ).toBe('Change in buses at Agra 900 was outside -500 to 500 buses; using 500');
    expect(
      describeClamp(
        'Fleet adjustment for agra-depot limited to -12: available cannot go below 0',
        nameOf,
      ),
    ).toBe('Change in buses at Agra limited to -12: available buses cannot go below 0');
    expect(
      describeClamp('Demand surge for kanpur totals 150%, outside -50 to 100; using 100', nameOf),
    ).toBe('Demand change at Kanpur totals 150%, outside -50% to 100%; using 100%');
    expect(describeClamp('Demand surge for kanpur ignored: not an operating depot', nameOf)).toBe(
      'Demand change at Kanpur ignored: not an operating depot',
    );
  });

  it('turns every note the engine writes into words without an id or a fraction', () => {
    const balances = [
      {
        depotId: 'agra-depot',
        depotName: 'Agra',
        kind: 'depot',
        position: null,
        fleet: 10,
        offRoad: 0,
        available: 10,
        peakRequirement: 8,
        spareTarget: 1,
        required: 9,
        balance: 1,
      },
    ] as const;
    const outcome = runScenario(balances as never, {
      spareRatio: 0.9,
      maxTransferKm: 9000,
      fleetAdjustments: [{ depotId: 'agra-depot', deltaBuses: -900 }],
      demandSurges: [{ depotId: 'agra-depot', percent: 400 }],
    });
    expect(outcome.clamped.length).toBeGreaterThanOrEqual(4);
    for (const note of outcome.clamped) {
      const text = describeClamp(note, nameOf);
      expect(text).not.toContain('agra-depot');
      expect(text).not.toMatch(/0\.\d/);
    }
  });
});

describe('FIELD_LABELS', () => {
  it('shows each field with the range the optimiser accepts', () => {
    expect(FIELD_LABELS.spare).toBe(
      `Spare ratio, %, ${MIN_SPARE_RATIO * 100} to ${MAX_SPARE_RATIO * 100}`,
    );
    expect(FIELD_LABELS.distance).toBe(
      `Maximum transfer distance, km, ${MIN_TRANSFER_KM} to ${MAX_TRANSFER_KM}`,
    );
    expect(FIELD_LABELS.fleet).toBe(
      `Change in buses, -${MAX_FLEET_ADJUSTMENT} to +${MAX_FLEET_ADJUSTMENT}`,
    );
    expect(FIELD_LABELS.surge).toBe(
      `Demand change, %, ${MIN_SURGE_PERCENT} to +${MAX_SURGE_PERCENT}`,
    );
  });
});
