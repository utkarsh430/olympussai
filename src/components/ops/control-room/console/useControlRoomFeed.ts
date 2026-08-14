'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ControlRoomOverview } from '@/lib/ops/controlRoomOverviewModel';
import type { PendingApproval, RecommendationResult } from '@/lib/ops/recommendationView';

/**
 * The console's one clock.
 *
 * ─── WHY POLLING, AND WHY DELIBERATELY ───────────────────────────────────
 *
 * Every ops page before this was a static server render: the numbers under a
 * control-room operator were as current as their last manual reload, and a new
 * bunching incident could sit undetected for as long as nobody pressed F5.
 * That is not a control room. So the console polls.
 *
 * Polling rather than a socket because this app has no socket transport to
 * maintain, and because the upstreams are already sampled, not streamed: the
 * fleet snapshot is cached 15s server-side, and the headway sweep that opens
 * incidents runs on a 60s job. A push channel would deliver the same values at
 * the same times over infrastructure nobody is on call for.
 *
 * ─── WHY ONE CLOCK AND NOT FOUR ──────────────────────────────────────────
 *
 * The status band, the engine's proposal and the approval queue are read
 * TOGETHER on a single 15s tick, so everything on screen describes the same
 * moment. Three independent timers would drift into three different moments
 * presented as one instant, and the specific failure that causes is an
 * operator reading a proposal about a bus whose position on the map beside it
 * is from a different sample — a disagreement that looks like a data bug and
 * is really a scheduling one. 15s matches the server-side fleet cache TTL, so
 * a faster cadence would mostly re-serve identical bytes.
 *
 * ─── WHY IT STOPS WHEN NOBODY IS LOOKING ─────────────────────────────────
 *
 * Each tick asks the decision engine to run a real five-tier solve. A console
 * left open on an unattended screen would do that four times a minute forever.
 * Polling pauses while the tab is hidden and refreshes immediately on return,
 * so the first thing a returning operator sees is current rather than however
 * old the last tick was.
 *
 * ─── WHAT IT REFUSES TO DO ───────────────────────────────────────────────
 *
 * Keep a failed recommendation on screen as if it were current. The status
 * band and the approval queue keep their last good value on a failed poll
 * (an ops display that blanks on one dropped request is worse than one that
 * says how old it is), but a recommendation is not a dashboard number: the
 * engine grades candidate freshness against the clock at solve time, so a
 * retained one wears a safety verdict that has expired. On failure the error
 * is surfaced and the stale proposal is dropped.
 */

/** Matches the server-side fleet cache TTL; polling faster re-serves the same snapshot. */
export const CONSOLE_POLL_INTERVAL_MS = 15_000;
/** How often displayed ages re-render. Coarser than 1s on purpose: this re-renders the console tree. */
const CONSOLE_CLOCK_INTERVAL_MS = 5_000;

export interface ControlRoomFeed {
  overview: ControlRoomOverview | null;
  overviewError: string | null;
  recommendation: RecommendationResult | null;
  recommendationError: { code: string; message: string } | null;
  recommendationLoading: boolean;
  approvals: PendingApproval[];
  approvalsError: string | null;
  /** Wall clock, coarse. Drives every age readout without each one owning a timer. */
  now: number;
  /** Increments on every completed refresh; panels that fetch for themselves watch it. */
  refreshToken: number;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  refreshNow: () => void;
}

