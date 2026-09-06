'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  OpsAlert,
  OpsBadge,
  OpsButton,
  OpsEmptyState,
  OpsIdentifier,
  OpsPanel,
  OpsReadout,
  OpsStack,
} from '@/components/ops/ui';
import { actionLabel, type RecommendationResult } from '@/lib/ops/recommendationView';
import {
  describeFeedEmptiness,
  describeProposalAge,
  reconcileWithLiveSolve,
} from '@/lib/ops/standingProposalView';
import type {
  StandingRecommendation,
  StandingRecommendationFeed,
} from '@/models/recommendationFeed';

/**
 * What the automatic controller has been saying while nobody was looking.
 *
 * ─── THE GAP THIS CLOSES ─────────────────────────────────────────────────
 *
 * control-service's decision cycle has solved every eligible corridor every
 * 90 seconds since it landed and written a `recommendations` row each time.
 * Nothing read that table — no route served it and no console fetched it — so
 * every proposal a dispatcher ever saw came from the live solve taken when
 * they opened a corridor themselves. The automatic loop's whole output was
 * written and discarded, which left the product in exactly the state the
 * automatic loop was built to fix: a corridor coming apart at 03:00 reached a
 * human only if somebody happened to be looking at it.
 *
 * ─── WHY IT SITS UNDER THE ALERTS ────────────────────────────────────────
 *
 * An alert says what is WRONG. A standing proposal says what the controller
 * would DO about it. They are two halves of one question and only one half
 * has ever been visible. Putting them on one screen also keeps the honest
 * relationship between them in view: this list is not a second alert feed, and
 * an empty one says nothing about whether the network is healthy — the list
 * above answers that.
 *
 * ─── NOTHING HERE CAN BE ISSUED, AND THAT IS STRUCTURAL ──────────────────
 *
 * There is no approve affordance below, and there could not be one: the feed
 * does not carry the candidate objects an approval would name (see
 * src/models/recommendationFeed.ts). A stored row's safety verdict was graded
 * against the clock at solve time and nobody reads a list within the 90 s that
 * verdict lasts. So a row's job is to say WHERE TO LOOK. Acting means taking a
 * live solve — the same POST the alert panel above uses — and then the
 * unchanged dispatcher-approval path.
 */
