'use client';

import { useEffect, useId, useState } from 'react';
import type { RouteDirectionMeta } from '@/models/control';
import {
  OpsAlert,
  OpsButton,
  OpsField,
  OpsIdentifier,
  OpsInput,
  OpsSelect,
  OpsTextarea,
} from '@/components/ops/ui';
import { ACTION_LABEL } from '@/lib/ops/recommendationView';
import { commandStatusLabel, corridorName } from '@/lib/ops/vocabulary';
import { CorridorPicker } from './CorridorPicker';

/**
 * The nine real instruction levers. 'override' is deliberately absent: it is
 * not dispatchable (control-service's commands.action_type CHECK does not
 * include it) and is recorded instead at POST /api/ops/control-room/overrides.
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
  /** Optional: the endpoint always sends it, but the confirmation must not depend on it. */
  status?: string;
  deliveredAt: string | null;
}

/**
 * Sends a real instruction to a driver: POST /api/ops/control-room/commands.
 *
 * ─── WHAT THIS FORM USED TO ASK FOR ──────────────────────────────────────
 *
 * Its five field labels were, verbatim, `Dispatcher action id`, `Action type`,
 * `Vehicle id`, `Route-direction id` and `TTL (seconds)` — four API property
 * names and an abbreviation. Two of them were free-text boxes whose
 * placeholder was the word "uuid", so sending an instruction to a bus required
 * an operator to type two 36-character identifiers from memory, correctly,
 * while an incident was running. The audit trail's own language audit called
 * this the worst offender in the product and it was not a close contest.
 *
 * Every field is now named for what it IS to the person filling it in, the two
 * uuid boxes are gone, and the summary field says what it is for — it becomes
 * the permanent record of why this instruction was sent.
 *
 * ─── WHAT DID NOT CHANGE ─────────────────────────────────────────────────
 *
 * The authority. This still requires a dispatcherActionId from an unconsumed
 * dispatcher approval; the endpoint enforces that non-negotiably
 * (docs/CONTROL_SERVICE_INTEGRATION.md §1), so a 409 DISPATCHER_ACTION_INVALID
 * is a normal, expected error to surface here, not a bug. So is a 422
 * APPROVAL_MISMATCH: the action type, bus and corridor submitted here must be
 * the ones the dispatcher actually approved. A prefilled field is still an
 * ordinary request field with no privileged path, so that cross-check refuses
 * an edited prefill exactly as it refuses a mistyped one.
 *
 * `prefill` is written by two callers, and neither of them relaxes anything:
 * the approval queue's approve action, which seeds the approval reference; and
 * the engine panel, which seeds the whole proposal.
 */
export interface CommandPrefill {
  dispatcherActionId?: string;
  actionType?: string;
  vehicleId?: string;
  routeDirectionId?: string;
  summary?: string;
}

function isActionType(value: string | undefined): value is ActionType {
  return value !== undefined && (ACTION_TYPES as readonly string[]).includes(value);
}

