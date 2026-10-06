import type { DepotDetailResponse, VisitorBus } from '@/lib/depot/api';
import {
  describeBusException,
  describeDepotException,
  SEVERITY_LABEL,
} from '@/lib/depot/exceptions/describe';
import type { ExceptionSeverity } from '@/lib/depot/exceptions/types';
import { BUS_STATE_LABEL, DEPOT_KIND_LABEL } from '@/lib/depot/labels';
import {
  buildLeagueRows,
  PEER_GROUP_LABEL,
  unrankedSentence,
} from '@/lib/depot/league/leagueModel';
import type { DepotScore } from '@/lib/depot/score/types';
import type { DepotSummary } from '@/lib/depot/types';
import type { CockpitHeader, CockpitModel, ExceptionLine, VisitorRow } from './cockpitTypes';
import { buildAttention } from './attention';
import { availabilitySegments, availabilityText, yardLine } from './availability';
import { depotExceptionLines, groupBusExceptions } from './exceptionGroups';
import { indexMeta, type IndexMeta } from './indexMeta';
import { buildBoard, describeYard } from './statusBoard';
import { buildTracker, coverageSentence, feedDateOf, noSchedulesSentence } from './outshedTracker';

/**
 * What a depot manager sees first on a shift: the cockpit's figures, derived
 * from one `DepotDetailResponse`. Pure, so every ordering and sentence is tested;
 * the components only render what this returns.
 */

export type * from './cockpitTypes';
export { coverageSentence, OUTSHED_STATE_LABEL } from './outshedTracker';

const SEVERITY_ORDER: readonly ExceptionSeverity[] = ['critical', 'warning', 'info'];

function buildHeader(depot: DepotSummary, score: DepotScore | null): CockpitHeader {
  const base = { name: depot.name, kindLabel: DEPOT_KIND_LABEL[depot.kind], fleet: depot.fleet };
  const row = score === null ? undefined : buildLeagueRows([depot], [score])[0];
  if (row === undefined) {
    return {
      ...base,
      ranked: false,
      index: null,
      rank: null,
      peerCount: null,
      peerGroupLabel: null,
      unrankedReason: 'No score is available for this depot.',
    };
  }
  return {
    ...base,
    ranked: row.ranked,
    index: row.index,
    rank: row.rank,
    peerCount: row.peerCount,
    peerGroupLabel: row.peerGroup === null ? null : PEER_GROUP_LABEL[row.peerGroup],
    // Reuses the league's wording so the two pages never explain a missing rank differently.
    unrankedReason: unrankedSentence(row),
  };
}

function buildExceptions(exceptions: DepotDetailResponse['exceptions']): ExceptionLine[] {
  const lines: ExceptionLine[] = [
    ...exceptions.depot.map((e) => ({
      id: e.id,
      severity: e.severity,
      severityLabel: SEVERITY_LABEL[e.severity],
      subject: 'Depot',
      registrationNumber: null,
      sentence: describeDepotException(e),
    })),
    ...exceptions.bus.map((e) => ({
      id: e.id,
      severity: e.severity,
      severityLabel: SEVERITY_LABEL[e.severity],
      subject: e.registrationNumber,
      registrationNumber: e.registrationNumber,
      sentence: describeBusException(e),
    })),
  ];
  // Stable sort: within a severity, depot-wide lines keep their place before bus lines.
  return lines.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

function buildVisitors(visitors: readonly VisitorBus[]): VisitorRow[] {
  return visitors
    .map((v) => ({
      registrationNumber: v.registrationNumber,
      homeDepotId: v.homeDepotId,
      homeDepotLabel:
        v.homeDepotName ?? (v.homeDepotId ? `Depot ${v.homeDepotId}` : 'No home depot in the feed'),
      stateLabel: BUS_STATE_LABEL[v.state],
    }))
    .sort(
      (a, b) =>
        a.homeDepotLabel.localeCompare(b.homeDepotLabel, 'en') ||
        a.registrationNumber.localeCompare(b.registrationNumber, 'en'),
    );
}

/** The header's index meta line alone, for the page header (outside the cockpit body). */
export function cockpitIndexMeta(detail: DepotDetailResponse): IndexMeta {
  const header = buildHeader(detail.depot, detail.score);
  return indexMeta(header, detail.scoreWindow, detail.feedNow, detail.score?.samples);
}

export function buildCockpit(detail: DepotDetailResponse): CockpitModel {
  const yard = describeYard(detail.yard);
  const feedDate = feedDateOf(detail.feedNow);
  const header = buildHeader(detail.depot, detail.score);
  const board = buildBoard(detail.depot, detail.buses, yard);
  return {
    header,
    indexMeta: indexMeta(header, detail.scoreWindow, detail.feedNow, detail.score?.samples),
    attention: buildAttention(detail, detail.depot.id),
    availability: availabilitySegments(board),
    availabilityText: availabilityText(board),
    yardLine: yardLine(board, {
      inYard: detail.locationMix.in_yard,
      visitors: detail.visitors.length,
      heldSince: detail.yard.value?.heldSince ?? null,
      snapshotsSeen: detail.yardSnapshotsSeen,
    }),
    exceptionGroups: groupBusExceptions(detail.exceptions.bus),
    depotExceptions: depotExceptionLines(detail.exceptions.depot, detail.scoreWindow, detail.feedNow),
    visitorCount: detail.visitors.length,
    board,
    tracker: buildTracker(detail.outshed.rows, detail.feedNow),
    coverageSentence: coverageSentence(detail.outshed.coverage, feedDate),
    noSchedulesSentence: noSchedulesSentence(feedDate),
    hasSchedules: detail.outshed.rows.length > 0,
    exceptions: buildExceptions(detail.exceptions),
    visitors: buildVisitors(detail.visitors),
  };
}
