import { describeDepotException } from '@/lib/depot/exceptions/describe';
import type {
  BusException,
  BusExceptionKind,
  DepotException,
  ExceptionSeverity,
} from '@/lib/depot/exceptions/types';
import { formatCount } from '@/lib/depot/format';
import { EXCEPTION_KIND_LABEL, SEVERITY_LABEL } from '@/lib/depot/labels';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import type { RosterFilters } from '@/lib/depot/roster/rosterModel';
import { rosterFilterHref } from '@/lib/depot/roster/rosterQuery';
import type { ScoreWindow } from '@/lib/depot/score/types';
import { scoreWindowPhrase } from '@/lib/depot/score/windowWords';

/**
 * The cockpit's exceptions: bus exceptions merged per bus (one row per bus, its
 * kinds as words) and grouped under the bus's most severe kind; depot exceptions
 * as lines that say which figure is windowed and which is now.
 */

const SEVERITY_ORDER: readonly ExceptionSeverity[] = ['critical', 'warning', 'info'];
const KIND_ORDER: readonly BusExceptionKind[] = ['emergency', 'long_dark', 'power_cut', 'tamper_code'];

/** Where "Show all" goes for each kind: the roster filtered, or the page that owns the list. */
const KIND_FILTER: Readonly<Record<BusExceptionKind, Partial<RosterFilters> | null>> = {
  emergency: null,
  long_dark: { states: ['dark'] },
  power_cut: { flag: 'power_off' },
  tamper_code: { flag: 'tamper' },
};

export interface ExceptionBusRow {
  readonly registrationNumber: string;
  readonly severity: ExceptionSeverity;
  readonly severityLabel: string;
  /** Every kind the bus carries, as words: "Long dark · Power off". */
  readonly kinds: string;
  readonly lastSeen: string | null;
}

export interface ExceptionGroup {
  readonly kind: BusExceptionKind;
  readonly heading: string;
  readonly rows: readonly ExceptionBusRow[];
  readonly href: string;
}

function rank(e: BusException): number {
  return SEVERITY_ORDER.indexOf(e.severity) * KIND_ORDER.length + KIND_ORDER.indexOf(e.kind);
}

export function groupBusExceptions(
  exceptions: readonly BusException[],
  depotId: string,
): readonly ExceptionGroup[] {
  const byBus = new Map<string, BusException[]>();
  for (const e of exceptions) {
    byBus.set(e.registrationNumber, [...(byBus.get(e.registrationNumber) ?? []), e]);
  }
  const rows = [...byBus.entries()].map(([registrationNumber, list]) => {
    const sorted = [...list].sort((a, b) => rank(a) - rank(b));
    const primary = sorted[0] as BusException;
    const kinds = [...new Set(sorted.map((e) => EXCEPTION_KIND_LABEL[e.kind]))].join(' · ');
    const lastSeen = sorted.find((e) => e.lastSeen !== null)?.lastSeen ?? null;
    return {
      primary,
      row: {
        registrationNumber,
        severity: primary.severity,
        severityLabel: SEVERITY_LABEL[primary.severity],
        kinds,
        lastSeen,
      },
    };
  });
  return KIND_ORDER.map((kind) => {
    const members = rows
      .filter((r) => r.primary.kind === kind)
      .sort((a, b) => rank(a.primary) - rank(b.primary) || a.row.registrationNumber.localeCompare(b.row.registrationNumber, 'en'))
      .map((r) => r.row);
    const filter = KIND_FILTER[kind];
    return {
      kind,
      heading: EXCEPTION_KIND_LABEL[kind],
      rows: members,
      href: filter === null ? `${DEPOTS_ROOT}/exceptions?kind=${kind}` : rosterFilterHref(depotId, filter),
    };
  })
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.rows[0]!.severity) - SEVERITY_ORDER.indexOf(b.rows[0]!.severity));
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
      sentence: describeDepotException(e),
      windowNote:
        e.kind === 'power_cut_cluster' || span === null
          ? null
          : `Rate ${span}; ${formatCount(e.affected)} ${e.affected === 1 ? 'bus' : 'buses'} affected now.`,
    }));
}