export function ControlRoomCommandForm({
  prefill,
  prefillDispatcherActionId,
  onIssued,
  corridors = [],
  defaultRouteDirectionId,
}: {
  prefill?: CommandPrefill;
  /** Legacy single-field form of `prefill`, kept so existing callers and tests are unaffected. */
  prefillDispatcherActionId?: string;
  /** Fired after an instruction is accepted, so the console can refresh the queue that just lost an approval. */
  onIssued?: () => void;
  /**
   * The corridor list, so the corridor field can be a picker rather than a
   * uuid box. Empty is a supported state — the field falls back to a plain
   * text input and the form still works — because a console that cannot reach
   * the control service must still be able to send an instruction an operator
   * has the reference for.
   */
  corridors?: readonly RouteDirectionMeta[];
  /** The corridor the console is already watching. Saves the commonest selection. */
  defaultRouteDirectionId?: string | null;
}) {
  const seed: CommandPrefill = prefill ?? { dispatcherActionId: prefillDispatcherActionId };
  const [dispatcherActionId, setDispatcherActionId] = useState(seed.dispatcherActionId ?? '');
  const [actionType, setActionType] = useState<ActionType>(
    isActionType(seed.actionType) ? seed.actionType : 'self_equalizing_hold',
  );
  const [vehicleId, setVehicleId] = useState(seed.vehicleId ?? '');
  const [routeDirectionId, setRouteDirectionId] = useState(
    seed.routeDirectionId ?? defaultRouteDirectionId ?? '',
  );
  const [ttlSeconds, setTtlSeconds] = useState(String(DEFAULT_TTL_SECONDS));
  const [summary, setSummary] = useState(seed.summary ?? '');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const errorId = useId();

  useEffect(() => {
    if (prefillDispatcherActionId) setDispatcherActionId(prefillDispatcherActionId);
  }, [prefillDispatcherActionId]);

  // Each field is written only when the prefill actually names it, so seeding
  // an approval reference from the queue never wipes an instruction the
  // operator has already chosen, and seeding an engine proposal never clears a
  // reference they pasted a moment earlier.
  useEffect(() => {
    if (!prefill) return;
    if (prefill.dispatcherActionId !== undefined) setDispatcherActionId(prefill.dispatcherActionId);
    if (isActionType(prefill.actionType)) setActionType(prefill.actionType);
    if (prefill.vehicleId !== undefined) setVehicleId(prefill.vehicleId);
    if (prefill.routeDirectionId !== undefined) setRouteDirectionId(prefill.routeDirectionId);
    if (prefill.summary !== undefined) setSummary(prefill.summary);
  }, [prefill]);

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
        setError(
          (data && 'error' in data && data.error.message) ||
            'The instruction was not sent. Try again.',
        );
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
      setSummary('');
      setTtlSeconds(String(DEFAULT_TTL_SECONDS));
      // The approval this consumed has left the queue; tell the console so
      // every panel reflects that on the same beat rather than showing a
      // spent approval as still pending for up to another poll interval.
      onIssued?.();
    } catch {
      setError('The instruction was not sent — the console could not be reached. Try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form
      id="control-room-command-form"
      onSubmit={handleSubmit}
      className="space-y-4 rounded-md border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <OpsField
          label="Which approval allows this"
          htmlFor="dispatcherActionId"
          required
          hint='Use "Approve" on a request above to fill this in, or paste the reference a dispatcher gave you.'
          className="sm:col-span-2"
        >
          <OpsInput
            id="dispatcherActionId"
            required
            value={dispatcherActionId}
            onChange={(e) => setDispatcherActionId(e.target.value)}
            placeholder="Approval reference"
            aria-describedby={error ? errorId : 'dispatcherActionId-hint'}
          />
        </OpsField>

        <OpsField label="Instruction" htmlFor="actionType" required>
          <OpsSelect
            id="actionType"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ActionType)}
          >
            {/* Named, not `type.replace('_',' ')`. The old form printed
                `terminal dispatch hold` and `self equalizing hold` — the raw
                enum with one underscore swapped — as the choices an operator
                picked between. */}
            {ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACTION_LABEL[type]}
              </option>
            ))}
          </OpsSelect>
        </OpsField>

        <OpsField label="Bus" htmlFor="vehicleId" required hint="The registration plate.">
          <OpsInput
            id="vehicleId"
            required
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="e.g. UP25FT4823"
          />
        </OpsField>

        {/* A picker, not a uuid box. This field is checked against both the
            stopped-instruction record and the corridor's own permission
            before anything reaches a driver, so getting it wrong is a refused
            instruction — and it was previously typed by hand. */}
        {corridors.length > 0 ? (
          <div className="min-w-0">
            <CorridorPicker
              corridors={corridors}
              value={routeDirectionId === '' ? null : routeDirectionId}
              onChange={setRouteDirectionId}
              label="Corridor"
            />
            <p className="mt-1 text-[11px] leading-snug text-subtle">
              Must be the corridor the approval was given for.
            </p>
          </div>
        ) : (
          <OpsField
            label="Corridor"
            htmlFor="routeDirectionId"
            required
            hint="The corridor list could not be read, so this has to be the reference rather than a name."
          >
            <OpsInput
              id="routeDirectionId"
              required
              value={routeDirectionId}
              onChange={(e) => setRouteDirectionId(e.target.value)}
              placeholder="Corridor reference"
            />
          </OpsField>
        )}

        <OpsField
          label="How long the driver has to answer"
          htmlFor="ttlSeconds"
          required
          hint="In seconds. After this the instruction expires on its own."
        >
          <OpsInput
            id="ttlSeconds"
            type="number"
            required
            min={15}
            max={900}
            value={ttlSeconds}
            onChange={(e) => setTtlSeconds(e.target.value)}
          />
        </OpsField>
      </div>

      <OpsField
        label="Why you are sending this"
        htmlFor="summary"
        required
        hint="This is the permanent record of the reason. It is what anyone reviewing this instruction later will read."
      >
        <OpsTextarea
          id="summary"
          required
          minLength={1}
          maxLength={2000}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
        />
      </OpsField>

      {error && (
        <OpsAlert tone="error" id={errorId}>
          {error}
        </OpsAlert>
      )}

      {success && (
        <OpsAlert tone="success" title={deliveryHeadline(success.status)}>
          <p>
            Reference <OpsIdentifier>{success.commandId}</OpsIdentifier>, expiring at{' '}
            {formatClock(success.expiresAt)}. Record reference{' '}
            <OpsIdentifier>{success.auditEventId}</OpsIdentifier>.
          </p>
        </OpsAlert>
      )}

      <OpsButton
        type="submit"
        variant="primary"
        className="px-5 py-2"
        disabled={
          submitting ||
          summary.trim().length === 0 ||
          dispatcherActionId.trim().length === 0 ||
          vehicleId.trim().length === 0 ||
          routeDirectionId.trim().length === 0
        }
      >
        {submitting ? 'Sending…' : 'Send instruction'}
      </OpsButton>

      {corridors.length > 0 && routeDirectionId !== '' && (
        <p className="text-[11px] leading-snug text-subtle">
          This goes to the driver of {vehicleId.trim() === '' ? 'the bus above' : vehicleId} on{' '}
          {corridorLabelFor(routeDirectionId, corridors)}.
        </p>
      )}
    </form>
  );
}

