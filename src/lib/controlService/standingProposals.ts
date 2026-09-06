import 'server-only';

/**
 * The standing-proposal feed: what the automatic decision cycle currently says
 * about every corridor it has looked at.
 *
 * ─── WHAT THIS FIXES ─────────────────────────────────────────────────────
 *
 * `scheduler/decisionCycle.ts` has run every 90 seconds since it landed,
 * solving every eligible corridor and writing a `recommendations` row. Nothing
 * read that table. The only importer of the write module in the whole control
 * service was the cycle itself, whose `findLatestRecommendation` feeds its own
 * duplicate check; no route served the table and no console fetched it. So
 * every proposal a dispatcher ever saw came from the SYNCHRONOUS solve taken
 * when they opened a corridor themselves — the exact "somebody has to be
 * looking at the right corridor at the right moment" problem the automatic
 * cycle was built to remove. Its output was written and discarded.
 *
 * This is the read that gives it a consumer.
 *
 * ─── WHY IT CACHES, AND WHY THAT IS SAFE HERE ────────────────────────────
 *
 * `recommendations.ts` in this directory refuses to cache, because a solve
 * stamps every candidate with a freshness verdict that expires in 90 s and a
 * cached proposal is one whose "safe" stamp has quietly lapsed.
 *
 * This feed is the other kind of object, for the same reason `alerts.ts`
 * caches. It is a statement about what the controller SAID, already minutes
 * old by the time anyone reads it, and nothing acts on it: the row cannot be
 * approved — the wire contract does not even carry the candidate objects an
 * approval would name — and the operator's next step is a live solve that runs
 * fresh and uncached. A short cache costs a few seconds of latency on a list
 * and buys the control service protection from every open console polling the
 * network's proposal table on its own refresh clock.
 *
 * The TTL is shorter than the decision cycle's own 90 s cadence, so the cache
 * can never be the reason an operator is a generation behind — upstream simply
 * has nothing newer to give for most of that window.
 *
 * ─── AND WHY IT SERVES STALE ON FAILURE ──────────────────────────────────
 *
 * Same rule as the alert inbox, and it bites harder here. An empty list of
 * proposals is already ambiguous — the controller proposed nothing, or the
 * controller is not running — and blanking it on an outage adds a third
 * meaning to the same pixels. So on failure this returns the last good feed
 * and says how old it is, and the caller renders that.
 */
import { fetchControlService } from './client';
import { ControlServiceResponseShapeError } from './commands';
import { TtlCache } from '@/lib/upsrtc/cache';
import {
  standingRecommendationFeedSchema,
  type StandingRecommendationFeed,
} from '@/models/recommendationFeed';

const FEED_PATH = '/v1/recommendations';

/** Shorter than the decision cycle's 90 s cadence, so the cache never hides a newer generation. */
const FEED_CACHE_TTL_MS = 20_000;

/** How many corridors one page asks for. The endpoint caps at its own configured ceiling. */
export const STANDING_PROPOSAL_PAGE_LIMIT = 50;

const feedCache = new TtlCache<StandingRecommendationFeed>(FEED_CACHE_TTL_MS);
const CACHE_KEY = 'network';

/**
 * Whether this app asks for the feed at all.
 *
 * OFF by default, and off is a TRUE no-op: `readStandingProposals` refuses
 * before it constructs a request, the API route 404s, and the console mounts
 * nothing. The control service has a switch of the same name gating its own
 * endpoint, and the two are independent on purpose — the halves deploy
 * separately and there is no ordering of two deploys in which one is not
 * briefly ahead of the other. Off on both is the state where neither half can
 * be surprised by the other.
 *
 * Read per call rather than captured at module load so a deployment can flip
 * it without this module's import order deciding what it saw.
 */
export function isStandingProposalFeedEnabled(): boolean {
  return process.env.RECOMMENDATION_FEED_ENABLED === 'true';
}

/** Thrown when the feed is asked for while the flag is off. Callers turn it into a 404. */
export class StandingProposalFeedDisabledError extends Error {
  constructor() {
    super('The standing-proposal feed is not enabled.');
    this.name = 'StandingProposalFeedDisabledError';
  }
}

export interface StandingProposalFeedResult {
  feed: StandingRecommendationFeed;
  /**
   * True when the control service could not be reached and this is the last
   * feed that arrived successfully.
   *
   * The caller MUST surface this. This list already has to distinguish "the
   * controller proposed nothing" from "the controller is not running"; a
   * silently frozen list would add a third meaning to the same rendering.
   */
  stale: boolean;
  /** Age of the data in milliseconds, so a UI can say how far behind it is. */
  ageMs: number;
}

/**
 * Every corridor's standing proposal, newest first.
 *
 * Never throws for an unreachable control service once a feed has arrived
 * successfully — see the note above. Throws for a response that does not match
 * the contract, which is a deployment mismatch between the two halves rather
 * than an outage and must not be absorbed into a plausible frozen list.
 */
export async function readStandingProposals(
  limit: number = STANDING_PROPOSAL_PAGE_LIMIT,
): Promise<StandingProposalFeedResult> {
  if (!isStandingProposalFeedEnabled()) throw new StandingProposalFeedDisabledError();

  const cached = feedCache.get(CACHE_KEY);
  if (cached) {
    return { feed: cached, stale: false, ageMs: feedCache.ageMs(CACHE_KEY) ?? 0 };
  }

  try {
    const payload = await fetchControlService(`${FEED_PATH}?limit=${limit}`, { method: 'GET' });
    const parsed = standingRecommendationFeedSchema.safeParse(payload);
    if (!parsed.success) throw new ControlServiceResponseShapeError(FEED_PATH);

    feedCache.set(CACHE_KEY, parsed.data);
    return { feed: parsed.data, stale: false, ageMs: 0 };
  } catch (error) {
    if (error instanceof ControlServiceResponseShapeError) throw error;

    const lastGood = feedCache.getLastGood(CACHE_KEY);
    if (lastGood) {
      return { feed: lastGood.value, stale: true, ageMs: Date.now() - lastGood.storedAt };
    }
    throw error;
  }
}

/** Test-only: drop both the TTL cache and the outage fallback. */
export function _resetStandingProposalCacheForTests(): void {
  feedCache.clear();
}
