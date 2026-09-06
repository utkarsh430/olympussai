/**
 * What the console SAYS about a stored recommendation.
 *
 * The claims live here, apart from the components, for the same reason
 * `recommendationView.ts` next door keeps its copy in one testable place: a
 * sentence that tells an operator how much to trust a proposal is a decision,
 * and decisions belong somewhere they can be pinned by a test.
 *
 * Two of them are the whole point of this file.
 *
 * ─── 1. AN EMPTY LIST IS NOT AN ALL-CLEAR ────────────────────────────────
 *
 * `AGENTS.md` records this for the alert inbox: an empty alert list is the
 * same shape as "the network is fine", so the feed serves the last good list
 * flagged stale rather than emptying itself. A list of standing PROPOSALS is
 * worse, because it empties for two more reasons that look identical:
 *
 *   - the automatic cycle looked at every corridor and proposed nothing,
 *     which is the ordinary healthy answer on an evenly-spaced network; and
 *   - the automatic cycle is not running, or is failing, and has written
 *     nothing for hours.
 *
 * Both render as zero rows. `describeFeedEmptiness` is what separates them,
 * and it can only do so because the feed carries `latestCreatedAt` for the
 * whole table rather than only the rows inside its window.
 *
 * ─── 2. A STORED ROW AND A LIVE SOLVE CAN DISAGREE, AND ONE OF THEM WINS ─
 *
 * The stored row was written by `scheduler/decisionCycle.ts` at some past
 * moment. The live solve is taken now, through the existing
 * POST /api/ops/control-room/recommendations path. When they disagree, showing
 * both and leaving the operator to pick is the failure mode: the two are not
 * peers.
 *
 * THE LIVE SOLVE IS AUTHORITATIVE, ALWAYS. Not because it is better reasoning
 * — it is the same five control laws over the same state — but because of what
 * each answer is graded against. `mpc/safety.ts` rejects a candidate computed
 * from vehicle state older than 90 s, and that verdict is stamped at solve
 * time. A live solve's verdict is about the clock the operator is acting on. A
 * stored row's verdict is about a clock that has moved; by the time anyone
 * reads a list, it has usually moved past the bound. So the stored row's job
 * is to say WHERE TO LOOK, and the live solve's job is to say WHAT TO DO.
 *
 * `reconcileWithLiveSolve` states that in the copy, every time, rather than
 * rendering two proposals side by side and letting the layout imply a ranking.
 */
import type { StandingRecommendation } from '@/models/recommendationFeed';
import { actionLabel, type RecommendationResult } from './recommendationView';

