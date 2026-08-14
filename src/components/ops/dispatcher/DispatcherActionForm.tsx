'use client';

import { useId, useState } from 'react';

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
  'override',
] as const;

type ActionType = (typeof ACTION_TYPES)[number];

interface SuccessState {
  dispatcherActionId: string;
  createdAt: string;
}

/**
 * Functional in-page action for POST /api/ops/dispatcher/approvals (this
 * ticket's AC3: "surfaced ... as functional in-page actions ... rather than
 * plain links"). A successful submission returns the new
 * dispatcherActionId, the id Control Room needs to reference from
 * POST /api/ops/control-room/commands — shown prominently so a dispatcher
 * can hand it off.
 */
export function DispatcherActionForm() {
  const [actionType, setActionType] = useState<ActionType>('override');
  const [reason, setReason] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [routeDirectionId, setRouteDirectionId] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const errorId = useId();
  const successId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/ops/dispatcher/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          reason,
          vehicleId: vehicleId.trim() || undefined,
          routeDirectionId: routeDirectionId.trim() || undefined,
          incidentId: incidentId.trim() || undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | { ok: true; dispatcherActionId: string; createdAt: string }
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error.message) || 'Failed to record the approval.');
        setStatus('error');
        return;
      }

      setSuccess({ dispatcherActionId: data.dispatcherActionId, createdAt: data.createdAt });
      setStatus('success');
      setReason('');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-ops-line p-4">
      <h2 className="ops-label">
        Record approval / override
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="actionType" className="mb-1 block text-xs text-ops-muted">
            Action type
          </label>
          <select
            id="actionType"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ActionType)}
            className="ops-input"
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
            Vehicle (optional)
          </label>
          <input
            id="vehicleId"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="e.g. UP25FT4823"
            className="ops-input"
          />
        </div>
        <div>
          <label htmlFor="routeDirectionId" className="mb-1 block text-xs text-ops-muted">
            Route direction (optional)
          </label>
          <input
            id="routeDirectionId"
            value={routeDirectionId}
            onChange={(e) => setRouteDirectionId(e.target.value)}
            className="ops-input"
          />
        </div>
        <div>
          <label htmlFor="incidentId" className="mb-1 block text-xs text-ops-muted">
            Incident (optional)
          </label>
          <input
            id="incidentId"
            value={incidentId}
            onChange={(e) => setIncidentId(e.target.value)}
            className="ops-input"
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason" className="mb-1 block text-xs text-ops-muted">
          Reason
        </label>
        <textarea
          id="reason"
          required
          minLength={1}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          aria-describedby={error ? errorId : undefined}
          className="ops-input"
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-alert-crimson">
          {error}
        </p>
      )}

      {success && (
        <p id={successId} role="status" className="text-sm text-ops-good">
          Recorded. dispatcherActionId:{' '}
          <code className="rounded bg-ops-line px-1.5 py-0.5 font-mono text-ops-ink">
            {success.dispatcherActionId}
          </code>{' '}
          — pass this to Control Room to authorize a command.
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || reason.trim().length === 0}
        className="ops-button-primary px-5 py-2"
      >
        {submitting ? 'Recording…' : 'Record approval / override'}
      </button>
    </form>
  );
}
