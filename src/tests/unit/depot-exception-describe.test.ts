import { describe, expect, it } from 'vitest';
import {
  EXCEPTION_KIND_LABEL,
  SEVERITY_LABEL,
  describeEmptyBusList,
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
  it('says what is counted for a high dark rate', () => {
    expect(describeDepotException(depotException({ affected: 31 }))).toBe(
      'Dark rate 31.0% against a peer median of 12.0%: 31 of 142 buses are dark.',
    );
  });

  it('says what is counted for a high off-road rate', () => {
    expect(
      describeDepotException(
        depotException({ kind: 'off_road_high', value: 0.127, peerMedian: 0.05, affected: 18 }),
      ),
    ).toBe('Off-road rate 12.7% against a peer median of 5.0%: 18 of 142 buses are off road.');
  });

  it('states the on-road share as a share of available buses and reconciles the counts', () => {
    expect(
      describeDepotException(
        depotException({ kind: 'on_road_low', value: 0.31, peerMedian: 0.52, affected: 44 }),
      ),
    ).toBe(
      'On-road share 31.0% of available buses, against a peer median of 52.0%: 44 available buses are not on the road (fleet 142).',
    );
  });

  it('keeps one decimal so a flagged depot never reads as equal to its peers', () => {
    const sentence = describeDepotException(
      depotException({ value: 0.304, peerMedian: 0.296, affected: 5 }),
    );
    expect(sentence).toBe('Dark rate 30.4% against a peer median of 29.6%: 5 of 142 buses are dark.');
  });

  it('leaves out the comparison when there is no peer median', () => {
    expect(describeDepotException(depotException({ peerMedian: null, affected: 31 }))).toBe(
      'Dark rate 31.0%: 31 of 142 buses are dark.',
    );
    expect(
      describeDepotException(
        depotException({ kind: 'on_road_low', peerMedian: null, affected: 44 }),
      ),
    ).toBe('On-road share 31.0% of available buses: 44 available buses are not on the road (fleet 142).');
    expect(
      describeDepotException(depotException({ kind: 'off_road_high', peerMedian: null, affected: 18 })),
    ).toBe('Off-road rate 31.0%: 18 of 142 buses are off road.');
  });

  it('describes a power-cut cluster by its count, with no rate', () => {
    expect(
      describeDepotException(
        depotException({ kind: 'power_cut_cluster', value: 18, peerMedian: null, affected: 18 }),
      ),
    ).toBe('18 of 142 buses report main power off.');
  });

  it('uses singular wording for one bus', () => {
    expect(
      describeDepotException(
        depotException({ kind: 'power_cut_cluster', affected: 1, fleet: 1, value: 1 }),
      ),
    ).toBe('1 of 1 bus reports main power off.');
    expect(describeDepotException(depotException({ affected: 1, fleet: 1 }))).toBe(
      'Dark rate 31.0% against a peer median of 12.0%: 1 of 1 bus is dark.',
    );
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

describe('describeEmptyBusList', () => {
  it('speaks plainly when the list is complete', () => {
    expect(describeEmptyBusList(40, 40)).toBe('No buses match these filters.');
  });

  it('says nothing is flagged when there are no bus exceptions at all', () => {
    expect(describeEmptyBusList(0, 0)).toMatch(/^No bus is flagged on this snapshot/);
  });

  it('qualifies the result when the list is capped', () => {
    expect(describeEmptyBusList(500, 1204)).toBe(
      'None of the 500 listed buses match. The other 704 are not in this list; open a depot to see all of its exceptions.',
    );
  });
});