export function StandingProposalsPanel({
  initialFeed,
  initialError,
}: {
  initialFeed: (StandingRecommendationFeed & { stale?: boolean; ageMs?: number }) | null;
  initialError?: string;
}) {
  const [feed, setFeed] = useState(initialFeed);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/ops/control-room/recommendations/feed', {
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => null)) as
        | (StandingRecommendationFeed & { stale?: boolean; ageMs?: number })
        | { error: { code: string; message: string } }
        | null;
      if (!response.ok || !data || 'error' in data) {
        // The previous feed is KEPT. Blanking it would add a third meaning to
        // a rendering that already has to separate "the controller proposed
        // nothing" from "the controller is not running".
        setError(
          data && 'error' in data
            ? data.error.message
            : 'The standing proposals could not be refreshed.',
        );
        return;
      }
      setFeed(data);
      setError(null);
    } catch {
      setError('The standing proposals could not be refreshed.');
    }
  }, []);

  // Matches the decision cycle's own 90 s cadence: refreshing faster re-reads
  // a table that has nothing new in it.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 90_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const rows = useMemo(() => feed?.recommendations ?? [], [feed]);
  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  // Measured against the feed's OWN `generatedAt`, never the reader's clock.
  // A client clock does not exist during the server render, and this copy is
  // the only thing standing between an empty list and an all-clear - it must
  // be in the first paint, not arrive in an effect a moment later.
  const emptiness = useMemo(() => (feed ? describeFeedEmptiness(feed) : null), [feed]);

  return (
    <OpsPanel
      title="What the automatic controller proposed"
      description="Recorded by the decision cycle on its own timer, without anyone opening a corridor. A record of what was proposed - not an offer to act on."
    >
      <OpsStack>
        {feed === null ? (
          <OpsAlert tone="warning" title="These proposals could not be read">
            {error ??
              'The control service did not answer, so what the automatic controller has proposed is unknown - not nothing.'}
          </OpsAlert>
        ) : null}

        {feed?.stale ? (
          <OpsAlert tone="warning" title="This list is not live">
            The control service did not answer, so this is the last list that arrived
            {typeof feed.ageMs === 'number' ? ` (${Math.round(feed.ageMs / 1000)}s ago)` : ''}. It is
            shown rather than emptied because an empty list here reads as &ldquo;the controller has
            nothing to say&rdquo;, which is a different claim.
          </OpsAlert>
        ) : null}

        {error && feed !== null ? (
          <OpsAlert tone="warning" title="The last refresh failed">
            {error} The list below is from the last successful read.
          </OpsAlert>
        ) : null}

        {emptiness ? (
          <OpsAlert tone={emptiness.tone} title={emptiness.headline}>
            {emptiness.body}
          </OpsAlert>
        ) : null}

        {feed && rows.length === 0 && emptiness === null ? (
          <OpsEmptyState>Reading what the automatic controller has proposed…</OpsEmptyState>
        ) : null}

        {rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((row) => (
              <ProposalRow
                key={row.id}
                recommendation={row}
                freshWithinSeconds={feed!.freshWithinSeconds}
                selected={row.id === selectedId}
                onSelect={() => setSelectedId(row.id === selectedId ? null : row.id)}
              />
            ))}
          </ul>
        ) : null}

        {rows.length > 0 && feed!.totalWithinWindow > rows.length ? (
          <p className="text-xs text-muted-foreground">
            Showing {rows.length} of {feed!.totalWithinWindow} corridors with a standing proposal.
          </p>
        ) : null}

        {selected ? (
          <LiveCheck
            key={selected.id}
            recommendation={selected}
            freshWithinSeconds={feed!.freshWithinSeconds}
          />
        ) : null}
      </OpsStack>
    </OpsPanel>
  );
}

function corridorLine(r: StandingRecommendation): string {
  return `${r.routePublicName} · ${r.directionName ?? r.directionCode}`;
}

/**
 * One corridor's standing proposal.
 *
 * The age badge is not decoration. It is the difference between "the
 * controller said this a moment ago" and "the controller said this and nothing
 * has confirmed it since", and without it the two render identically — which
 * is the trap the alert inbox already learned about empty lists.
 */
