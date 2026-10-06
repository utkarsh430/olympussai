import { formatCount, formatFeedTime, formatPercentOneDecimal, pluralWord } from '@/lib/depot/format';
import type { BusException, DepotException } from './types';

export { EXCEPTION_KIND_LABEL, SEVERITY_LABEL } from '@/lib/depot/labels';

function busWord(n: number): string {
  return n === 1 ? 'bus' : 'buses';
}

/** A plain sentence that says what each number counts, built from the exception's own figures. */
export function describeDepotException(e: DepotException): string {
  const affected = formatCount(e.affected);
  const fleet = formatCount(e.fleet);
  const peers = e.peerMedian === null ? '' : ` against a peer median of ${formatPercentOneDecimal(e.peerMedian)}`;
  switch (e.kind) {
    case 'power_cut_cluster':
      return `${affected} of ${fleet} ${busWord(e.fleet)} ${pluralWord(e.affected, 'reports', 'report')} main power off.`;
    case 'on_road_low': {
      // `value` is a share of AVAILABLE buses (fleet minus off-road), so the count is not out of fleet.
      const median = e.peerMedian === null ? '' : `,${peers}`;
      return `On-road share ${formatPercentOneDecimal(e.value)} of available buses${median}: ${affected} available ${busWord(e.affected)} ${pluralWord(e.affected, 'is', 'are')} not on the road (fleet ${fleet}).`;
    }
    case 'dark_share_high':
      return `Dark rate ${formatPercentOneDecimal(e.value)}${peers}: ${affected} of ${fleet} ${busWord(e.fleet)} ${pluralWord(e.affected, 'is', 'are')} dark.`;
    case 'off_road_high':
      return `Off-road rate ${formatPercentOneDecimal(e.value)}${peers}: ${affected} of ${fleet} ${busWord(e.fleet)} ${pluralWord(e.affected, 'is', 'are')} off road.`;
  }
}

function bodyFor(e: BusException): string {
  switch (e.kind) {
    case 'long_dark':
      return 'No signal, or no recent fix.';
    case 'power_cut':
      return 'Main power reads off.';
    case 'emergency':
      return 'Emergency flag set by the device.';
    case 'tamper_code':
      // The raw code only: what it means is not established by the feed.
      return e.detail === null
        ? 'Device reports a tamper code.'
        : `Device reports tamper code "${e.detail}".`;
  }
}

/** One sentence per bus; the registration and depot sit in their own columns. */
export function describeBusException(e: BusException): string {
  const body = bodyFor(e);
  if (e.kind === 'tamper_code') return body;
  const seen = formatFeedTime(e.lastSeen);
  return seen === '—' ? `${body} No last-seen time in the feed.` : `${body} Last seen ${seen}.`;
}
