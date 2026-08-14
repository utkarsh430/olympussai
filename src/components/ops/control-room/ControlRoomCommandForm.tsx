'use client';

import { useEffect, useId, useState } from 'react';

/**
 * The nine real command levers. 'override' is deliberately absent: it is not
 * dispatchable (control-service's commands.action_type CHECK does not include
 * it) and is recorded instead at POST /api/ops/control-room/overrides.
 */
const ACTION_TYPES = [
  'terminal_dispatch_hold',
  'two_way_hold',
  'self_equalizing_hold',
  'speed_guidance',
  'stop_skip',
  'short_turn',
  'deadhead',
  'boarding_limit',
  'standby_injection',
] as const;
type ActionType = (typeof ACTION_TYPES)[number];

const DEFAULT_TTL_SECONDS = 120;

interface SuccessState {
  commandId: string;
  expiresAt: string;
  auditEventId: string;
  status: string;
  deliveredAt: string | null;
}

/**
 * Issues a real command: POST /api/ops/control-room/commands, which now
 * actually reaches the control service rather than only writing an audit row.
 *
 * Requires a dispatcherActionId from an unconsumed dispatcher approval (POST
 * /api/ops/dispatcher/approvals) — the endpoint enforces that non-negotiably
 * (docs/CONTROL_SERVICE_INTEGRATION.md §1), so a 409 DISPATCHER_ACTION_INVALID
 * is a normal, expected error to surface here, not a bug. So is a 422
 * APPROVAL_MISMATCH: the action type, vehicle and route-direction submitted
 * here must be the ones the dispatcher actually approved.
 *
 * routeDirectionId is required on every command (it used to be sent only for
 * route-targeted ones): it is what the route-scoped kill switch and
 * control-service's rollout gate are both checked against.
 *
 * `prefillDispatcherActionId` is set by the approval queue's "Approve — issue
 * command" action (ApprovalQueuePanel via ApprovalAndCommandPanel): issuing a
 * command that consumes a queued action *is* the approval decision, so that
 * flow seeds this field rather than duplicating a separate approve endpoint.
 */
export function ControlRoomCommandForm({ prefillDispatcherActionId }: { prefillDispatcherActionId?: string }) {
  const [dispatcherActionId, setDispatcherActionId] = useState(prefillDispatcherActionId ?? '');
  const [actionType, setActionType] = useState<ActionType>('self_equalizing_hold');
  const [vehicleId, setVehicleId] = useState('');
  const [routeDirectionId, setRouteDirectionId] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(String(DEFAULT_TTL_SECONDS));
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const errorId = useId();
  const successId = useId();

  useEffect(() => {
    if (prefillDispatcherActionId) setDispatcherActionId(prefillDispatcherActionId);
  }, [prefillDispatcherActionId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/ops/control-room/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispatcherActionId,
          actionType,
          vehicleId,
          routeDirectionId,
          parameters: {},
          ttlSeconds: Number(ttlSeconds),
          summary,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            ok: true;
            commandId: string;
            expiresAt: string;
            auditEventId: string;
            status: string;
            deliveredAt: string | null;
          }
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error.message) || 'Failed to issue the command.');
        setStatus('error');
        return;
      }

      setSuccess({
        commandId: data.commandId,
        expiresAt: data.expiresAt,
        auditEventId: data.auditEventId,
        status: data.status,
        deliveredAt: data.deliveredAt,
      });
      setStatus('success');
      setDispatcherActionId('');
      setVehicleId('');
      setRouteDirectionId('');
      setSummary('');
      setTtlSeconds(String(DEFAULT_TTL_SECONDS));
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';
  const inputClass = 'ops-input';

  return (
    <form
      id="control-room-command-form"
      onSubmit={handleSubmit}
      className="space-y-4 rounded-md border border-ops-line p-4"
    >
      <h2 className="ops-label">Issue command</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dispatcherActionId" className="mb-1 block text-xs text-ops-muted">
            Dispatcher action id
          </label>
          <input
            id="dispatcherActionId"
            required
            value={dispatcherActionId}
            onChange={(e) => setDispatcherActionId(e.target.value)}
            placeholder="uuid from a dispatcher approval"
            aria-describedby={error ? errorId : undefined}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="actionType" className="mb-1 block text-xs text-ops-muted">
            Action type
          </label>
          <select
            id="actionType"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ActionType)}
            className={inputClass}
          >
            {ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vehicleId" className="mb-1 block text-xs text-ops-muted">
            Vehicle id
          </label>
          <input
            id="vehicleId"
            required
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="e.g. a vehicle registration"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="routeDirectionId" className="mb-1 block text-xs text-ops-muted">
            Route-direction id
          </label>
          <input
            id="routeDirectionId"
            required
            value={routeDirectionId}
            onChange={(e) => setRouteDirectionId(e.target.value)}
            placeholder="uuid — checked against the kill switch and rollout stage"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ttlSeconds" className="mb-1 block text-xs text-ops-muted">
            TTL (seconds)
          </label>
          <input
            id="ttlSeconds"
            type="number"
            required
            min={15}
            max={900}
            value={ttlSeconds}
            onChange={(e) => setTtlSeconds(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="summary" className="mb-1 block text-xs text-ops-muted">
          Summary
        </label>
        <textarea
          id="summary"
          required
          minLength={1}
          maxLength={2000}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-alert-crimson">
          {error}
        </p>
      )}

      {success && (
        <p id={successId} role="status" className="text-sm text-ops-good">
          {success.status === 'delivered'
            ? 'Command issued and delivered.'
            : success.status === 'authorized'
              ? // The only status commandDeliverySweep's candidate query
                // (control-service/src/db/commands.ts#listCommandsAwaitingDelivery)
                // actually retries — every other non-delivered status below
                // can only come back from reconciling an earlier attempt that
                // already progressed past delivery, which no sweep touches.
                'Command issued, not yet delivered — will retry automatically.'
              : `Command issued — current status: ${success.status}.`}{' '}
          commandId:{' '}
          <code className="rounded bg-ops-line px-1.5 py-0.5 font-mono text-ops-ink">
            {success.commandId}
          </code>{' '}
          — expires {success.expiresAt}. auditEventId:{' '}
          <code className="rounded bg-ops-line px-1.5 py-0.5 font-mono text-ops-ink">
            {success.auditEventId}
          </code>
        </p>
      )}

      <button
        type="submit"
        disabled={
          submitting ||
          summary.trim().length === 0 ||
          dispatcherActionId.trim().length === 0 ||
          vehicleId.trim().length === 0 ||
          routeDirectionId.trim().length === 0
        }
        className="ops-button-primary px-5 py-2"
      >
        {submitting ? 'Issuing…' : 'Issue command'}
      </button>
    </form>
  );
}
