/**
 * The control-room console's status band, as data.
 *
 * This module is pure and knows nothing about fetching, so the rule it
 * enforces can be tested exhaustively without a control service: the console
 * shows real numbers or it says it cannot see, and it never confuses the two.
 * The wire type below is what `GET /api/ops/control-room/overview` returns and
 * what `src/lib/ops/controlRoomOverview.ts` composes; the builder underneath
 * is what the strip renders.
 *
 * WHY THE PROVENANCE FLAGS ARE SEPARATE PER SOURCE. The strip mixes four
 * upstreams with genuinely independent failure modes — the GPS fleet feed, the
 * control service's headway sweep, its daily KPI roll-up, and this app's own
 * kill-switch table. During a partial outage the honest console shows live
 * headway beside an unavailable recovery rate. One global "degraded" flag
 * would either blank readings that are fine or, far worse, present stale ones
 * as current. See src/lib/ops/consoleReadings.ts for the three-state reading
 * this is built on.
 */
import type { UpstreamSource } from '@/models/canonical';
import type {
  BunchingIncident,
  DailyKpiSnapshot,
  HeadwayAggregate,
  RouteDirectionMeta,
} from '@/models/control';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import {
  formatPercent,
  formatRatio,
  formatSeconds,
  notYetComputed,
  readingFrom,
  unavailable,
  observed,
  type ConsoleReading,
} from './consoleReadings';
import { METRIC, SAFETY_BLOCK_LABEL, corridorName } from './vocabulary';

/** The wire shape of GET /api/ops/control-room/overview. Serializable throughout. */
export interface ControlRoomOverview {
  fetchedAt: string;
  /** Corridors the control service reports as active, for the picker. */
  routeDirections: RouteDirectionMeta[];
  /** The corridor this snapshot describes, or null when the service listed none. */
  selectedRouteDirectionId: string | null;
  /**
   * How much of the network the console can see, counted from that list.
   *
   * There is deliberately no total to divide by; see `corridorCoverageFrom` in
   * src/lib/ops/controlRoomOverview.ts for the two denominators that were
   * measured and rejected, and why printing either would have been a worse lie
   * than the unlabelled figure this replaced.
   */
  corridors: {
    /** False when the corridor list is a stale copy or an empty fallback, so nothing below was observed. */
    ok: boolean;
    /** Corridors with mapped geometry — exactly the ones the picker offers. */
    mapped: number;
    /**
     * Of those, the ones with an active headway policy, and therefore the only
     * ones that can report a headway, a CV, an excess wait or a bunching
     * incident at all.
     *
     * Null when the control service does not report policy state — unknown,
     * never zero.
     */
    detecting: number | null;
  };
  /** Fleet-feed half: statewide vehicle count and its provenance. */
  fleet: {
    reporting: number;
    source: UpstreamSource;
    stale: boolean;
    error: string | null;
  };
  /** Control-service observability half. `ok` false means headway and incidents below are not to be trusted as current. */
  observability: {
    ok: boolean;
    stale: boolean;
    error: string | null;
    /**
     * True when the control service ANSWERED and told us this corridor has no
     * active headway policy — so `ok` is false because there is nothing to
     * report, not because anything failed.
     *
     * This is the difference between "we cannot see" and "there is nothing to
     * see", and on this console they are not allowed to look the same. See
     * `noActivePolicyFrom` in src/lib/ops/controlRoomOverview.ts.
     */
    noActivePolicy: boolean;
  };
  headway: HeadwayAggregate | null;
  /** Open bunching incidents on the selected corridor. Meaningless unless `observability.ok`. */
  incidents: BunchingIncident[];
  /** Today's KPI roll-up for the selected corridor. `ok` false means the roll-up could not be read at all. */
  dailyKpi: {
    ok: boolean;
    /** Null when the roll-up was read but holds no row for this corridor yet. */
    row: DailyKpiSnapshot | null;
  };
  /** Guardrail breaches recorded for the selected corridor. */
  guardrails: {
    ok: boolean;
    total: number;
    critical: number;
  };
  /** Engaged kill switches from this app's own table. `ok` false means the table could not be read. */
  killSwitches: {
    ok: boolean;
    active: KillSwitchRecord[];
  };
}

