import { formatCount } from '../format';
import { EXCEPTION_KIND_LABEL, SEVERITY_LABEL } from '../labels';
import { EXCEPTION_KINDS, SEVERITY_ORDER } from './config';
import type {
  BusExceptionKind,
  DepotException,
  DepotExceptionKind,
  ExceptionKind,
  ExceptionSeverity,
} from './types';

/**
 * The exceptions page's grouping, paging arithmetic and sentences. Every total
 * names its scope (depot or bus exceptions), and the bus list states the true
 * total for its filter, never the size of a capped list.
 */

export const DEPOT_GROUP_CAP = 25;
const SEP = ' · ';
const SEVERITIES: readonly ExceptionSeverity[] = ['critical', 'warning', 'info'];

/** The `?kind=` parameter, accepted only when it names a known kind. */
export function parseKindParam(value: string | null): ExceptionKind | null {
  return EXCEPTION_KINDS.find((kind) => kind === value) ?? null;
}

export interface DepotExceptionGroup {
  readonly depotId: string;
  readonly depotName: string;
  /** The worst severity among the depot's exceptions. */
  readonly severity: ExceptionSeverity;
  /** Worst first, then by kind label. */
  readonly exceptions: readonly DepotException[];
}

function bySeverityThenLabel(a: DepotException, b: DepotException): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    EXCEPTION_KIND_LABEL[a.kind].localeCompare(EXCEPTION_KIND_LABEL[b.kind], 'en')
  );
}

/** One row per depot, worst severity first, then most exceptions, then name. */
export function groupDepotExceptions(
  list: readonly DepotException[],
  kind: DepotExceptionKind | null,
): DepotExceptionGroup[] {
  const byDepot = new Map<string, DepotException[]>();
  for (const e of list) {
    if (kind !== null && e.kind !== kind) continue;
    byDepot.set(e.depotId, [...(byDepot.get(e.depotId) ?? []), e]);
  }
  return [...byDepot.entries()]
    .map(([depotId, items]): DepotExceptionGroup => {
      const exceptions = [...items].sort(bySeverityThenLabel);
      const worst = exceptions[0] as DepotException;
      return { depotId, depotName: worst.depotName, severity: worst.severity, exceptions };
    })
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.exceptions.length - a.exceptions.length ||
        a.depotName.localeCompare(b.depotName, 'en'),
    );
}

export interface SeveritySection {
  readonly severity: ExceptionSeverity;
  /** "Critical · 4 depots" (the group-row "·" form). */
  readonly heading: string;
  /** Critical is always open; a lesser section only when nothing worse exists. */
  readonly open: boolean;
  readonly groups: readonly DepotExceptionGroup[];
}

export function severitySections(groups: readonly DepotExceptionGroup[]): SeveritySection[] {
  const sections = SEVERITIES.map((severity) => ({
    severity,
    groups: groups.filter((g) => g.severity === severity),
  })).filter((s) => s.groups.length > 0);
  return sections.map((s, i) => ({
    ...s,
    heading: `${SEVERITY_LABEL[s.severity]}${SEP}${formatCount(s.groups.length)} ${
      s.groups.length === 1 ? 'depot' : 'depots'
    }`,
    open: i === 0,
  }));
}

/** The first 25 rows, and how many a "Show all" control would add. */
export function capGroups<T>(
  items: readonly T[],
  showAll: boolean,
  cap: number = DEPOT_GROUP_CAP,
): { readonly shown: readonly T[]; readonly hidden: number } {
  if (showAll || items.length <= cap) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, cap), hidden: items.length - cap };
}

function severityBracket(counts: Readonly<Record<ExceptionSeverity, number>>): string {
  const parts = SEVERITIES.filter((s) => counts[s] > 0).map(
    (s) => `${formatCount(counts[s])} ${SEVERITY_LABEL[s].toLowerCase()}`,
  );
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

/** "73 depot exceptions (4 critical, 69 warning) · 1,968 bus exceptions (43 critical, …)". */
export function exceptionTotalsLine(
  depot: readonly DepotException[],
  busTotal: number | null,
  busSeverity: Readonly<Record<ExceptionSeverity, number>> | null,
): string {
  const depotSeverity: Record<ExceptionSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const e of depot) depotSeverity[e.severity] += 1;
  const depotPart = `${formatCount(depot.length)} depot ${
    depot.length === 1 ? 'exception' : 'exceptions'
  }${severityBracket(depotSeverity)}`;
  // One depot's bus severities are not sent, and its bus total may still be loading.
  if (busTotal === null) return depotPart;
  const busPart = `${formatCount(busTotal)} bus ${
    busTotal === 1 ? 'exception' : 'exceptions'
  }${busSeverity === null ? '' : severityBracket(busSeverity)}`;
  return `${depotPart}${SEP}${busPart}`;
}

