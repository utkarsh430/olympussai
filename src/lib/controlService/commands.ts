import 'server-only';

/**
 * Command lifecycle calls this app makes to the control service, for the
 * driver PWA's single-instruction command interface
 * (docs/CONTROL_SERVICE_INTEGRATION.md §1 "Web -> control service" — server
 * only, never called from the browser). Layered on top of
 * fetchControlService (src/lib/controlService/client.ts) so both call sites
 * share its timeout/circuit-breaker behaviour; kept in its own module
 * because that file's own scope note restricts it to the read-only
 * observability calls its ticket covered.
 *
 * Every response is Zod-validated here before a route handler trusts its
 * shape — fetchControlService only guarantees valid JSON came back over a
 * successful HTTP response, not that it matches this app's expected shape.
 */
import { fetchControlService } from './client';
import {
  activeCommandResponseSchema,
  acknowledgeCommandResponseSchema,
  type Command,
  type CommandAckOutcome,
} from '@/models/control';

export class ControlServiceResponseShapeError extends Error {
  constructor(path: string) {
    super(`control service response for ${path} did not match the expected shape`);
    this.name = 'ControlServiceResponseShapeError';
  }
}

/**
 * The one command (if any) currently delivered to `vehicleId` and awaiting
 * an ack — the driver PWA's "at most one active command" read (AC1). Never
 * throws for "no active command"; that is a normal `null`, not an error.
 */
export async function fetchActiveCommandForVehicle(vehicleId: string): Promise<Command | null> {
  const payload = await fetchControlService('/v1/commands/active', {
    method: 'GET',
    query: { vehicleId },
  });
  const parsed = activeCommandResponseSchema.safeParse(payload);
  if (!parsed.success) throw new ControlServiceResponseShapeError('/v1/commands/active');
  return parsed.data.command;
}

/**
 * Records the driver's ack (AC2: "ACK/UNABLE/UNSAFE ... sent to command
 * service with no penalty applied" — no penalty is enforced service-side,
 * see control-service/src/db/commands.ts#acknowledgeCommand; this call
 * never has a penalty/scoring parameter to set).
 */
export async function acknowledgeCommand(
  commandId: string,
  input: { outcome: CommandAckOutcome; reason?: string | null; actorId: string },
): Promise<Command> {
  const payload = await fetchControlService(`/v1/commands/${encodeURIComponent(commandId)}/ack`, {
    method: 'POST',
    body: { outcome: input.outcome, reason: input.reason ?? null, actorId: input.actorId },
  });
  const parsed = acknowledgeCommandResponseSchema.safeParse(payload);
  if (!parsed.success) throw new ControlServiceResponseShapeError(`/v1/commands/${commandId}/ack`);
  return parsed.data.command;
}