/**
 * What a tile is a number ABOUT.
 *
 * The strip mixes two populations and used to present them as one row. Six
 * tiles describe the single corridor in the picker; the vehicle count is every
 * bus in Uttar Pradesh. Read together and unlabelled, a statewide 9,190 beside
 * a corridor's headway says "the whole network is monitored", which is the
 * claim this console cannot support — the corridors it can see at all are a
 * small fraction of the network, and the ones it can detect on are a fraction
 * of those. Scope is therefore a property of the tile, not a layout decision
 * taken in the renderer.
 */
export type ConsoleKpiScope = 'network' | 'corridor';

export interface ConsoleKpiTile {
  label: string;
  reading: ConsoleReading;
  /** Whether this number describes the whole state or the selected corridor. */
  scope: ConsoleKpiScope;
  /** Renders `reading.value` when it is observed. */
  format?: (value: number) => string;
  /** Emphasis for the value, decided from the value itself — never from a threshold this module invents. */
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'critical';
  unit?: string;
}

export interface ConsoleKpiModel {
  tiles: ConsoleKpiTile[];
  /** Provenance chip for the fleet feed, matched to the shared badge vocabulary. */
  fleetBadge: { variant: 'live' | 'sim' | 'fixture' | 'critical' | 'neutral'; label: string };
  /** Non-null when at least one kill switch is engaged: the console must not offer to issue anything. */
  killSwitchNotice: { engaged: boolean; label: string; detail: string } | null;
  /** Every upstream that failed, for one honest line under the strip. */
  degraded: string[];
  /**
   * Non-null when the corridor-scoped tiles are blank for a benign, explained
   * reason rather than a failure.
   *
   * Separate from `degraded` because that line is worded as an outage. A
   * console that files "this corridor has no policy" under "did not answer"
   * has told the operator the system is broken when it is working exactly as
   * designed — and would train them to ignore the line that matters.
   */
  corridorNotice: string | null;
  /**
   * The standing sentence about how much of the network this console can see.
   *
   * Always present while the corridor list is readable, and quiet by design:
   * it is context an operator reads once at the start of a shift, not an
   * alert. It carries the denominator honesty that the coverage tile cannot —
   * that the number beside "mapped" is not the size of the network, and that
   * the console does not know what that size is.
   */
  coverageNotice: string | null;
}

/**
 * How bunched is too bunched, for COLOUR ONLY.
 *
 * A coefficient of variation at or above this is what the transit literature
 * and this system's own `route_policies` treat as an irregular service, and
 * the tile turns amber. It changes no number, gates no action, and is
 * deliberately not a threshold the product claims to have measured — the real
 * operational thresholds live in `route_policies` and are applied by the
 * headway detector, which is what actually opens an incident.
 */
const CV_IRREGULAR = 0.5;

