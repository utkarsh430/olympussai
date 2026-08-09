// @vitest-environment node
//
// The two-phase dispatch claim on ops_dispatcher_actions
// (db/migrations/20260808110000__ops_dispatcher_action_dispatch.sql):
// claimDispatcherAction -> markDispatcherActionDispatched, or
// claimDispatcherAction -> releaseDispatcherActionClaim.
//
// What this replaces: the command path used to call consumeDispatcherAction
// BEFORE anything could be dispatched, and there is no un-consume path
// anywhere in the codebase — so any downstream failure (control service down,
// circuit breaker open, a timeout) permanently burned a human approval and
// the operator had to go get another one. Claiming is reversible; consuming
// is not.
//
// Scope, honestly stated: with `pg` mocked these prove the statements this
// repo issues — that a claim is ONE atomic UPDATE rather than a
// select-then-update race, which rows it will and won't match, and that a
// release cannot walk back a dispatch. Whether Postgres then applies that
// predicate correctly is Postgres's job, verified against the live ops
// database rather than here (same stance as
// control-service/test/commandLifecycleDb.test.ts takes toward its triggers).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db/pool', () => ({
  getOpsPool: () => ({ query }),
  OpsDbConfigError: class OpsDbConfigError extends Error {},
}));

const { getOpsRepo, decisionStateOf } = await import('@/lib/auth/rbac/repo');

const ACTION_ID = '33333333-3333-3333-3333-333333333333';

/** A raw ops_dispatcher_actions row, snake_case as Postgres returns it. */
function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    dispatcher_user_id: 'ops-user-2',
    action_type: 'self_equalizing_hold',
    reason: 'Bunching on the northbound leg',
    route_direction_id: '44444444-4444-4444-4444-444444444444',
    vehicle_id: 'UP25FT4823',
    incident_id: null,
    consumed_at: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    created_at: '2026-08-08T09:00:00.000Z',
    dispatch_state: 'claimed',
    claimed_at: '2026-08-08T09:00:01.000Z',
    claimed_by: 'ops-user-1',
    control_service_command_id: null,
    control_service_error: null,
    dispatch_attempts: 1,
    ...overrides,
  };
}

/** The SQL of the single statement issued by the call under test, whitespace-normalised and lowercased. */
function issuedSql(): string {
  expect(query).toHaveBeenCalledTimes(1);
  return String(query.mock.calls[0]![0]).replace(/\s+/g, ' ').toLowerCase();
}

beforeEach(() => {
  query.mockReset();
});

describe('claimDispatcherAction', () => {
  it('takes the approval in ONE atomic UPDATE, so two concurrent dispatches cannot both claim it', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow()] });

    const claimed = await getOpsRepo().claimDispatcherAction(ACTION_ID, 'ops-user-1');

    const sql = issuedSql();
    // A select-then-update would leave a window in which both requests see a
    // claimable row; the loser of this UPDATE simply matches zero rows.
    expect(sql.startsWith('update ops_dispatcher_actions')).toBe(true);
    expect(sql).toContain("set dispatch_state = 'claimed'");
    expect(sql).toContain('claimed_by = $2');
    expect(sql).toContain('dispatch_attempts = dispatch_attempts + 1');
    expect(query.mock.calls[0]![1]).toEqual([ACTION_ID, 'ops-user-1']);

    expect(claimed).toMatchObject({ id: ACTION_ID, dispatchState: 'claimed', claimedBy: 'ops-user-1', dispatchAttempts: 1 });
  });

  it('leaves consumed_at alone, which is what makes a failed attempt retryable', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow()] });

    const claimed = await getOpsRepo().claimDispatcherAction(ACTION_ID, 'ops-user-1');

    expect(issuedSql()).not.toContain('set consumed_at');
    expect(claimed!.consumedAt).toBeNull();
    // ...and therefore the approval queue still reads it as undecided.
    expect(decisionStateOf(claimed!)).toBe('pending');
  });

  it('refuses an approval that was already consumed or rejected', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow()] });
    await getOpsRepo().claimDispatcherAction(ACTION_ID, 'ops-user-1');

    const sql = issuedSql();
    expect(sql).toContain('consumed_at is null');
    expect(sql).toContain('rejected_at is null');
  });

  it('is claimable from pending and from failed, so a released attempt can be retried', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow()] });
    await getOpsRepo().claimDispatcherAction(ACTION_ID, 'ops-user-1');

    const sql = issuedSql();
    expect(sql).toContain("dispatch_state = 'pending'");
    expect(sql).toContain("dispatch_state = 'failed'");
  });

  it('reclaims a claim older than 2 minutes, so a process that dies mid-dispatch does not wedge the approval', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow({ dispatch_attempts: 2 })] });

    const reclaimed = await getOpsRepo().claimDispatcherAction(ACTION_ID, 'ops-user-9');

    // Reclaiming is only safe because a re-dispatch is idempotent: the
    // mirrored uuid means that if the original attempt actually reached the
    // control service, the retry gets a 409 dispatcher_action_already_used
    // and reconciles against the command that already exists.
    expect(issuedSql()).toContain("dispatch_state = 'claimed' and claimed_at < now() - interval '2 minutes'");
    // The attempt counter is what lets an operator spot an approval that
    // keeps failing rather than silently retrying forever.
    expect(reclaimed!.dispatchAttempts).toBe(2);
  });

  it('returns null when nothing was claimable — callers must treat that as a refusal', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getOpsRepo().claimDispatcherAction(ACTION_ID, 'ops-user-1')).resolves.toBeNull();
  });
});

