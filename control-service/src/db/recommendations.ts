// Persistence for controller recommendations.
//
// The `recommendations` table has existed since the core data model and
// nothing has ever written to it. That is the open loop this module closes:
// `mpc/solver.ts` computes a recommendation only when a human opens the
// control room and the web app asks it to, so a corridor drifting apart at
// 03:00 produced a proposal only if somebody happened to be looking at that
// corridor. Detection ran on a timer; the decision did not.
//
// ─── THIS WRITES A PROPOSAL, NEVER AN INSTRUCTION ────────────────────────
//
// A row here is a suggestion with `status = 'proposed'`. It reaches nobody
// on its own and moves no bus. Issuing anything still requires a dispatcher
// approval and `POST /v1/commands`, which refuses to insert a command
// without an unconsumed approval row. Nothing in this file touches
// `commands`, `dispatcher_actions` or the webhook path, and nothing should
// be added that does - the point of closing the loop is to put a proposal
// in front of a human sooner, not to remove the human.
import type { Pool } from 'pg';
import { getPool } from './pool.js';
import type { CandidateAction } from '../mpc/types.js';
import type { PaceAdvisory } from '../mpc/paceGuidance.js';

export interface RecommendationInput {
  routeDirectionId: string;
  incidentId: string | null;
  candidateActions: CandidateAction[];
  selectedActionType: CandidateAction['actionType'] | null;
  objectiveCost: number | null;
  expectedRecoverySeconds: number | null;
  constraints: Record<string, unknown>;
  controllerVersion: string;
  /**
   * Pace advice for this corridor - buses that should ease off rather than be
   * held.
   *
   * Its own field, never folded into `candidateActions`, for the reason the
   * column exists: an advisory is not a rankable, approvable, dispatchable
   * action, and `findLatestRecommendation` reads `candidate_actions -> 0` as
   * the SELECTED action, so one landing there would be read back as the hold
   * the controller chose.
   *
   * Empty unless PACE_GUIDANCE_ON_DECISION_CYCLE_ENABLED is set; the caller
   * decides, not this module.
   */
  paceAdvisories?: readonly PaceAdvisory[];
}

/** The fields that decide whether a new proposal says anything new. */
export interface RecommendationFingerprint {
  selectedActionType: string | null;
  vehicleId: string | null;
  holdSeconds: number | null;
  /** The standing pace advice, reduced to what identifies it. See `paceSignature`. */
  paceSignature: string;
  createdAt: string;
}

/**
 * Pace advice reduced to the advice it carries, for change detection.
 *
 * WHY THIS IS NEEDED AT ALL. The existing fingerprint is
 * (action type, vehicle, hold length), and every one of those is null for a
 * corridor whose only useful answer is "ease off" - no hold was selected, so
 * there is no action type and no vehicle. Without a pace term two genuinely
 * different pieces of advice ("ease UP25FT1001 to 33" and "ease UP25FT4823
 * to 28") fingerprint identically, and the second would be discarded as
 * repeating the first.
 *
 * Which bus and what target: those are the whole of the instruction a
 * dispatcher reads out. The rationale text is deliberately NOT in the
 * signature - it restates the same facts in prose and would make every row
 * look new whenever a rounded number in it moved. Sorted so the signature is
 * about the advice and not about the order the solver happened to emit it in.
 */
export function paceSignature(advisories: readonly PaceAdvisory[] | null | undefined): string {
  if (!advisories || advisories.length === 0) return '';
  return advisories
    .map((a) => `${a.vehicleId}@${Math.round(a.targetSpeedKmph)}`)
    .sort()
    .join(',');
}

