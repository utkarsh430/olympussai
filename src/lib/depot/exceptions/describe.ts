import { formatCount, formatFeedTime } from '@/lib/depot/format';
import type {
  BusException,
  DepotException,
  DepotExceptionKind,
  ExceptionKind,
  ExceptionSeverity,
} from './types';

/** Short names for the counts strip and the kind filter. */
export const EXCEPTION_KIND_LABEL: Readonly<Record<ExceptionKind, string>> = {
  dark_share_high: 'High dark rate',
  off_road_high: 'High off-road rate',
  on_road_low: 'Low on-road share',
  power_cut_cluster: 'Power-off cluster',
  long_dark: 'Long dark',
  power_cut: 'Power off',
  tamper_code: 'Tamper code',
  emergency: 'Emergency flag',
};

/** Severity is always shown as a word; colour only reinforces it. */
export const SEVERITY_LABEL: Readonly<Record<ExceptionSeverity, string>> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

const PERCENT = 100;

const RATE_MEASURE: Readonly<Record<Exclude<DepotExceptionKind, 'power_cut_cluster'>, string>> = {
  dark_share_high: 'Dark rate',
  off_road_high: 'Off-road rate',
  on_road_low: 'On-road share',
};

function percent(rate: number): string {
  return `${Math.round(rate * PERCENT)}%`;
}

function busesPhrase(affected: number, fleet: number): string {
  return `${formatCount(affected)} of ${formatCount(fleet)} ${fleet === 1 ? 'bus' : 'buses'}`;
}

/** A plain sentence built from the exception's own numbers. */
export function describeDepotException(e: DepotException): string {
  if (e.kind === 'power_cut_cluster') {
    return `Main power reads off on ${busesPhrase(e.affected, e.fleet)}.`;
  }
  const comparison = e.peerMedian === null ? '' : ` against a peer median of ${percent(e.peerMedian)}`;
  return `${RATE_MEASURE[e.kind]} ${percent(e.value)}${comparison}: ${busesPhrase(e.affected, e.fleet)}.`;
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