describe('markDispatcherActionDispatched', () => {
  it('stamps consumed_at, so the existing approval queue keeps reading "approved" exactly as before', async () => {
    query.mockResolvedValueOnce({
      rows: [rawRow({ dispatch_state: 'dispatched', consumed_at: '2026-08-08T09:00:02.000Z', control_service_command_id: 'cmd-1' })],
    });

    const dispatched = await getOpsRepo().markDispatcherActionDispatched(ACTION_ID, 'cmd-1');

    const sql = issuedSql();
    expect(sql).toContain("set dispatch_state = 'dispatched'");
    expect(sql).toContain('control_service_command_id = $2');
    expect(sql).toContain('control_service_error = null');
    expect(query.mock.calls[0]![1]).toEqual([ACTION_ID, 'cmd-1']);

    expect(dispatched).toMatchObject({ dispatchState: 'dispatched', controlServiceCommandId: 'cmd-1' });
    // dispatch_state is layered on top of consumed_at, never a replacement:
    // ApprovalQueuePanel/decisionStateOf are untouched by this migration.
    expect(decisionStateOf(dispatched!)).toBe('approved');
  });

  it('does not rewrite an existing consumed_at, so a reconciled retry keeps the original approval timestamp', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow({ dispatch_state: 'dispatched', consumed_at: '2026-08-08T09:00:02.000Z' })] });

    await getOpsRepo().markDispatcherActionDispatched(ACTION_ID, 'cmd-1');

    expect(issuedSql()).toContain('consumed_at = coalesce(consumed_at, now())');
  });

  it('accepts a null command id, which is how a recorded override is marked', async () => {
    // An override never reaches the control service, so there is no command
    // id to record — the null IS the durable marker of that.
    query.mockResolvedValueOnce({ rows: [rawRow({ dispatch_state: 'dispatched', consumed_at: '2026-08-08T09:00:02.000Z' })] });

    const dispatched = await getOpsRepo().markDispatcherActionDispatched(ACTION_ID, null);

    expect(query.mock.calls[0]![1]).toEqual([ACTION_ID, null]);
    expect(dispatched!.controlServiceCommandId).toBeNull();
  });
});

describe('releaseDispatcherActionClaim', () => {
  it('records the failure and leaves the approval live rather than burning it', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow({ dispatch_state: 'failed', control_service_error: 'circuit open', claimed_by: null })] });

    const released = await getOpsRepo().releaseDispatcherActionClaim(ACTION_ID, 'circuit open');

    const sql = issuedSql();
    expect(sql).toContain("set dispatch_state = 'failed'");
    expect(sql).toContain('control_service_error = $2');
    // The critical omission: consumed_at is never touched, so the human
    // approval survives an infrastructure failure and can be re-issued.
    expect(sql).not.toContain('consumed_at');
    expect(released).toMatchObject({ dispatchState: 'failed', controlServiceError: 'circuit open', consumedAt: null });
    expect(decisionStateOf(released!)).toBe('pending');
  });

  it('only ever acts on a row still in "claimed", so a late release cannot undo a successful dispatch', async () => {
    // The dangerous case this guards: a request that timed out locally after
    // its dispatch had in fact succeeded. Without the guard it would walk a
    // 'dispatched' row back to 'failed' and invite a duplicate command.
    query.mockResolvedValueOnce({ rows: [] });

    const released = await getOpsRepo().releaseDispatcherActionClaim(ACTION_ID, 'timed out');

    expect(issuedSql()).toContain("dispatch_state = 'claimed'");
    expect(released).toBeNull();
  });

  it('truncates a runaway error message rather than failing the write', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow({ dispatch_state: 'failed' })] });

    await getOpsRepo().releaseDispatcherActionClaim(ACTION_ID, 'x'.repeat(5000));

    expect(String(query.mock.calls[0]![1]![1])).toHaveLength(2000);
  });
});

describe('dispatcher-action row mapping', () => {
  it('defaults the dispatch columns for a database where this migration has not been applied yet', async () => {
    const preMigration: Record<string, unknown> = rawRow();
    for (const column of [
      'dispatch_state',
      'claimed_at',
      'claimed_by',
      'control_service_command_id',
      'control_service_error',
      'dispatch_attempts',
    ]) {
      delete preMigration[column];
    }
    query.mockResolvedValueOnce({ rows: [preMigration] });

    const record = await getOpsRepo().findDispatcherAction(ACTION_ID);

    // 'pending'/0/null is exactly what such a row means operationally, so the
    // approval queue keeps rendering during the window between deploy and
    // migration instead of throwing.
    expect(record).toMatchObject({
      dispatchState: 'pending',
      claimedAt: null,
      claimedBy: null,
      controlServiceCommandId: null,
      controlServiceError: null,
      dispatchAttempts: 0,
    });
  });
});

describe('consumeDispatcherAction (unchanged)', () => {
  it('still consumes in one statement — retained for flows where "approved" and "done" are the same instant', async () => {
    query.mockResolvedValueOnce({ rows: [rawRow({ consumed_at: '2026-08-08T09:00:02.000Z', dispatch_state: 'pending' })] });

    const consumed = await getOpsRepo().consumeDispatcherAction(ACTION_ID);

    const sql = issuedSql();
    expect(sql).toContain('set consumed_at = now()');
    expect(sql).toContain('consumed_at is null');
    expect(sql).toContain('rejected_at is null');
    // Deliberately still ignores dispatch_state: this migration layers on top
    // of the old contract, it does not change it.
    expect(sql).not.toContain('dispatch_state');
    expect(decisionStateOf(consumed!)).toBe('approved');
  });
});