export function buildConsoleKpi(overview: ControlRoomOverview): ConsoleKpiModel {
  /**
   * The service answered; this corridor simply has no active headway policy.
   *
   * Kept distinct from `!observability.ok` throughout the builder below. The
   * two states share `ok: false` because neither yields a headway number, and
   * that is the ONLY thing they have in common: one is the console unable to
   * see, the other is the corridor having nothing to show. Rendering them the
   * same way reported an outage that never happened.
   */
  const noPolicy = overview.observability.noActivePolicy;

  const degraded: string[] = [];
  if (overview.fleet.source === 'unavailable') degraded.push('the vehicle feed');
  // `noPolicy` is deliberately NOT degraded. The line under the strip reads
  // "... did not answer", and the control service did answer.
  if (!overview.observability.ok && !noPolicy) degraded.push('the control service');
  if (!overview.dailyKpi.ok) degraded.push("today's summary figures");
  if (!overview.guardrails.ok) degraded.push('the record of blocked actions');
  if (!overview.killSwitches.ok) degraded.push('the record of stopped instructions');

  const headwayOk = overview.observability.ok;
  const aggregate = overview.headway;

  /**
   * What a corridor-scoped control-service tile says when it has no number.
   *
   * `not-yet-computed` rather than `unavailable`, so the tile prints `—`
   * instead of `n/a`: nothing failed, and the glyph is what an operator
   * actually reads mid-incident. With no policy there is no headway target, so
   * there is no CV, no excess wait, and no threshold for the detector to open
   * an incident against — the emptiness is real and explainable rather than
   * unknown.
   *
   * Kept SHORT deliberately. A tile hint sets the column width, and the fuller
   * sentence pushed the seven-tile strip onto a second row. The explanation
   * belongs in `corridorNotice`, which has a line to itself.
   */
  const NO_POLICY_NOTE = 'no planned gap set for this corridor';
  const noPolicyReading = () => notYetComputed(NO_POLICY_NOTE);

  /**
   * Whether there is a corridor for the corridor-scoped tiles to describe.
   *
   * With none selected, "OPEN INCIDENTS 0 — this corridor is clear" and
   * "GUARDRAIL BREACHES 0 — none recorded" were trivially true and read as a
   * report on a corridor nobody had checked. Their neighbours already print
   * `—` in that state (no headway sample, no KPI row), so these two were also
   * the only tiles on the strip disagreeing with the rest of it. Not-computed
   * rather than unavailable: nothing failed, there is simply no subject.
   */
  const corridorSelected = overview.selectedRouteDirectionId !== null;
  const NO_CORRIDOR = 'no corridor selected';
  const sampleNote =
    aggregate === null
      ? 'no gap reading taken yet'
      : `from ${aggregate.sampleCount} ${aggregate.sampleCount === 1 ? 'pair of buses' : 'pairs of buses'}`;

  // The CV tile's hint is the READING KEY when there is a number, and the
  // provenance when there is not. The sample count is not lost: the average-gap
  // tile beside it carries `from N pairs of buses` on the same row, and an
  // operator staring at "0.31" needs to know what 0.31 means far more than
  // they need the sample count twice.
  const cv = noPolicy
    ? noPolicyReading()
    : readingFrom(headwayOk, aggregate?.cv, {
        observed: METRIC.cv.tileHint,
        missing: sampleNote,
        unavailable: 'the control service did not answer',
      });

  const tiles: ConsoleKpiTile[] = [
    {
      label: 'Buses reporting',
      scope: 'network',
      reading:
        overview.fleet.source === 'unavailable'
          ? unavailable('the vehicle feed did not answer')
          : observed(
              overview.fleet.reporting,
              overview.fleet.stale
                ? 'last known positions, the feed is behind'
                : 'every depot, live feed',
            ),
      tone: 'accent',
    },
    coverageTile(overview.corridors),
    {
      label: METRIC.meanHeadway.label,
      scope: 'corridor',
      reading: noPolicy
        ? noPolicyReading()
        : readingFrom(headwayOk, aggregate?.meanHeadwaySeconds, {
            observed:
              aggregate === null
                ? sampleNote
                : `planned gap ${formatSeconds(aggregate.targetHeadwaySeconds)} · ${sampleNote}`,
            missing: sampleNote,
            unavailable: 'the control service did not answer',
          }),
      format: formatSeconds,
    },
    {
      label: METRIC.cv.label,
      scope: 'corridor',
      reading: cv,
      format: formatRatio,
      tone: cv.availability === 'observed' && (cv.value ?? 0) >= CV_IRREGULAR ? 'warn' : 'default',
    },
    {
      label: METRIC.excessWait.label,
      scope: 'corridor',
      reading: noPolicy
        ? noPolicyReading()
        : readingFrom(headwayOk, aggregate?.ewtSeconds, {
            observed: METRIC.excessWait.hint,
            missing: sampleNote,
            unavailable: 'the control service did not answer',
          }),
      format: formatSeconds,
    },
    {
      // Not `observed(0)` under `noPolicy`, even though the detector genuinely
      // cannot have opened one: this snapshot abandoned the incident read when
      // the headway read failed, so the console holds no answer of its own and
      // printing a confident `0 — this corridor is clear` would be exactly the
      // fabricated zero the strip exists to prevent.
      label: 'Buses closing up',
      scope: 'corridor',
      reading: noPolicy
        ? noPolicyReading()
        : !headwayOk
          ? unavailable('the control service did not answer')
          : !corridorSelected
            ? notYetComputed(NO_CORRIDOR)
            : observed(
                overview.incidents.length,
                overview.incidents.length === 0
                  ? 'nothing closing up on this corridor'
                  : 'happening on this corridor now',
              ),
      tone: headwayOk && corridorSelected && overview.incidents.length > 0 ? 'critical' : 'default',
    },
    {
      label: 'Sorted out today',
      scope: 'corridor',
      reading: readingFrom(overview.dailyKpi.ok, overview.dailyKpi.row?.recoveryRate, {
        observed: overview.dailyKpi.row
          ? `${overview.dailyKpi.row.recoveredIncidentCount} of ${overview.dailyKpi.row.incidentCount} sorted out today`
          : 'today',
        missing:
          overview.dailyKpi.row === null
            ? 'no summary for this corridor yet today'
            : 'not worked out for today yet',
        unavailable: "today's summary figures could not be read",
      }),
      format: formatPercent,
    },
    {
      label: SAFETY_BLOCK_LABEL,
      scope: 'corridor',
      reading: !overview.guardrails.ok
        ? unavailable('blocked actions could not be read')
        : !corridorSelected
          ? notYetComputed(NO_CORRIDOR)
          : observed(
              overview.guardrails.total,
              overview.guardrails.critical > 0
                ? `${overview.guardrails.critical} serious`
                : overview.guardrails.total === 0
                  ? 'nothing blocked'
                  : 'none serious',
            ),
      tone:
        overview.guardrails.ok && corridorSelected && overview.guardrails.critical > 0
          ? 'critical'
          : 'default',
    },
  ];

  return {
    tiles,
    fleetBadge: fleetBadgeFor(overview.fleet.source, overview.fleet.stale),
    killSwitchNotice: killSwitchNoticeFor(overview.killSwitches, overview.routeDirections),
    degraded,
    corridorNotice: noPolicy
      ? 'The control service answered: no planned gap has been set for this corridor, so buses closing up cannot be checked here and there are no gap readings to show. Choose a corridor marked as reporting to see live gaps.'
      : null,
    coverageNotice: coverageNoticeFor(overview.corridors),
  };
}