const BUS_KIND_NOUN: Readonly<Record<BusExceptionKind | 'any', readonly [string, string]>> = {
  any: ['bus exception', 'bus exceptions'],
  long_dark: ['long dark bus', 'long dark buses'],
  power_cut: ['bus with main power off', 'buses with main power off'],
  tamper_code: ['bus with a tamper code', 'buses with a tamper code'],
  emergency: ['bus with the emergency flag', 'buses with the emergency flag'],
};

export interface BusRangeInput {
  readonly kind: BusExceptionKind | null;
  readonly offset: number;
  readonly total: number;
  /** Rows on this page. */
  readonly shown: number;
}

/** "Showing 1–25 of 698 long dark buses", with "at MEERUT" when a depot is chosen. */
export function busRangeSentence(page: BusRangeInput, depotName: string | null): string {
  const [one, many] = BUS_KIND_NOUN[page.kind ?? 'any'];
  const where = depotName === null ? '' : ` at ${depotName}`;
  if (page.total === 0 || page.shown === 0) {
    return page.total === 0
      ? `No ${many}${where} on this snapshot`
      : `No rows on this page; ${formatCount(page.total)} ${many}${where} in all`;
  }
  const first = page.offset + 1;
  const last = page.offset + page.shown;
  const noun = page.total === 1 ? one : many;
  return `Showing ${formatCount(first)}–${formatCount(last)} of ${formatCount(page.total)} ${noun}${where}`;
}

/** Offsets for Previous and Next; null where there is no such page. */
export function pageMoves(page: {
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
}): { readonly previous: number | null; readonly next: number | null } {
  const lastStart = page.total === 0 ? 0 : Math.floor((page.total - 1) / page.limit) * page.limit;
  // An empty list has no earlier page, whatever offset a poll left behind.
  const previous =
    page.offset === 0 || page.total === 0
      ? null
      : Math.min(Math.max(0, page.offset - page.limit), lastStart);
  const next = page.offset + page.limit < page.total ? page.offset + page.limit : null;
  return { previous, next };
}

/**
 * Said above the page that stays on screen when a newer query failed. The
 * reason is the hook's fixed wording, never server text.
 */
export function failedQuerySentence(reason: string): string {
  return `Could not load that page: ${reason}. Showing the last answer that loaded.`;
}

// ---- Page wording added by the design wave -------------------------------

/**
 * Why the group counts and the total differ: a depot can hold more than one exception.
 * Counted from the very groups the page draws (after any kind filter), never from the raw
 * list, so the sentence and the severity groups add up at every moment (capture item 8).
 */
export function depotScopeLine(groups: readonly DepotExceptionGroup[]): string {
  const exceptions = groups.reduce((n, g) => n + g.exceptions.length, 0);
  if (exceptions === groups.length) return '';
  return `${formatCount(exceptions)} exceptions in ${formatCount(groups.length)} depots: a depot is listed once, under its worst level.`;
}

/** The query string for a kind filter: `?kind=long_dark`, or the bare path when cleared. */
export function kindSearch(search: string, kind: ExceptionKind | null): string {
  const params = new URLSearchParams(search);
  if (kind === null) params.delete('kind');
  else params.set('kind', kind);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export interface BusColumnPlan {
  /** A constant column is dropped: the kind column is shown only while every kind is listed. */
  readonly showKind: boolean;
  /** The raw code column exists only when some row carries one. */
  readonly showCode: boolean;
}

export function busColumnPlan(
  kind: BusExceptionKind | null,
  rows: readonly { readonly detail: string | null }[],
): BusColumnPlan {
  return { showKind: kind === null, showCode: rows.some((r) => r.detail !== null) };
}