function ageInWords(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (seconds < 45) return 'seconds ago';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

export interface FeedEmptinessCopy {
  tone: 'info' | 'warning';
  headline: string;
  body: string;
}

/**
 * What to say when the list has no rows in it, or null when it has some.
 *
 * `latestCreatedAt` is the whole basis of the distinction: it is the newest
 * row in the table regardless of the feed's window, so it answers "is the
 * automatic controller writing anything at all?" precisely when the windowed
 * list has come back empty and a reader is about to conclude the network is
 * fine.
 */
export function describeFeedEmptiness(feed: {
  recommendations: readonly unknown[];
  windowSeconds: number;
  latestCreatedAt: string | null;
  /**
   * The clock this copy is measured against, and deliberately NOT the
   * reader's.
   *
   * Two reasons, and the second is the one that bites. A browser's clock can
   * be minutes out, and every age on this surface is already taken on the
   * control service's clock (`ageSeconds`), so mixing a second clock in here
   * would let two numbers on one panel disagree. And a client clock is not
   * available during the server render: reading `Date.now()` in an effect
   * would leave the first paint of an EMPTY list carrying no warning at all,
   * which is precisely the all-clear this function exists to prevent — for as
   * long as it takes someone to glance away.
   *
   * On a stale feed this is the old feed's own timestamp, which is the honest
   * reading: "when this list was made, the last row was three hours old". The
   * caller says separately that the list is not live.
   */
  generatedAt: string;
}): FeedEmptinessCopy | null {
  if (feed.recommendations.length > 0) return null;

  const parsedNow = Date.parse(feed.generatedAt);
  const now = Number.isNaN(parsedNow) ? Date.now() : parsedNow;
  const windowMinutes = Math.round(feed.windowSeconds / 60);

  if (feed.latestCreatedAt === null) {
    return {
      tone: 'warning',
      headline: 'The automatic controller has never recorded a proposal',
      body:
        'This is not an all-clear. It means the automatic decision cycle has produced nothing for ' +
        'this list to show — most likely it is switched off or has never completed a sweep. ' +
        'Corridor-by-corridor solving is unaffected and still answers on demand.',
    };
  }

  const latestMs = Date.parse(feed.latestCreatedAt);
  const ageSeconds = Number.isNaN(latestMs) ? null : (now - latestMs) / 1000;

  if (ageSeconds !== null && ageSeconds > feed.windowSeconds) {
    return {
      tone: 'warning',
      headline: 'Nothing standing, and nothing recent either',
      body:
        `The automatic controller last recorded a proposal ${ageInWords(ageSeconds)} and none since. ` +
        'That is not an all-clear: it means either every corridor it looked at needed nothing, or ' +
        'the automatic cycle has stopped. Check the alert list for what is actually happening on ' +
        'the network — this page only says what the controller proposed.',
    };
  }

  return {
    tone: 'info',
    headline: 'No standing proposals',
    body:
      `The automatic controller has looked at the network within the last ${windowMinutes} minutes ` +
      'and proposed nothing that still stands. That is the ordinary answer on an evenly-spaced ' +
      'network — it is not a statement that nothing is wrong, which is what the alert list answers.',
  };
}

export interface ProposalAgeCopy {
  tone: 'info' | 'warning';
  /** Short label for the row itself. */
  badge: string;
  /** One sentence, for the opened proposal. */
  detail: string;
}

/**
 * How much a row's age means, said out loud.
 *
 * Neither state is approvable and the copy says so in both, because the
 * difference between them is about how likely a live solve is to agree — not
 * about whether this row can be acted on. Nothing here can be acted on; the
 * feed does not even carry the candidate objects an approval would name.
 */
export function describeProposalAge(
  recommendation: Pick<StandingRecommendation, 'ageSeconds' | 'freshness'>,
  freshWithinSeconds: number,
): ProposalAgeCopy {
  if (recommendation.freshness === 'fresh') {
    return {
      tone: 'info',
      badge: 'Just proposed',
      detail:
        `Recorded ${ageInWords(recommendation.ageSeconds)}, inside the ${freshWithinSeconds}-second ` +
        'window the safety filter grades vehicle state by. A live solve will probably still agree — ' +
        'take one to find out, because this row is a record of what was proposed, not an offer.',
    };
  }
  return {
    tone: 'warning',
    badge: 'Not confirmed since',
    detail:
      `Recorded ${ageInWords(recommendation.ageSeconds)}, which is past the ${freshWithinSeconds}-second ` +
      'window its safety verdict was graded for. Nothing has confirmed it since. It has not become ' +
      'wrong — it has become unchecked, and only a live solve can say which.',
  };
}

/**
 * How a live solve stands relative to the stored row that pointed at it.
 *
 * `unavailable` is a first-class answer and not an error state: it covers both
 * "no solve has been taken yet" and "the solve failed", and in both the stored
 * row must keep saying it is unconfirmed rather than quietly reading as
 * current.
 */
export type LiveSolveRelation = 'confirmed' | 'changed' | 'withdrawn' | 'unavailable';

export interface ReconciliationCopy {
  relation: LiveSolveRelation;
  tone: 'info' | 'warning';
  headline: string;
  /** The sentence that names which of the two an operator acts on. Never omitted. */
  authority: string;
  body: string;
}

/**
 * Compare the stored proposal against a live solve of the same corridor.
 *
 * Identity is (action type, vehicle) — the two fields that make up the
 * instruction a dispatcher reads out. A hold length that moved while both of
 * those held still is reported inside the `confirmed` copy rather than
 * promoted to a disagreement: it is the same instruction, re-measured, and the
 * live figure is the one to use. Deliberately not compared against a tolerance
 * constant: the control service has one for deciding whether to WRITE a new
 * row, and copying it here would put a write-side dedupe rule in charge of
 * what an operator is told.
 */
export function reconcileWithLiveSolve(
  stored: Pick<
    StandingRecommendation,
    'selectedActionType' | 'selectedVehicleId' | 'selectedHoldSeconds'
  >,
  live: Pick<RecommendationResult, 'selectedAction'> | null,
): ReconciliationCopy {
  const AUTHORITY =
    'Act on the live solve. The stored row is a record of what the automatic controller proposed ' +
    'earlier; its safety verdict was graded against a clock that has moved.';

  if (!live) {
    return {
      relation: 'unavailable',
      tone: 'warning',
      headline: 'Not confirmed by a live solve',
      authority:
        'Do not act on the stored row. Nothing has checked it against the corridor as it is now.',
      body:
        'No live solve has answered for this corridor, so what the automatic controller proposed ' +
        'earlier stands unchecked. It is not evidence that the proposal still holds, and it is not ' +
        'evidence that it does not.',
    };
  }

  const selected = live.selectedAction;

  if (!selected) {
    return {
      relation: 'withdrawn',
      tone: 'warning',
      headline: 'The live solve proposes nothing',
      authority: AUTHORITY,
      body: stored.selectedActionType
        ? `The automatic controller proposed ${actionLabel(stored.selectedActionType)} here, and a ` +
          'solve taken now selects no action at all — the corridor has recovered, or every candidate ' +
          'was refused by the safety filter. Either way there is nothing to issue.'
        : 'A solve taken now selects no action, which is what the stored row said too.',
    };
  }

  const sameAction =
    stored.selectedActionType === selected.actionType &&
    stored.selectedVehicleId === selected.vehicleId;

  if (sameAction) {
    const holdMoved =
      stored.selectedHoldSeconds !== null && stored.selectedHoldSeconds !== selected.holdSeconds;
    return {
      relation: 'confirmed',
      tone: 'info',
      headline: 'The live solve agrees',
      authority: AUTHORITY,
      body: holdMoved
        ? `Still ${actionLabel(selected.actionType)} on ${selected.vehicleId}, now measured at ` +
          `${selected.holdSeconds}s against the stored row's ${stored.selectedHoldSeconds}s. Use the ` +
          'live figure — it is the one the safety filter graded just now.'
        : `Still ${actionLabel(selected.actionType)} on ${selected.vehicleId}, at ` +
          `${selected.holdSeconds}s. The situation the automatic controller saw has not changed.`,
    };
  }

  return {
    relation: 'changed',
    tone: 'warning',
    headline: 'The live solve proposes something else',
    authority: AUTHORITY,
    body:
      (stored.selectedActionType
        ? `The stored row proposed ${actionLabel(stored.selectedActionType)}` +
          (stored.selectedVehicleId ? ` on ${stored.selectedVehicleId}` : '')
        : 'The stored row selected no action') +
      `, and a solve taken now selects ${actionLabel(selected.actionType)} on ${selected.vehicleId} ` +
      `at ${selected.holdSeconds}s. The corridor moved on.`,
  };
}
