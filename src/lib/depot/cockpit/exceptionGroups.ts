import { describeDepotException } from '@/lib/depot/exceptions/describe';
import type {
  BusException,
  BusExceptionKind,
  DepotException,
  ExceptionSeverity,
} from '@/lib/depot/exceptions/types';
import { formatCount } from '@/lib/depot/format';
import { EXCEPTION_KIND_LABEL, SEVERITY_LABEL } from '@/lib/depot/labels';
import type { ScoreWindow } from '@/lib/depot/score/types';
import { scoreWindowPhrase } from '@/lib/depot/score/windowWords';

/**
 * The cockpit's exceptions: bus exceptions merged per bus (one row per bus) and grouped
 * under the bus's most severe kind, the group saying its kind and severity once; depot
 * exceptions as lines that say which figure is windowed and which is now.
 */

const SEVERITY_ORDER: readonly ExceptionSeverity[] = ['critical', 'warning', 'info'];
const KIND_ORDER: readonly BusExceptionKind[] = ['emergency', 'long_dark', 'power_cut', 'tamper_code'];

/**
 * Each bus is listed once, under its most severe kind, so a group holds fewer buses than
 * carry its kind: the heading says which buses it lists (one count, one meaning).
 */
const GROUP_HEADING: Readonly<Record<BusExceptionKind, string>> = {
  emergency: 'Emergency flag',
  long_dark: 'Long dark, no emergency flag',
  power_cut: 'Power off, not long dark, no emergency flag',
  tamper_code: 'Tamper code only',
};

export interface ExceptionBusRow {
  readonly registrationNumber: string;
  readonly severity: ExceptionSeverity;
  /** The kinds beyond the group's own, as words: "+ Power off"; null when none. */
  readonly extra: string | null;
  readonly lastSeen: string | null;
}

export interface ExceptionGroup {
  readonly kind: BusExceptionKind;
  readonly heading: string;
  /** Uniform within a group (the kind fixes it), so it is said once, on the heading. */
  readonly severity: ExceptionSeverity;
  readonly severityLabel: string;
  readonly rows: readonly ExceptionBusRow[];
}

function rank(e: BusException): number {
  return SEVERITY_ORDER.indexOf(e.severity) * KIND_ORDER.length + KIND_ORDER.indexOf(e.kind);
}

interface RankedRow {
  readonly primary: BusException;
  readonly row: ExceptionBusRow;
}

function mergeBus(registrationNumber: string, list: readonly BusException[]): RankedRow {
  const sorted = [...list].sort((a, b) => rank(a) - rank(b));
  const primary = sorted[0] as BusException;
  const others = [...new Set(sorted.map((e) => e.kind))].filter((k) => k !== primary.kind);
  const extra =
    others.length === 0 ? null : `+ ${others.map((k) => EXCEPTION_KIND_LABEL[k]).join(' · ')}`;
  const lastSeen = sorted.find((e) => e.lastSeen !== null)?.lastSeen ?? null;
  return { primary, row: { registrationNumber, severity: primary.severity, extra, lastSeen } };
}

export function groupBusExceptions(
  exceptions: readonly BusException[],
): readonly ExceptionGroup[] {
  const byBus = new Map<string, BusException[]>();
  for (const e of exceptions) {
    byBus.set(e.registrationNumber, [...(byBus.get(e.registrationNumber) ?? []), e]);
  }
  const rows = [...byBus.entries()].map(([reg, list]) => mergeBus(reg, list));
  return KIND_ORDER.map((kind) => {
    const members = rows
      .filter((r) => r.primary.kind === kind)
      .sort(
        (a, b) =>
          rank(a.primary) - rank(b.primary) ||
          a.row.registrationNumber.localeCompare(b.row.registrationNumber, 'en'),
      )
      .map((r) => r.row);
    const severity = members[0]?.severity ?? 'info';
    return {
      kind,
      heading: GROUP_HEADING[kind],
      severity,
      severityLabel: SEVERITY_LABEL[severity],
      rows: members,
    };
  })
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

export interface DepotExceptionLine {
  readonly id: string;
  readonly severity: ExceptionSeverity;
  readonly severityLabel: string;
  readonly label: string;
  readonly sentence: string;
  /** For a rate compared with peers: the window it covers and that the count is now. */
  readonly windowNote: string | null;
}

/**
 * The cluster counts buses not off the road, a narrower set than the attention line's
 * "main power off" (every bus); its sentence names that set so one phrase keeps one count.
 */
function depotSentence(e: DepotException): string {
  if (e.kind !== 'power_cut_cluster') return describeDepotException(e);
  const verb = e.affected === 1 ? 'reports' : 'report';
  return `${formatCount(e.affected)} of ${formatCount(e.fleet)} buses that are not off the road ${verb} main power off.`;
}

export function depotExceptionLines(
  exceptions: readonly DepotException[],
  window: ScoreWindow | null | undefined,
  feedNow: string | null,
): readonly DepotExceptionLine[] {
  const span = window ? scoreWindowPhrase(window, feedNow) : null;
  return [...exceptions]
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .map((e) => ({
      id: e.id,
      severity: e.severity,
      severityLabel: SEVERITY_LABEL[e.severity],
      label: EXCEPTION_KIND_LABEL[e.kind],
      sentence: depotSentence(e),
      windowNote:
        e.kind === 'power_cut_cluster' || span === null
          ? null
          : `Rate ${span}; ${formatCount(e.affected)} ${e.affected === 1 ? 'bus' : 'buses'} affected now.`,
    }));
}