function ProposalRow({
  recommendation,
  freshWithinSeconds,
  selected,
  onSelect,
}: {
  recommendation: StandingRecommendation;
  freshWithinSeconds: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const age = describeProposalAge(recommendation, freshWithinSeconds);
  const paceCount = recommendation.paceAdvisories.length;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        aria-current={selected ? 'true' : undefined}
        className={`ops-well w-full px-4 py-3 text-left transition-colors ${
          selected ? 'ring-2 ring-primary/50' : 'hover:bg-muted/50'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{corridorLine(recommendation)}</span>
          <OpsBadge variant={age.tone === 'warning' ? 'critical' : 'neutral'}>{age.badge}</OpsBadge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {recommendation.selectedActionType ? (
            <>
              <span>{actionLabel(recommendation.selectedActionType)}</span>
              {recommendation.selectedVehicleId ? (
                <OpsIdentifier>{recommendation.selectedVehicleId}</OpsIdentifier>
              ) : null}
              {recommendation.selectedHoldSeconds !== null ? (
                <span>· {recommendation.selectedHoldSeconds}s</span>
              ) : null}
            </>
          ) : (
            // A row with no selected action is not an empty row: the decision
            // cycle writes one when the only useful advice on a corridor is
            // "ease off", which is the advice a hold-shaped surface loses.
            <span>No hold selected</span>
          )}
          {paceCount > 0 ? (
            <span>
              · {paceCount === 1 ? '1 bus' : `${paceCount} buses`} advised to ease off
            </span>
          ) : null}
          {recommendation.incidentId === null ? (
            <span>· No open incident — drift caught before the detector raised one</span>
          ) : null}
        </div>
      </button>
    </li>
  );
}

/**
 * The stored row, checked against the corridor as it is now.
 *
 * ─── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────
 *
 * Showing a stored proposal beside a live one and leaving the operator to
 * work out which is which is the failure mode this panel is most exposed to.
 * The two are not peers: `mpc/safety.ts` grades a candidate against vehicle
 * state no older than 90 seconds and stamps that verdict at solve time, so a
 * live solve's verdict is about the clock the operator is acting on and a
 * stored row's is about a clock that has moved. THE LIVE SOLVE IS
 * AUTHORITATIVE, ALWAYS, and `reconcileWithLiveSolve` says so in the copy
 * rather than leaving the layout to imply it.
 *
 * It is also why the live solve is taken on demand, one corridor at a time,
 * exactly as the alert panel above does it: solving every listed corridor on
 * render would run the control laws across the network on every glance and
 * produce a screenful of verdicts that had all quietly lapsed.
 */
function LiveCheck({
  recommendation,
  freshWithinSeconds,
}: {
  recommendation: StandingRecommendation;
  freshWithinSeconds: number;
}) {
  const [live, setLive] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);

  const solve = useCallback(async () => {
    setLoading(true);
    setSolveError(null);
    try {
      const response = await fetch('/api/ops/control-room/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeDirectionId: recommendation.routeDirectionId }),
      });
      const data = (await response.json().catch(() => null)) as
        | RecommendationResult
        | { error: { code: string; message: string } }
        | null;
      if (!response.ok || !data || 'error' in data) {
        setLive(null);
        setSolveError(
          data && 'error' in data ? data.error.message : 'The decision engine could not be asked.',
        );
        return;
      }
      setLive(data);
    } catch {
      setLive(null);
      setSolveError('The decision engine could not be reached.');
    } finally {
      setLoading(false);
    }
  }, [recommendation.routeDirectionId]);

  const age = describeProposalAge(recommendation, freshWithinSeconds);
  const reconciliation = reconcileWithLiveSolve(recommendation, live);

  return (
    <OpsPanel title={corridorLine(recommendation)} tone="accent">
      <OpsStack gap="tight">
        <OpsAlert tone={age.tone} title={`What was recorded: ${age.badge.toLowerCase()}`}>
          {age.detail}
        </OpsAlert>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <OpsReadout
            label="Proposed"
            value={
              recommendation.selectedActionType
                ? actionLabel(recommendation.selectedActionType)
                : 'No hold'
            }
          />
          <OpsReadout label="Bus" value={recommendation.selectedVehicleId ?? '—'} />
          <OpsReadout
            label="Hold"
            value={
              recommendation.selectedHoldSeconds === null
                ? '—'
                : `${recommendation.selectedHoldSeconds}s`
            }
          />
          <OpsReadout
            label="Safe candidates"
            value={String(recommendation.candidateActionCount)}
          />
        </div>

        {solveError ? (
          <OpsAlert tone="warning" title="The engine could not be asked">
            {solveError} The stored row below stays unconfirmed — a failed solve is not agreement.
          </OpsAlert>
        ) : null}

        <OpsAlert tone={reconciliation.tone} title={reconciliation.headline}>
          <p className="mb-2">{reconciliation.body}</p>
          <p className="font-medium">{reconciliation.authority}</p>
        </OpsAlert>

        <OpsStack gap="tight">
          <OpsButton variant="primary" onClick={solve} disabled={loading}>
            {loading
              ? 'Solving…'
              : live
                ? 'Solve this corridor again'
                : 'Solve this corridor now'}
          </OpsButton>
          {/*
            The hand-off, and the only route to a bus. Issuing lives in the
            console because the approval matching and the two-step confirm
            already live there; a second copy of a safety-relevant rule is
            exactly the drift this path must not have. Note this links to the
            console, NOT to anything that could act on the stored row.
          */}
          <Link
            href={`/ops/control-room?tab=decisions&routeDirectionId=${encodeURIComponent(recommendation.routeDirectionId)}`}
            className="ops-button inline-flex items-center justify-center"
          >
            Open this corridor in the console
          </Link>
        </OpsStack>
      </OpsStack>
    </OpsPanel>
  );
}