/**
 * The coverage tile: how many corridors this console can see, and how many of
 * those can actually tell it anything.
 *
 * Both halves are counted from the corridor list the control service just
 * returned, so the number moves on its own as the network seeder maps more of
 * the state — there is no constant here to go stale. `detecting / mapped` is a
 * ratio the console genuinely measured; it is NOT coverage of the network, and
 * the caption under the strip is what says so.
 */
function coverageTile(corridors: ControlRoomOverview['corridors']): ConsoleKpiTile {
  const { ok, mapped, detecting } = corridors;
  return {
    label: 'Corridors that can report',
    scope: 'network',
    // The value is the number of corridors that can actually report, and the
    // unit carries what it is out of. Splitting the pair across two tiles was
    // considered and dropped: "47" and "14" sitting apart invite exactly the
    // reading the pair exists to prevent, that 47 is the size of the network
    // rather than the size of what has been mapped out of it.
    unit: detecting === null ? 'surveyed' : `of ${mapped} surveyed`,
    reading: !ok
      ? unavailable('the control service did not answer')
      : observed(
          detecting ?? mapped,
          detecting === null
            ? 'this control service does not say which can report'
            : 'can report buses closing up',
        ),
  };
}

/**
 * The standing caption that keeps the coverage pair from reading as a network
 * total.
 *
 * Worded as a plain fact and rendered in the faintest ink on the strip,
 * because it is true on a perfectly healthy console and will be read on every
 * shift. An operator who is warned about a normal condition twice a day stops
 * reading warnings.
 *
 * Silent when the corridor list could not be read: the degraded line already
 * says the control service did not answer, and a second sentence about
 * coverage the console could not count would be noise on top of it.
 */
function coverageNoticeFor(corridors: ControlRoomOverview['corridors']): string | null {
  const { ok, mapped, detecting } = corridors;
  if (!ok) return null;

  // KEPT, and kept long. Every clause is doing work: the pair says how much
  // of the state has been surveyed, and the closing sentence says the pair is
  // NOT a share of the network, because the network's size is not known from
  // here. A shorter version of this paragraph is a false one.
  const NETWORK_UNKNOWN =
    'The control database holds only the corridors surveyed so far, so the size of the full network is not known here — this is not a whole-network view.';

  if (mapped === 0) {
    return `The control service reports no surveyed corridors, so the corridor figures above have nothing to describe. ${NETWORK_UNKNOWN}`;
  }
  if (detecting === null) {
    return `${mapped} ${corridorWord(mapped)} ${mapped === 1 ? 'has' : 'have'} been surveyed and can be chosen here. This control service does not say which of them have a planned gap set, so how many can report buses closing up is unknown. ${NETWORK_UNKNOWN}`;
  }
  if (detecting === mapped) {
    return `All ${mapped} surveyed ${corridorWord(mapped)} ${mapped === 1 ? 'has' : 'have'} a planned gap set, so ${mapped === 1 ? 'it' : 'they'} can report buses closing up. ${NETWORK_UNKNOWN}`;
  }
  return `${detecting} of ${mapped} surveyed ${corridorWord(mapped)} ${detecting === 1 ? 'has' : 'have'} a planned gap set, so ${detecting === 1 ? 'it' : 'they'} can report buses closing up. The other ${mapped - detecting} can be opened but will show nothing. ${NETWORK_UNKNOWN}`;
}