export function useControlRoomFeed(options: {
  initialOverview: ControlRoomOverview | null;
  routeDirectionId: string | null;
  intervalMs?: number;
}): ControlRoomFeed {
  const { initialOverview, routeDirectionId, intervalMs = CONSOLE_POLL_INTERVAL_MS } = options;

  const [overview, setOverview] = useState<ControlRoomOverview | null>(initialOverview);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);
  const [recommendationError, setRecommendationError] = useState<{ code: string; message: string } | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshToken, setRefreshToken] = useState(0);
  const [paused, setPaused] = useState(false);
  const [manualTrigger, setManualTrigger] = useState(0);

  // Guards every async write: a response that lands after the corridor changed,
  // or after unmount, must not paint a proposal about the wrong corridor.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CONSOLE_CLOCK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const refreshNow = useCallback(() => setManualTrigger((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const requestId = (requestIdRef.current += 1);
    const current = () => !cancelled && requestIdRef.current === requestId;

    async function loadOverview() {
      try {
        const query = routeDirectionId ? `?routeDirectionId=${encodeURIComponent(routeDirectionId)}` : '';
        const response = await fetch(`/api/ops/control-room/overview${query}`, { cache: 'no-store' });
        if (!current()) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          if (!current()) return;
          setOverviewError(body?.error?.message ?? `The console could not refresh (HTTP ${response.status}).`);
          return;
        }
        const data = (await response.json()) as ControlRoomOverview;
        if (!current()) return;
        setOverview(data);
        setOverviewError(null);
      } catch {
        if (current()) setOverviewError('The console could not refresh — showing the last readings taken.');
      }
    }

    async function loadRecommendation() {
      if (!routeDirectionId) {
        if (current()) {
          setRecommendation(null);
          setRecommendationError(null);
        }
        return;
      }
      if (current()) setRecommendationLoading(true);
      try {
        const response = await fetch('/api/ops/control-room/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routeDirectionId }),
        });
        const data = (await response.json().catch(() => null)) as
          | RecommendationResult
          | { error: { code: string; message: string } }
          | null;
        if (!current()) return;
        if (!response.ok || !data || 'error' in data) {
          // Dropped, not retained. See this module's header: a recommendation
          // that cannot be re-derived is one whose safety verdict has lapsed.
          setRecommendation(null);
          setRecommendationError(
            data && 'error' in data
              ? data.error
              : { code: 'UNKNOWN', message: 'The decision engine could not be asked.' },
          );
          return;
        }
        setRecommendation(data);
        setRecommendationError(null);
      } catch {
        if (!current()) return;
        setRecommendation(null);
        setRecommendationError({
          code: 'CONTROL_SERVICE_UNAVAILABLE',
          message: 'The decision engine could not be reached from this browser.',
        });
      } finally {
        if (current()) setRecommendationLoading(false);
      }
    }

    async function loadApprovals() {
      try {
        // disruptiveOnly=false is load-bearing, not a widening for its own
        // sake. The default queue is scoped to the four disruptive action
        // types, and the engine only ever proposes HOLDS - which are not among
        // them. Read with the default and a dispatcher's approval of the exact
        // hold the engine just proposed would be invisible here, so the console
        // would report "no approval on file" while one sat in the queue.
        const response = await fetch('/api/ops/dispatcher/approvals?status=pending&disruptiveOnly=false', {
          cache: 'no-store',
        });
        if (!current()) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          if (!current()) return;
          setApprovalsError(body?.error?.message ?? 'The approval queue could not be read.');
          return;
        }
        const data = (await response.json()) as { actions: PendingApproval[] };
        if (!current()) return;
        setApprovals(data.actions ?? []);
        setApprovalsError(null);
      } catch {
        if (current()) setApprovalsError('The approval queue could not be read.');
      }
    }

    async function poll() {
      await Promise.all([loadOverview(), loadRecommendation(), loadApprovals()]);
      if (current()) {
        setNow(Date.now());
        setRefreshToken((token) => token + 1);
      }
    }

    void poll();
    if (paused) return () => { cancelled = true; };

    const timer = setInterval(() => {
      // Nothing on an unattended screen needs a five-tier solve every 15s.
      if (typeof document !== 'undefined' && document.hidden) return;
      void poll();
    }, intervalMs);

    function onVisible() {
      if (typeof document !== 'undefined' && !document.hidden) void poll();
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [routeDirectionId, intervalMs, paused, manualTrigger]);

  return {
    overview,
    overviewError,
    recommendation,
    recommendationError,
    recommendationLoading,
    approvals,
    approvalsError,
    now,
    refreshToken,
    paused,
    setPaused,
    refreshNow,
  };
}