/**
 * What actually happened to the instruction, in the operator's terms.
 *
 * `authorized` is the only status the delivery sweep retries on its own
 * (control-service/src/db/commands.ts#listCommandsAwaitingDelivery), so it is
 * the only one that gets the "it will keep trying" promise. Every other
 * non-delivered status can only come back from reconciling an earlier attempt
 * that already moved past delivery, which no sweep touches — promising a retry
 * there would be a promise nothing keeps.
 */
function deliveryHeadline(status: string | undefined): string {
  if (status === 'delivered') return "Sent, and it reached the driver's screen.";
  if (status === 'authorized') {
    return "Sent. It has not reached the driver's screen yet — the system will keep trying.";
  }
  // A response without a status is not an error and must not blank the
  // confirmation: the instruction WAS accepted, and the operator needs the
  // reference below whatever else is missing. Claiming a state nobody
  // reported would be the worse failure of the two.
  if (status === undefined) return 'Sent.';
  return `Sent. Current state: ${commandStatusLabel(status).toLowerCase()}.`;
}

/** A wall-clock time an operator can act on. A raw ISO timestamp is not one. */
function formatClock(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toLocaleTimeString();
}

function corridorLabelFor(
  routeDirectionId: string,
  corridors: readonly RouteDirectionMeta[],
): string {
  const meta = corridors.find((c) => c.routeDirectionId === routeDirectionId);
  return meta ? `corridor ${corridorName(meta)}` : 'the corridor above';
}
