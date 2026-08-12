import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo, type DispatcherActionRecord } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';
import { commandActionTypeSchema, type Command } from '@/models/control';
import { createControlServiceCommand, fetchCommandByDispatcherAction } from '@/lib/controlService/createCommand';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';
import { ControlServiceResponseShapeError } from '@/lib/controlService/commands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `routeDirectionId` is REQUIRED on every request, and that is an intentional
 * behaviour change in the safe direction. Two reasons:
 *
 *  1. Kill switches. The old body took a {targetType, targetId} pair and only
 *     consulted the route-scoped kill switch when targetType happened to be
 *     'route_direction' — so a VEHICLE-targeted command on a killed route
 *     sailed straight through the switch that was supposed to stop it.
 *  2. The rollout gate. control-service resolves the route-direction it gates
 *     on from the approval row; a null there used to mean "nothing to gate,
 *     allow", which would have disabled the rollout gate for every bridged
 *     command. Both sides now refuse null.
 *
 * `actionType` uses the 9-value command vocabulary, which deliberately
 * excludes 'override' — see POST /api/ops/control-room/overrides.
 */
const bodySchema = z.object({
  dispatcherActionId: z.string().uuid(),
  actionType: commandActionTypeSchema,
  vehicleId: z.string().min(1).max(64),
  routeDirectionId: z.string().uuid(),
  tripId: z.string().min(1).max(200).nullable().optional(),
  targetStopId: z.string().min(1).max(200).nullable().optional(),
  incidentId: z.string().uuid().nullable().optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  ttlSeconds: z.number().int().min(15).max(900),
  policyVersion: z.string().max(200).nullable().optional(),
  /** The human audit text. Not sent to control-service — it is this app's own record of *why*. */
  summary: z.string().trim().min(1).max(2000),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

const uuidSchema = z.string().uuid();

/**
 * control-service's `dispatcher_actions.incident_id` is a `uuid` with a
 * foreign key; this app's `ops_dispatcher_actions.incident_id` is free text
 * (the two datastores are isolated, so it cannot be a real reference here).
 * Anything that isn't a uuid therefore cannot be mirrored and is dropped
 * rather than sent to be rejected.
 */
function asUuidOrNull(value: string | null | undefined): string | null {
  return value && uuidSchema.safeParse(value).success ? value : null;
}

/** Maps a control-service failure to this app's response, preserving the distinctions an operator has to act on differently. */
function mapControlServiceError(error: unknown): NextResponse | null {
  if (error instanceof ControlServiceConfigError) {
    return errorResponse('NOT_CONFIGURED', 'Control service is not configured.', 503);
  }
  if (error instanceof ControlServiceUnavailableError) {
    // Retryable, and the claim on THIS app's side is provably released
    // (releaseQuietly left consumed_at NULL) - but that does not prove
    // control-service never committed the command: a timeout here means
    // this app gave up waiting for a response, not that control-service
    // never sent one. Overclaiming "not consumed" is exactly the bug an
    // adversarial review caught live: control-service had already created
    // AND delivered the command, the driver already had it on screen, and
    // this message told the operator it was safe to re-issue. Point at how
    // to check instead of asserting an outcome this app cannot prove.
    return errorResponse(
      'CONTROL_SERVICE_UNAVAILABLE',
      'Control service is temporarily unavailable. This approval can be re-issued, but check the vehicle console or dispatcher queue first - the command may have already reached the driver.',
      503,
    );
  }
  if (error instanceof ControlServiceResponseShapeError) {
    return errorResponse('CONTROL_SERVICE_ERROR', error.message, 502);
  }
  if (error instanceof ControlServiceRequestError) {
    switch (error.code) {
      case 'vehicle_has_active_command':
        return errorResponse('VEHICLE_HAS_ACTIVE_COMMAND', error.message, 409);
      case 'rollout_stage_forbids_commands':
        return errorResponse('ROLLOUT_STAGE_FORBIDS_COMMANDS', error.message, 403);
      case 'route_direction_required':
        return errorResponse('ROUTE_DIRECTION_REQUIRED', error.message, 422);
      case 'dispatcher_action_invalid':
        return errorResponse('DISPATCHER_ACTION_INVALID', error.message, 422);
      case 'unknown_route_direction':
      case 'unknown_vehicle':
      case 'unknown_reference':
        return errorResponse('UNKNOWN_REFERENCE', error.message, 422);
      default:
        return errorResponse('CONTROL_SERVICE_ERROR', error.message, error.status ?? 502);
    }
  }
  return null;
}

/**
 * Issues a real operational command: control-room user -> control-service
 * `commands` row, against a human dispatcher approval, fully audited.
 *
 * THE COMMAND PATH USED TO BE SEVERED. This app recorded approvals in its own
 * `ops_dispatcher_actions`; control-service refuses to insert a command
 * without a matching, unconsumed row in ITS OWN `dispatcher_actions` table
 * (dispatcher_action_id NOT NULL UNIQUE + a BEFORE INSERT trigger), and no
 * control-service code path ever inserted one. So no human-authorized command
 * could be issued end to end, and this endpoint only wrote an audit row.
 *
 * The bridge mirrors this app's own ops_dispatcher_actions.id into control's
 * dispatcher_actions, inline on POST /v1/commands, in the same transaction as
 * the command (src/lib/controlService/createCommand.ts). The existing trigger
 * still fires unchanged; nothing was weakened.
 *
 * Ordering matters, and is:
 *   1  origin -> role -> content-type -> JSON -> 'override' rejection -> schema
 *   2  kill switch for the named route-direction (now checked on EVERY
 *      request, not only route-targeted ones — see bodySchema)
 *   3  approval lookup + APPROVAL_MISMATCH cross-check. Only this app can make
 *      that check: control-service sees only what this app sends it.
 *   4  claim (reversible) — NOT consume. The old flow consumed the approval
 *      before dispatch with no un-consume path, so any downstream failure
 *      permanently burned a human approval.
 *   5  dispatch
 *   6  on success: mark dispatched (stamping consumed_at) then audit
 *      on 409 already-used: reconcile against the command that already exists
 *      on anything else: release the claim, leaving the approval retryable
 *
 * The audit write moved AFTER the control call so its resourceId can be the
 * real control-service commandId — it used to be the dispatcherActionId,
 * which left command-level audit unjoinable to the command it describes. It
 * still fails closed (an audit failure 500s), and reconciliation survives
 * that 500 because control_service_command_id is already persisted by then.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.', 415);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Malformed request body.', 400);
  }

  // Checked on the RAW body, before schema validation, purely so 'override'
  // gets its own explanatory rejection instead of a generic INVALID_BODY —
  // bodySchema's actionType enum excludes 'override' by construction, so a
  // post-parse check could never fire. An override is a human acting outside
  // the automated control set; the audit record IS the deliverable, and it is
  // recorded at POST /api/ops/control-room/overrides. It is deliberately not
  // dispatchable: control-service's commands.action_type CHECK does not
  // include it, and widening that CHECK would let an unmodelled action reach
  // applyHardSafetyFilter, which switches on actionType and has no
  // 'override' case.
  if (typeof raw === 'object' && raw !== null && (raw as { actionType?: unknown }).actionType === 'override') {
    return errorResponse(
      'OVERRIDE_NOT_DISPATCHABLE',
      'An override is recorded, never dispatched. Use POST /api/ops/control-room/overrides.',
      400,
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    // routeDirectionId gets its own code rather than being folded into the
    // generic INVALID_BODY, because it is the one field here carrying a
    // safety invariant: control-service's rollout gate resolves the
    // route-direction it gates on from it, and a null used to mean "nothing
    // to gate against — allow". A refusal that says ROUTE_DIRECTION_REQUIRED
    // is self-identifying in a log; one that says INVALID_BODY is not, and
    // this is precisely the refusal an operator must be able to find. Status
    // 422 matches what control-service returns for the same condition.
    if (parsed.error.issues.some((issue) => issue.path[0] === 'routeDirectionId')) {
      return errorResponse(
        'ROUTE_DIRECTION_REQUIRED',
        'routeDirectionId is required and must be a uuid: it is what the route-scoped kill switch and the control-service rollout gate are both checked against.',
        422,
      );
    }
    return errorResponse(
      'INVALID_BODY',
      'dispatcherActionId, actionType, vehicleId, routeDirectionId, ttlSeconds and summary are required.',
      400,
    );
  }
  const body = parsed.data;

  try {
    const repo = getOpsRepo();

    // Kill switch (this ticket's AC: "immediately halt new automatic commands
    // ... both logged"). Network-wide always applies; the route-scoped switch
    // now applies to every command, because every command names its
    // route-direction.
    const [blocking] = await repo.getActiveKillSwitches(body.routeDirectionId);
    if (blocking) {
      return errorResponse(
        'KILL_SWITCH_ENGAGED',
        blocking.scope === 'network'
          ? 'A network-wide kill switch is engaged; no new commands can be authorized.'
          : `A kill switch is engaged for route-direction ${blocking.routeDirectionId}; no new commands can be authorized for it.`,
        409,
      );
    }

    const approval = await repo.findDispatcherAction(body.dispatcherActionId);
    if (!approval) {
      return errorResponse(
        'DISPATCHER_ACTION_INVALID',
        'dispatcherActionId does not reference a valid, unconsumed approval.',
        409,
      );
    }

    // The command must be the one that was actually approved. Exact equality,
    // including against a null on the approval: an approval that never named
    // a vehicle or a route-direction did not authorize a command for one, and
    // control-service could never catch that on its own — it only ever sees
    // the payload this app builds.
    if (
      approval.actionType !== body.actionType ||
      approval.vehicleId !== body.vehicleId ||
      approval.routeDirectionId !== body.routeDirectionId
    ) {
      return errorResponse(
        'APPROVAL_MISMATCH',
        `Approval ${approval.id} authorizes ${approval.actionType} for vehicle ${approval.vehicleId ?? '(none)'} on route-direction ${approval.routeDirectionId ?? '(none)'}; this command does not match it.`,
        422,
      );
    }

    const claimed = await repo.claimDispatcherAction(body.dispatcherActionId, guard.claims.sub);
    if (!claimed) {
      return errorResponse(
        'DISPATCHER_ACTION_INVALID',
        'dispatcherActionId does not reference a valid, unconsumed approval, or another dispatch is already in flight for it.',
        409,
      );
    }

    let command: Command;
    try {
      command = await createControlServiceCommand({
        vehicleId: body.vehicleId,
        tripId: body.tripId ?? null,
        actionType: body.actionType,
        targetStopId: body.targetStopId ?? null,
        parameters: body.parameters,
        dispatcherActionId: body.dispatcherActionId,
        ttlSeconds: body.ttlSeconds,
        policyVersion: body.policyVersion ?? null,
        dispatcherAction: {
          id: claimed.id,
          dispatcherId: claimed.dispatcherUserId,
          actionType: body.actionType,
          routeDirectionId: body.routeDirectionId,
          vehicleId: body.vehicleId,
          incidentId: body.incidentId ?? asUuidOrNull(claimed.incidentId),
          reason: claimed.reason,
          authorizedAt: claimed.createdAt,
        },
      });
    } catch (error) {
      const reconciled = await reconcileAlreadyUsed(error, body.dispatcherActionId);
      if (!reconciled) {
        await releaseQuietly(repo, body.dispatcherActionId, error);
        const mapped = mapControlServiceError(error);
        if (mapped) return mapped;
        throw error;
      }
      command = reconciled;
    }

    // Persisted BEFORE the audit write on purpose: if the audit write then
    // fails and this request 500s, control_service_command_id is already
    // recorded, so the command stays attributable to this approval and the
    // situation is reconcilable rather than orphaned.
    await repo.markDispatcherActionDispatched(body.dispatcherActionId, command.id);

    // Fail closed: an audited command must have exactly one attribution row.
    const { id: auditEventId } = await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'control_room.command.create',
      resourceType: 'command',
      resourceId: command.id,
      metadata: {
        dispatcherActionId: body.dispatcherActionId,
        actionType: body.actionType,
        vehicleId: body.vehicleId,
        routeDirectionId: body.routeDirectionId,
        ttlSeconds: body.ttlSeconds,
        summary: body.summary,
      },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      {
        ok: true,
        commandId: command.id,
        expiresAt: command.expiresAt,
        status: command.status,
        deliveredAt: command.deliveredAt,
        auditEventId,
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}

/**
 * Codes that can mean "an earlier attempt already committed a command against
 * this approval". Neither PROVES it — the lookup below is what decides.
 *
 * Both are needed, and keying on `dispatcher_action_already_used` alone was a
 * real bug: it made this whole reconciliation path dead code.
 *
 * `commands.dispatcher_action_id` is UNIQUE, so the obvious retry signal is a
 * 23505 mapped to `dispatcher_action_already_used` (409). But the insert never
 * gets that far. `consume_dispatcher_action` is a BEFORE INSERT trigger, so on
 * a retry it sees `consumed_at` already stamped and raises P0001 first, which
 * maps to `dispatcher_action_invalid` (422). The 23505 is therefore
 * unreachable whenever the first attempt actually succeeded — i.e. in exactly
 * the case reconciliation exists for. Verified end-to-end: a retry after a
 * simulated crash-before-record returned `422 dispatcher_action_invalid`,
 * reconciliation did not fire, and the approval was stranded permanently even
 * though its command was sitting in control-service.
 */
const RECONCILABLE_ERROR_CODES = new Set(['dispatcher_action_already_used', 'dispatcher_action_invalid']);

/**
 * Turns "you already succeeded" into the command that succeeded, or null for
 * every other failure.
 *
 * Deliberately driven by the LOOKUP, not by the error code: the code only
 * decides whether asking is worthwhile, and `fetchCommandByDispatcherAction`
 * is the authority. A 422 with no command behind it is a genuinely invalid
 * approval and still surfaces as an error; a 422 with a command behind it is
 * proof of an earlier commit this app never recorded. That ordering is what
 * makes the flow exactly-once rather than at-most-once, and it does not
 * depend on control-service classifying its own errors perfectly.
 *
 * If the lookup itself fails (control-service went away between the two
 * calls) this returns null and the caller releases the claim, so the operator
 * gets a retryable error rather than a silent inconsistency.
 */
async function reconcileAlreadyUsed(error: unknown, dispatcherActionId: string): Promise<Command | null> {
  if (!(error instanceof ControlServiceRequestError) || !RECONCILABLE_ERROR_CODES.has(error.code ?? '')) {
    return null;
  }
  try {
    return await fetchCommandByDispatcherAction(dispatcherActionId);
  } catch {
    return null;
  }
}

/**
 * Releasing is best-effort by design. If the release itself fails, the row is
 * left in 'claimed' and claimDispatcherAction's 2-minute stale-claim reclaim
 * picks it up — so swallowing this error costs a short delay, whereas letting
 * it propagate would replace an accurate, actionable 503/409/403 with an
 * unrelated 500.
 */
async function releaseQuietly(
  repo: { releaseDispatcherActionClaim(id: string, error: string): Promise<DispatcherActionRecord | null> },
  dispatcherActionId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await repo.releaseDispatcherActionClaim(dispatcherActionId, message).catch(() => undefined);
}