export async function insertRecommendation(
  input: RecommendationInput,
  pool: Pool = getPool(),
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into recommendations
       (route_direction_id, incident_id, candidate_actions, selected_action_type,
        objective_cost, expected_recovery_seconds, constraints, controller_version,
        pace_advisories, status)
     values ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9::jsonb, 'proposed')
     returning id`,
    [
      input.routeDirectionId,
      input.incidentId,
      JSON.stringify(input.candidateActions),
      input.selectedActionType,
      input.objectiveCost,
      input.expectedRecoverySeconds,
      JSON.stringify(input.constraints),
      input.controllerVersion,
      JSON.stringify(input.paceAdvisories ?? []),
    ],
  );
  return rows[0]!.id;
}

/**
 * The most recent proposal for this corridor, reduced to what identifies the
 * advice it carried.
 *
 * `candidate_actions -> 0` is the SELECTED action rather than merely the
 * first candidate: `mpc/solver.ts` returns `safeCandidates` in its own
 * selection order and this module persists that array, so index 0 is the
 * action the solver picked. Reading the vehicle out of the payload rather
 * than storing it in a column of its own keeps one source of truth for which
 * bus a recommendation was about.
 */
export async function findLatestRecommendation(
  routeDirectionId: string,
  pool: Pool = getPool(),
): Promise<RecommendationFingerprint | null> {
  const { rows } = await pool.query<{
    selected_action_type: string | null;
    vehicle_id: string | null;
    hold_seconds: string | null;
    pace_advisories: PaceAdvisory[] | null;
    created_at: string;
  }>(
    `select selected_action_type,
            candidate_actions -> 0 ->> 'vehicleId'   as vehicle_id,
            candidate_actions -> 0 ->> 'holdSeconds' as hold_seconds,
            pace_advisories,
            created_at
       from recommendations
      where route_direction_id = $1
      order by created_at desc
      limit 1`,
    [routeDirectionId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    selectedActionType: row.selected_action_type,
    vehicleId: row.vehicle_id,
    holdSeconds: row.hold_seconds === null ? null : Number(row.hold_seconds),
    // Computed through the same function the new proposal's signature goes
    // through, so the two sides can never disagree about what "same advice"
    // means.
    paceSignature: paceSignature(row.pace_advisories),
    createdAt: row.created_at,
  };
}

/**
 * How different a new proposal must be from the standing one to be worth
 * writing, in seconds of hold.
 *
 * The sweep re-solves every corridor on a timer, and a corridor drifting
 * slowly produces a near-identical recommendation every cycle. Writing all
 * of them would bury the moment the advice actually CHANGED under hundreds
 * of rows saying the same thing, and `recommendations` is append-only and
 * retained - the console's history is what an incident review reads.
 *
 * 30 s is the granularity a hold instruction is given in and roughly the
 * resolution a driver can execute one at, so a change smaller than this is
 * not a different instruction.
 */
export const RECOMMENDATION_HOLD_EPSILON_SECONDS = 30;

/**
 * Whether `next` says anything the standing proposal did not.
 *
 * True when there is no standing proposal, when the action type or the
 * vehicle changed, when the hold moved by more than the epsilon above, or
 * when the standing one is older than `maxAgeSeconds` - the last so a
 * long-running situation still leaves a periodic trace showing the
 * controller was watching it, rather than one row from an hour ago and
 * silence since.
 */
export function isMateriallyNewRecommendation(
  latest: RecommendationFingerprint | null,
  next: {
    selectedActionType: string | null;
    vehicleId: string | null;
    holdSeconds: number | null;
    /** Omitted by callers that persist no pace advice; absent and empty mean the same thing. */
    paceSignature?: string;
  },
  now: Date,
  maxAgeSeconds: number,
): boolean {
  if (!latest) return true;
  if (latest.selectedActionType !== next.selectedActionType) return true;
  if (latest.vehicleId !== next.vehicleId) return true;
  // Advice to ease a different bus off, or to ease the same bus to a
  // different pace, is different advice - and on a corridor where no hold
  // was selected it is the ONLY thing that distinguishes two rows.
  if (latest.paceSignature !== (next.paceSignature ?? '')) return true;

  const ageSeconds = (now.getTime() - new Date(latest.createdAt).getTime()) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds > maxAgeSeconds) return true;

  if (latest.holdSeconds === null || next.holdSeconds === null) {
    return latest.holdSeconds !== next.holdSeconds;
  }
  return Math.abs(latest.holdSeconds - next.holdSeconds) > RECOMMENDATION_HOLD_EPSILON_SECONDS;
}

// ─── READING THE TABLE BACK ──────────────────────────────────────────────
//
// Everything above this line is the WRITE side and its dedupe fingerprint,
// which is all this module had. That was the whole defect: the decision cycle
// solved every eligible corridor on a 90 s timer, wrote a row, and the only
// thing that ever read one back was the next cycle's own duplicate check.
// No route served the table and no console fetched it, so the automatic
// controller's output was written and discarded, and everything a dispatcher
// actually saw came from the SYNCHRONOUS solve taken when they opened a
// corridor themselves.
//
// The functions below are the reader that closes that. They are reads: they
// write nothing, they run no control law, and — see the note on
// `StandingRecommendation` — the shape they return deliberately cannot carry
// an approvable candidate across the wire. Issuing anything still requires a
// dispatcher approval and POST /v1/commands, exactly as before.

/**
 * How long after it was written a stored proposal is still inside the window
 * its own safety verdict was graded for.
 *
 * IMPORTED, never re-stated as a literal. `mpc/safety.ts` rejects a candidate
 * computed from state older than this, so a row's "safe" stamp is a claim
 * about a clock that has since moved on: past this age the row has not become
 * wrong, but nothing has confirmed it is still right.
 */
export { DEFAULT_STATE_STALE_SECONDS as RECOMMENDATION_FRESH_WITHIN_SECONDS } from '../mpc/safety.js';

/** Whether a stored row is still inside the window its verdict was graded for. */
export type RecommendationFreshness = 'fresh' | 'lapsed';

/**
 * One corridor's standing proposal, as a reader sees it.
 *
 * ─── WHY THIS IS A SUMMARY AND NOT THE STORED PAYLOAD ────────────────────
 *
 * `candidate_actions` is the approvable list: `CandidateAction` objects the
 * control room renders as approve-able alternatives, each carrying a safety
 * verdict graded against the clock at solve time. Handing that array to a
 * console would put a lapsed verdict in front of an operator wearing the same
 * affordance a live one wears, and the difference between them is invisible
 * once rendered.
 *
 * So the wire carries what the row SAID — action type, which bus, how long —
 * and a count, and nothing shaped like a candidate. A console physically
 * cannot offer one of these for approval, which is a stronger guarantee than
 * asking it not to. What an operator acts on is a fresh solve through the
 * existing path; this feed is what tells them to go and take one.
 */
export interface StandingRecommendation {
  id: string;
  routeDirectionId: string;
  routeId: string;
  routePublicName: string;
  directionCode: string;
  directionName: string | null;
  /** Null is normal and is the EARLY case the cycle exists for: drift that has not yet crossed a detection threshold. */
  incidentId: string | null;
  status: string;
  selectedActionType: string | null;
  /** The bus the selected action named, read out of `candidate_actions -> 0` — see `findLatestRecommendation`. */
  selectedVehicleId: string | null;
  selectedHoldSeconds: number | null;
  /** How many safe candidates the solve found. A summary: the candidates themselves never cross the wire. */
  candidateActionCount: number;
  objectiveCost: number | null;
  expectedRecoverySeconds: number | null;
  controllerVersion: string | null;
  paceAdvisories: PaceAdvisory[];
  createdAt: string;
  /**
   * Age in seconds, measured on the DATABASE clock against the same row's
   * `created_at`.
   *
   * Computed here rather than by a reader subtracting timestamps, because a
   * reader has its own clock and a browser's may be minutes out. Age is the
   * whole basis on which this feed says how much to trust a row, so it must
   * not be a quantity two processes can disagree about.
   */
  ageSeconds: number;
  freshness: RecommendationFreshness;
}

export interface StandingRecommendationFeed {
  recommendations: StandingRecommendation[];
  /** How far back the feed looked. See `listStandingRecommendations` for why this is the cycle's own repeat interval. */
  windowSeconds: number;
  /**
   * The age at which a row's `freshness` flips to `lapsed`, published beside
   * the flag it decides.
   *
   * `AGENTS.md` records the rule: a flag and the number it is drawn on are one
   * expression or they drift. A reader must not have to know that 90 s is
   * `mpc/safety.ts`'s window to understand what `fresh` claims.
   */
  freshWithinSeconds: number;
  /** Rows inside the window before `limit` was applied, so a truncated page can say what it is a slice of. */
  totalWithinWindow: number;
  /**
   * The newest row in the table, IGNORING the window — the one field that
   * keeps an empty list from reading as an all-clear.
   *
   * `AGENTS.md` records the same lesson for the alert inbox: an empty list is
   * the same shape as "nothing is wrong". Here it is worse, because a feed of
   * standing proposals empties for two completely different reasons — the
   * controller looked and proposed nothing, or the controller is not running.
   * Null means it has never written one. A timestamp older than the window
   * means it stopped. Neither is an all-clear and a console must say which.
   */
  latestCreatedAt: string | null;
  generatedAt: string;
}

interface StandingRecommendationRow {
  id: string;
  route_direction_id: string;
  route_id: string;
  route_public_name: string;
  direction_code: string;
  direction_name: string | null;
  incident_id: string | null;
  status: string;
  selected_action_type: string | null;
  vehicle_id: string | null;
  hold_seconds: string | null;
  candidate_action_count: string;
  objective_cost: string | null;
  expected_recovery_seconds: string | null;
  controller_version: string | null;
  pace_advisories: PaceAdvisory[] | null;
  created_at: string;
  age_seconds: string;
}

function toStandingRecommendation(
  row: StandingRecommendationRow,
  freshWithinSeconds: number,
): StandingRecommendation {
  const ageSeconds = Number(row.age_seconds);
  return {
    id: row.id,
    routeDirectionId: row.route_direction_id,
    routeId: row.route_id,
    routePublicName: row.route_public_name,
    directionCode: row.direction_code,
    directionName: row.direction_name,
    incidentId: row.incident_id,
    status: row.status,
    selectedActionType: row.selected_action_type,
    selectedVehicleId: row.vehicle_id,
    selectedHoldSeconds: row.hold_seconds === null ? null : Number(row.hold_seconds),
    candidateActionCount: Number(row.candidate_action_count),
    objectiveCost: row.objective_cost === null ? null : Number(row.objective_cost),
    expectedRecoverySeconds:
      row.expected_recovery_seconds === null ? null : Number(row.expected_recovery_seconds),
    controllerVersion: row.controller_version,
    paceAdvisories: row.pace_advisories ?? [],
    createdAt: row.created_at,
    ageSeconds,
    freshness: ageSeconds <= freshWithinSeconds ? 'fresh' : 'lapsed',
  };
}

/**
 * The most recent row in the table, whatever its age. Null when the cycle has
 * never written one.
 *
 * Separate from the windowed read on purpose: this is the question "is the
 * automatic controller writing anything at all?", and it must be answerable
 * when the windowed read comes back empty — which is precisely the case where
 * a reader is about to conclude the network is fine.
 */
export async function findNewestRecommendationCreatedAt(
  pool: Pool = getPool(),
): Promise<string | null> {
  const { rows } = await pool.query<{ created_at: string | null }>(
    `select max(created_at) as created_at from recommendations`,
  );
  return rows[0]?.created_at ?? null;
}

/**
 * The standing proposal for every corridor that has one, newest first.
 *
 * ─── ONE ROW PER CORRIDOR, NOT A HISTORY ─────────────────────────────────
 *
 * `distinct on (route_direction_id)` because a dispatcher's question is "what
 * does the controller currently say about each corridor", not "every proposal
 * ever made". A history feed would put twenty rows about one drifting corridor
 * above the first mention of nineteen others, which inverts the triage the
 * order is supposed to carry. The per-corridor history stays available in the
 * table for an incident review, which is what it was always for.
 *
 * It is also the shape the existing
 * `recommendations_route_direction_created_idx (route_direction_id, created_at
 * desc)` index answers directly, so this read needs no index of its own.
 *
 * ─── WHY THE WINDOW IS THE CYCLE'S OWN REPEAT INTERVAL ───────────────────
 *
 * `windowSeconds` should default to `DECISION_CYCLE_REPEAT_AFTER_SECONDS`,
 * and the caller passes it in from there rather than this module inventing a
 * second number. That interval is the cycle's promise about unchanged advice:
 * `isMateriallyNewRecommendation` returns true once a standing row is older
 * than it, so advice that still holds is re-written at least that often. A row
 * older than the window is therefore not standing advice — the cycle has had
 * the chance to repeat it and did not, because the situation resolved or
 * because the cycle is no longer running. Deriving the window from that one
 * constant is what stops the reader and the writer disagreeing about how long
 * a proposal lives.
 */
export async function listStandingRecommendations(
  options: { windowSeconds: number; limit: number; freshWithinSeconds: number },
  pool: Pool = getPool(),
): Promise<{ recommendations: StandingRecommendation[]; totalWithinWindow: number }> {
  const { rows } = await pool.query<StandingRecommendationRow & { total_within_window: string }>(
    `with standing as (
       select distinct on (r.route_direction_id)
              r.id,
              r.route_direction_id,
              r.incident_id,
              r.status,
              r.selected_action_type,
              r.candidate_actions -> 0 ->> 'vehicleId'   as vehicle_id,
              r.candidate_actions -> 0 ->> 'holdSeconds' as hold_seconds,
              jsonb_array_length(r.candidate_actions)    as candidate_action_count,
              r.objective_cost,
              r.expected_recovery_seconds,
              r.controller_version,
              r.pace_advisories,
              r.created_at,
              extract(epoch from (now() - r.created_at)) as age_seconds
         from recommendations r
        where r.created_at > now() - make_interval(secs => $1::double precision)
        order by r.route_direction_id, r.created_at desc
     )
     select s.*,
            rd.route_id,
            rd.direction_code,
            rd.direction_name,
            ro.public_name as route_public_name,
            count(*) over () as total_within_window
       from standing s
       join route_directions rd on rd.id = s.route_direction_id
       join routes ro on ro.id = rd.route_id
      order by s.created_at desc
      limit $2`,
    [options.windowSeconds, options.limit],
  );

  return {
    recommendations: rows.map((row) => toStandingRecommendation(row, options.freshWithinSeconds)),
    // `count(*) over ()` counts the corridors with a standing row, before the
    // limit. Zero rows returned means zero within the window - the empty case
    // is answered by `latestCreatedAt`, not by this.
    totalWithinWindow: rows.length === 0 ? 0 : Number(rows[0]!.total_within_window),
  };
}
