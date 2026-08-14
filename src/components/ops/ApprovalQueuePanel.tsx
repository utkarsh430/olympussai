'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface QueuedAction {
  id: string;
  dispatcherUserId: string;
  actionType: string;
  reason: string;
  routeDirectionId: string | null;
  vehicleId: string | null;
  incidentId: string | null;
  consumedAt: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  createdAt: string;
  decision: 'pending' | 'approved' | 'rejected';
}

type FetchState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; actions: QueuedAction[] };

/**
 * Approval queue for disruptive dispatcher actions (this ticket's AC2:
 * "handles disruptive actions (skip/short-turn/standby/boarding-limits);
 * decisions logged with reason and actor"). Reads GET
 * /api/ops/dispatcher/approvals (status=pending, disruptiveOnly=true by
 * default). Two render modes:
 *   - canDecide=false (dispatcher dashboard): read-only visibility into
 *     the queue so a dispatcher can track what they've filed.
 *   - canDecide=true (control-room console): adds a "Reject" action
 *     (POST /api/ops/control-room/approvals/:id/reject) and an "Approve —
 *     issue command" button that hands the id to onApprove, which
 *     ControlRoomConsole wires to ControlRoomCommandForm — approving *is*
 *     issuing the command that consumes this id, per that form's own doc
 *     comment.
 */
export function ApprovalQueuePanel({
  canDecide,
  onApprove,
  disruptiveOnly = true,
  refreshToken,
}: {
  canDecide: boolean;
  onApprove?: (dispatcherActionId: string) => void;
  /**
   * Narrow to the four disruptive action types, as the AC's queue does.
   *
   * The control-room console passes `false`, and that is load-bearing rather
   * than a preference: the decision engine only ever proposes HOLDS, and holds
   * are not in the disruptive subset. Left at the default, a dispatcher's
   * approval of the exact hold the engine just recommended would never appear
   * in the control room's own queue.
   */
  disruptiveOnly?: boolean;
  /**
   * Reload whenever this changes. The console drives every panel from one
   * clock so the whole screen describes the same moment; without it this queue
   * would keep showing whatever was pending when the page was opened, which on
   * a time-critical queue is the one thing it must not do.
   */
  refreshToken?: number;
}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * `silent` is what makes an auto-refreshing queue usable.
   *
   * A background reload that flips this panel back to its "Loading approval
   * queue…" placeholder would, every fifteen seconds, blank the list an
   * operator is reading and tear the half-typed rejection reason out from
   * under them. So a poll leaves the current list on screen and swaps it only
   * once the new one has actually arrived; only the first load, and an
   * explicit reload after the operator's own action, show the placeholder.
   */
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ status: 'loading' });
      try {
        const response = await fetch(
          `/api/ops/dispatcher/approvals?status=pending&disruptiveOnly=${disruptiveOnly ? 'true' : 'false'}`,
          { cache: 'no-store' },
        );
        const data = (await response.json().catch(() => null)) as
          | { actions: QueuedAction[] }
          | { error: { message: string } }
          | null;
        if (!response.ok || !data || 'error' in data) {
          const message =
            (data && 'error' in data && data.error.message) || 'Failed to load the approval queue.';
          // A failed BACKGROUND poll must not replace a good list with an
          // error: the queue on screen is still the last real one. The
          // console's own status line reports the refresh failure.
          setState((previous) =>
            silent && previous.status === 'ready' ? previous : { status: 'error', message },
          );
          return;
        }
        setState({ status: 'ready', actions: data.actions });
      } catch {
        setState((previous) =>
          silent && previous.status === 'ready'
            ? previous
            : { status: 'error', message: 'Something went wrong. Please try again.' },
        );
      }
    },
    [disruptiveOnly],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Separate from the mount effect so a console tick refreshes quietly while
  // the first load, and a reload after this operator's own reject, do not.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    void load(true);
  }, [refreshToken, load]);

  async function submitReject(id: string) {
    if (submitting) return;
    setSubmitting(true);
    setRejectError(null);
    try {
      const response = await fetch(`/api/ops/control-room/approvals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const data = (await response.json().catch(() => null)) as { ok: true } | { error: { message: string } } | null;
      if (!response.ok || !data || !('ok' in data)) {
        setRejectError((data && 'error' in data && data.error.message) || 'Failed to reject this action.');
        setSubmitting(false);
        return;
      }
      setRejectingId(null);
      setRejectReason('');
      setSubmitting(false);
      await load();
    } catch {
      setRejectError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-ops-muted">Loading approval queue…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-alert-crimson">
        {state.message}
      </p>
    );
  }
  if (state.actions.length === 0) {
    return (
      <p className="ops-well px-4 py-3 text-sm text-ops-muted">
        {/* The wording has to match what was actually asked for. Saying "no
            disruptive actions" on the control-room console, which reads the
            queue unfiltered, would imply a narrower search than the one that
            came back empty. */}
        {disruptiveOnly
          ? 'No disruptive actions awaiting a decision.'
          : 'No dispatcher approvals awaiting a decision, of any action type.'}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {state.actions.map((action) => (
        <li key={action.id} className="rounded-md border border-ops-line px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-holo-glow">
              {action.actionType.replace(/_/g, ' ')}
            </span>
            <span className="text-[11px] text-ops-faint">{new Date(action.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-1 text-sm text-ops-ink">{action.reason}</p>
          <p className="mt-1 font-mono text-[11px] text-ops-faint">
            {[
              action.vehicleId ? `vehicle ${action.vehicleId}` : null,
              action.routeDirectionId ? `route-direction ${action.routeDirectionId}` : null,
              action.incidentId ? `incident ${action.incidentId}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'no target scoped'}
          </p>
          <p className="mt-1 font-mono text-[10px] text-ops-faint">id: {action.id}</p>

          {canDecide && (
            <div className="mt-3 space-y-2 border-t border-ops-line/70 pt-3">
              {rejectingId === action.id ? (
                <div className="space-y-2">
                  <label htmlFor={`reject-reason-${action.id}`} className="block text-xs text-ops-muted">
                    Rejection reason
                  </label>
                  <textarea
                    id={`reject-reason-${action.id}`}
                    required
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                    className="ops-input"
                  />
                  {rejectError && (
                    <p role="alert" className="text-xs text-alert-crimson">
                      {rejectError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={submitting || rejectReason.trim().length === 0}
                      onClick={() => submitReject(action.id)}
                      className="ops-button-danger text-ops-danger"
                    >
                      {submitting ? 'Rejecting…' : 'Confirm reject'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectError(null);
                      }}
                      className="ops-button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onApprove?.(action.id)}
                    className="ops-button border-alert-green/60 bg-alert-green/10 text-ops-good hover:border-alert-green hover:bg-alert-green/20 hover:text-ops-good"
                  >
                    Approve — issue command
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectingId(action.id)}
                    className="ops-button-danger text-ops-danger"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
