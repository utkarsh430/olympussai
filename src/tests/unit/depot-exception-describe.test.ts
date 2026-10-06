import { describe, expect, it } from 'vitest';
import {
  EXCEPTION_KIND_LABEL,
  SEVERITY_LABEL,
  describeBusException,
  describeDepotException,
} from '@/lib/depot/exceptions/describe';
import type { BusException, DepotException, ExceptionKind } from '@/lib/depot/exceptions/types';

function depotException(overrides: Partial<DepotException>): DepotException {
  return {
    id: 'dark_share_high:7',
    depotId: '7',
    depotName: 'Pune',
    kind: 'dark_share_high',
    severity: 'warning',
    value: 0.31,
    peerMedian: 0.12,
    z: 2.1,
    affected: 44,
    fleet: 142,
    ...overrides,
  };
}

function busException(overrides: Partial<BusException>): BusException {
  return {
    id: 'long_dark:MH12AB1234',
    registrationNumber: 'MH12AB1234',
    depotId: '7',
    depotName: 'Pune',
    kind: 'long_dark',
    severity: 'warning',
    lastSeen: '2026-10-06T14:02:11Z',
    detail: null,
    ...overrides,
  };
}

describe('describeDepotException', () => {
  it('states the rate, the peer median and the bus counts', () => {
    expect(describeDepotException(depotException({}))).toBe(
      'Dark rate 31% against a peer median of 12%: 44 of 142 buses.',
    );
  });

  it('names the measure for each rate kind', () => {
    expect(describeDepotException(depotException({ kind: 'off_road_high' }))).toMatch(
      /^Off-road rate 31%/,
    );
    expect(describeDepotException(depotException({ kind: 'on_road_low' }))).toMatch(
      /^On-road share 31%/,
    );
  });

  it('leaves out the comparison when there is no peer median', () => {
    expect(describeDepotException(depotException({ peerMedian: null }))).toBe(
      'Dark rate 31%: 44 of 142 buses.',
    );
  });

  it('describes a power-cut cluster by its count, not as a rate', () => {
    const sentence = describeDepotException(
      depotException({ kind: 'power_cut_cluster', value: 12, peerMedian: null, affected: 12 }),
    );
    expect(sentence).toBe('Main power reads off on 12 of 142 buses.');
  });

  it('uses singular wording for one bus', () => {
    const sentence = describeDepotException(
      depotException({ kind: 'power_cut_cluster', affected: 1, fleet: 1, value: 1 }),
    );
    expect(sentence).toBe('Main power reads off on 1 of 1 bus.');
  });
});

describe('describeBusException', () => {
  it('says a long-dark bus is dark and when it was last heard', () => {
    expect(describeBusException(busException({}))).toBe(
      'No signal, or no recent fix. Last seen 14:02.',
    );
  });

  it('says so when there is no last-seen time', () => {
    expect(describeBusException(busException({ lastSeen: null }))).toBe(
      'No signal, or no recent fix. No last-seen time in the feed.',
    );
  });

  it('states a tamper code raw, without saying what it means', () => {
    const sentence = describeBusException(
      busException({ kind: 'tamper_code', detail: 'W', lastSeen: null }),
    );
    expect(sentence).toBe('Device reports tamper code "W".');
    expect(sentence).not.toMatch(/tamper(ed|ing)|fault|theft|fraud/i);
  });

  it('describes power cut and emergency flags', () => {
    expect(describeBusException(busException({ kind: 'power_cut' }))).toBe(
      'Main power reads off. Last seen 14:02.',
    );
    expect(describeBusException(busException({ kind: 'emergency' }))).toBe(
      'Emergency flag set by the device. Last seen 14:02.',
    );
  });

  it('never mentions a person', () => {
    const kinds = ['long_dark', 'power_cut', 'tamper_code', 'emergency'] as const;
    for (const kind of kinds) {
      expect(describeBusException(busException({ kind, detail: 'C' }))).not.toMatch(
        /driver|conductor|crew|staff|operator/i,
      );
    }
  });
});

describe('labels', () => {
  it('has a label for every kind and severity, without the banned word', () => {
    const kinds: ExceptionKind[] = [
      'dark_share_high',
      'off_road_high',
      'on_road_low',
      'power_cut_cluster',
      'long_dark',
      'power_cut',
      'tamper_code',
      'emergency',
    ];
    for (const kind of kinds) expect(EXCEPTION_KIND_LABEL[kind].length).toBeGreaterThan(0);
    expect(SEVERITY_LABEL).toEqual({ critical: 'Critical', warning: 'Warning', info: 'Info' });
    expect(JSON.stringify(EXCEPTION_KIND_LABEL).toLowerCase()).not.toContain('simulated');
  });
});
