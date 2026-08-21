import 'server-only';

/**
 * The network-wide alert feed.
 *
 * ─── WHAT THIS FIXES ─────────────────────────────────────────────────────
 *
 * Bunching detection has run on a timer since the core data model, writing
 * `bunching_incidents` rows across every eligible corridor. The product's only
 * way to SEE one was the control-room console's per-corridor panel: an
 * operator picked a route-direction, and was told what was wrong with that
 * route-direction. On a network of ~1,020 active route-directions that means
 * an incident reached a human only if somebody happened to be looking at the
 * exact corridor it was on, at the time it was open. Detection was automatic;
 * noticing was not.
 *
 * This is the read that makes the whole population visible at once.
 *
 * ─── WHY IT CACHES, WHEN recommendations.ts REFUSES TO ───────────────────
 *
 * A recommendation is deliberately uncached in this directory, because the
 * solver stamps every candidate with a freshness verdict that expires (90 s)
 * and a cached proposal is one whose "safe" stamp has quietly lapsed.
 *
 * An alert is the opposite kind of object. It is a statement that something
 * IS wrong, made from samples up to a minute old already, and it carries no
 * verdict that decays - nothing acts on it without a human opening it and
 * asking for a solution, at which point `solveRouteDirection` runs fresh and
 * uncached. So a short cache here costs an operator a few seconds of latency
 * on a list, and buys the control service protection from every open console
 * polling the whole network's incident table on its own refresh clock.
 *
 * The TTL is deliberately shorter than the headway sweep's own cadence
 * (HEADWAY_COMPUTE_INTERVAL_MS, 60 s default), so the cache can never be the
 * reason an operator is looking at a stale generation of the data - the
 * upstream simply has nothing newer to give for most of that window.
 *
 * ─── AND WHY IT SERVES STALE ON FAILURE, RATHER THAN NOTHING ─────────────
 *
 * When the control service cannot be reached, `readAlertFeed` returns the last
 * good feed and says how old it is, rather than throwing. An alert inbox that
 * empties itself during an outage is actively dangerous: an empty list is the
 * same shape as "the network is fine", and this is the one surface where those
 * two must never look alike. The caller renders the age and the caller's UI
 * says the feed is not live.
 */
import { fetchControlService } from './client';
import { ControlServiceResponseShapeError } from './commands';
import { TtlCache } from '@/lib/upsrtc/cache';
import { alertFeedSchema, type AlertFeed } from '@/models/control';

const ALERTS_PATH = '/v1/alerts';

/** Shorter than the 60 s headway sweep, so the cache never hides a newer generation. */
const ALERT_CACHE_TTL_MS = 15_000;

/** How many alerts one page asks for. The endpoint caps at 200. */
export const ALERT_PAGE_LIMIT = 50;

const feedCache = new TtlCache<AlertFeed>(ALERT_CACHE_TTL_MS);
const CACHE_KEY = 'network';

export interface AlertFeedResult {
  feed: AlertFeed;
  /**
   * True when the control service could not be reached and this is the last
   * feed that arrived successfully.
   *
   * The caller MUST surface this. An alert list is the one surface where
   * "nothing is wrong" and "we cannot tell you what is wrong" must never
   * render identically.
   */
  stale: boolean;
  /** Age of the data in milliseconds, so a UI can say how far behind it is. */
  ageMs: number;
}

/**
 * Every open alert on the network, worst and soonest first.
 *
 * Never throws for an unreachable control service - see the note above on why
 * an empty list would be the wrong answer. Throws only for a response that
 * does not match the contract, which is a deployment mismatch rather than an
 * outage and must not be silently absorbed into a stale-looking feed.
 */
export async function readAlertFeed(limit: number = ALERT_PAGE_LIMIT): Promise<AlertFeedResult> {
  const cached = feedCache.get(CACHE_KEY);
  if (cached) {
    return { feed: cached, stale: false, ageMs: feedCache.ageMs(CACHE_KEY) ?? 0 };
  }

  try {
    const payload = await fetchControlService(`${ALERTS_PATH}?limit=${limit}`, { method: 'GET' });
    const parsed = alertFeedSchema.safeParse(payload);
    if (!parsed.success) throw new ControlServiceResponseShapeError(ALERTS_PATH);

    feedCache.set(CACHE_KEY, parsed.data);
    return { feed: parsed.data, stale: false, ageMs: 0 };
  } catch (error) {
    // A contract mismatch is a bug in the deployment pair, not an outage.
    // Absorbing it here would let the two halves drift apart while the inbox
    // showed a plausible, permanently frozen list.
    if (error instanceof ControlServiceResponseShapeError) throw error;

    const lastGood = feedCache.getLastGood(CACHE_KEY);
    if (lastGood) {
      return { feed: lastGood.value, stale: true, ageMs: Date.now() - lastGood.storedAt };
    }
    throw error;
  }
}

/** Test-only: drop both the TTL cache and the outage fallback. */
export function _resetAlertCacheForTests(): void {
  feedCache.clear();
}