function corridorWord(count: number): string {
  return count === 1 ? 'corridor' : 'corridors';
}

/**
 * The provenance chip, mapped onto the shared badge vocabulary rather than a
 * second one. `fixture` genuinely means bundled demo vehicles, and it keeps
 * the command centre's own chip so a fabricated fleet can never look live on
 * one surface and modelled on another.
 */
function fleetBadgeFor(source: UpstreamSource, stale: boolean): ConsoleKpiModel['fleetBadge'] {
  if (source === 'unavailable') return { variant: 'critical', label: 'Feed down' };
  if (source === 'fixture') return { variant: 'fixture', label: 'Demo data' };
  if (stale) return { variant: 'sim', label: 'Last known' };
  return { variant: 'live', label: 'Live' };
}

function killSwitchNoticeFor(
  killSwitches: ControlRoomOverview['killSwitches'],
  routeDirections: readonly RouteDirectionMeta[],
): ConsoleKpiModel['killSwitchNotice'] {
  if (!killSwitches.ok) {
    // Unreadable is NOT "clear". The console cannot promise commands will be
    // accepted, and saying "no kill switch engaged" here would be a claim it
    // has no evidence for.
    return {
      engaged: false,
      label: 'Cannot tell whether instructions are stopped',
      detail:
        'The record of stopped instructions could not be read, so whether new instructions can be sent is unknown.',
    };
  }
  if (killSwitches.active.length === 0) return null;

  const network = killSwitches.active.find((entry) => entry.scope === 'network');
  if (network) {
    return {
      engaged: true,
      label: 'All new instructions stopped, whole state',
      detail: `No new instruction can be sent anywhere. Instructions already sent still stand. Reason: ${network.reason}`,
    };
  }
  const count = killSwitches.active.length;
  return {
    engaged: true,
    label: `New instructions stopped on ${count} ${count === 1 ? 'corridor' : 'corridors'}`,
    detail: killSwitches.active
      .map((entry) => `${corridorLabel(entry.routeDirectionId, routeDirections)}: ${entry.reason}`)
      .join(' · '),
  };
}

/**
 * A corridor id, resolved to the name an operator recognises.
 *
 * A stopped-instruction notice reading "5f2c9a1e-… : brake fault" names
 * nothing an operator can act on, and the corridor list needed to resolve it
 * is already in hand on this same snapshot. When it is NOT in hand the raw id
 * is returned rather than a guess: an unresolvable id is a real state (a
 * corridor stopped and since deactivated), and inventing a name for it would
 * be worse than showing the id.
 */
function corridorLabel(
  routeDirectionId: string | null,
  routeDirections: readonly RouteDirectionMeta[],
): string {
  if (routeDirectionId === null) return 'corridor not recorded';
  const meta = routeDirections.find((rd) => rd.routeDirectionId === routeDirectionId);
  return meta ? corridorName(meta) : routeDirectionId;
}

/**
 * Whether a command may be issued for this corridor right now, from the same
 * evidence `POST /api/ops/control-room/commands` will consult a moment later.
 * A network switch blocks everything; a route switch blocks only its own
 * corridor. Unknown blocks nothing here on purpose — the command endpoint is
 * the authority and refuses on its own read, so guessing "blocked" would hide
 * a working control on a transient database blip.
 */
export function commandsHaltedFor(
  killSwitches: ControlRoomOverview['killSwitches'],
  routeDirectionId: string | null,
): KillSwitchRecord | null {
  if (!killSwitches.ok) return null;
  return (
    killSwitches.active.find(
      (entry) =>
        entry.scope === 'network' ||
        (routeDirectionId !== null && entry.routeDirectionId === routeDirectionId),
    ) ?? null
  );
}
