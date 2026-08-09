// The approval bridge, at the wire-schema and transaction level.
//
// Context: this service refuses to insert into `commands` without a matching,
// unconsumed row in its own `dispatcher_actions` table
// (commands.dispatcher_action_id is NOT NULL UNIQUE and a BEFORE INSERT
// trigger, control_service_consume_dispatcher_action, consumes it). Nothing in
// this service ever created such a row, and it never reads the web app's
// datastore, so a real human approval could not authorize a real command end
// to end. POST /v1/commands now accepts an optional inline `dispatcherAction`
// carrying the WEB's own ops_dispatcher_actions.id, written into
// dispatcher_actions in the same transaction as the command.
//
// Two properties are what make that safe, and both are asserted here:
//   1. Mirroring the caller's uuid (not generating one) makes dispatch
//      exactly-once — a retry collides with the UNIQUE constraint instead of
//      creating a second live command against the same bus.
//   2. The inline approval must describe the command it authorizes. Without
//      the cross-field checks, a caller could hold an approval for
//      `speed_guidance`, issue `stop_skip` against it, and leave an audit
//      trail pointing at an approval nobody ever gave.
//
// Route-level coverage of the same feature is in test/approvalBridgeRoutes.test.ts.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createCommand } from '../src/db/commands.js';
import { createCommandRequestSchema, inlineDispatcherActionSchema } from '../src/models/schemas.js';
import type { CreateCommandRequest } from '../src/models/schemas.js';

const DISPATCHER_ACTION_ID = '33333333-3333-3333-3333-333333333333';
const ROUTE_DIRECTION_ID = '44444444-4444-4444-4444-444444444444';

const inlineAction = {
  id: DISPATCHER_ACTION_ID,
  dispatcherId: 'ops-user-1',
  actionType: 'self_equalizing_hold' as const,
  routeDirectionId: ROUTE_DIRECTION_ID,
  vehicleId: 'veh-1',
  incidentId: null,
  reason: 'Bunching on the northbound leg',
  authorizedAt: '2026-08-08T09:00:00.000Z',
};

const baseInput: CreateCommandRequest = {
  vehicleId: 'veh-1',
  tripId: null,
  recommendationId: null,
  actionType: 'self_equalizing_hold',
  targetStopId: null,
  parameters: {},
  dispatcherActionId: DISPATCHER_ACTION_ID,
  ttlSeconds: 120,
  policyVersion: null,
  dispatcherAction: inlineAction,
};

function commandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    recommendation_id: null,
    vehicle_id: 'veh-1',
    trip_id: null,
    action_type: 'self_equalizing_hold',
    target_stop_id: null,
    parameters: {},
    dispatcher_action_id: DISPATCHER_ACTION_ID,
    ttl_seconds: 120,
    valid_from: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    policy_version: null,
    status: 'authorized',
    version: 1,
    supersedes_command_id: null,
    delivered_at: null,
    acknowledged_at: null,
    acknowledgement_reason: null,
    ack_outcome: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * A fake Postgres that actually enforces the two constraints this design
 * leans on, rather than replaying a canned error:
 *
 *   - `dispatcher_actions` has a primary key, so the mirror's
 *     `on conflict (id) do nothing` is exercised for real on a retry.
 *   - `commands.dispatcher_action_id` is UNIQUE, so a second command against
 *     an already-used approval raises 23505 exactly as the real column does.
 *
 * That is the only way to prove exactly-once dispatch in a mocked-pool test:
 * the property being asserted IS the constraint's behaviour.
 */
function fakeDatabase() {
  const dispatcherActions = new Map<string, unknown[]>();
  const commandsByDispatcherAction = new Map<string, string>();
  const sqlLog: string[] = [];
  let nextCommandId = 1;

  const query = vi.fn((sql: string, params?: unknown[]) => {
    sqlLog.push(sql.trim().replace(/\s+/g, ' '));
    const s = sql.trim().toLowerCase();

    if (s.startsWith('insert into dispatcher_actions')) {
      const id = String(params![0]);
      // `on conflict (id) do nothing`: first writer wins, and a retry must
      // NOT rewrite the terms of an approval that already exists.
      if (!dispatcherActions.has(id)) dispatcherActions.set(id, params!);
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('select route_direction_id from dispatcher_actions')) {
      const stored = dispatcherActions.get(String(params![0]));
      // Reads the mirrored row through the same client, inside the same
      // transaction — so the mirror insert has to have happened first.
      return Promise.resolve({ rows: stored ? [{ route_direction_id: stored[3] }] : [] });
    }
    if (s.startsWith('select stage from route_direction_rollout_stages')) {
      return Promise.resolve({ rows: [{ stage: 'limited_auto' }] });
    }
    if (s.startsWith('insert into commands')) {
      const dispatcherActionId = String(params![6]);
      if (commandsByDispatcherAction.has(dispatcherActionId)) {
        return Promise.reject(
          Object.assign(
            new Error('duplicate key value violates unique constraint "commands_dispatcher_action_id_key"'),
            { code: '23505' },
          ),
        );
      }
      const id = `cmd-${nextCommandId++}`;
      commandsByDispatcherAction.set(dispatcherActionId, id);
      return Promise.resolve({ rows: [commandRow({ id, dispatcher_action_id: dispatcherActionId })] });
    }
    // begin / commit / rollback / select set_config(...)
    return Promise.resolve({ rows: [] });
  });

  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { pool, query, sqlLog, dispatcherActions, commandsByDispatcherAction };
}

describe('createCommand — inline dispatcher-action mirror', () => {
  it('writes the caller\'s own approval into dispatcher_actions in the same transaction as the command', async () => {
    const db = fakeDatabase();

    const command = await createCommand(baseInput, db.pool);

    expect(command.dispatcherActionId).toBe(DISPATCHER_ACTION_ID);
    expect(db.dispatcherActions.get(DISPATCHER_ACTION_ID)).toEqual([
      DISPATCHER_ACTION_ID,
      'ops-user-1',
      'self_equalizing_hold',
      ROUTE_DIRECTION_ID,
      'veh-1',
      null,
      'Bunching on the northbound leg',
      '2026-08-08T09:00:00.000Z',
    ]);

    const indexOf = (fragment: string) => db.sqlLog.findIndex((sql) => sql.toLowerCase().includes(fragment));
    const begin = indexOf('begin');
    const mirror = indexOf('insert into dispatcher_actions');
    const gate = indexOf('select route_direction_id from dispatcher_actions');
    const insert = indexOf('insert into commands');
    const commit = indexOf('commit');

    // Ordering is the correctness property, not an implementation detail:
    // the gate SELECTs this row on the same client, so an insert placed after
    // it would find nothing and (now that the gate fails closed) 422 every
    // bridged command. And it must be inside the transaction so a failed
    // command insert takes the mirrored approval down with it.
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(mirror).toBeGreaterThan(begin);
    expect(gate).toBeGreaterThan(mirror);
    expect(insert).toBeGreaterThan(gate);
    expect(commit).toBeGreaterThan(insert);
  });

  it('uses `on conflict (id) do nothing`, never `do update` — a retry must not rewrite an approval\'s terms', async () => {
    const db = fakeDatabase();
    await createCommand(baseInput, db.pool);

    const mirrorSql = db.sqlLog.find((sql) => sql.toLowerCase().includes('insert into dispatcher_actions'))!;
    expect(mirrorSql.toLowerCase()).toContain('on conflict (id) do nothing');
    expect(mirrorSql.toLowerCase()).not.toContain('do update');
  });

  it('issues no dispatcher_actions insert at all when the caller sends no inline approval', async () => {
    const db = fakeDatabase();
    // Without the mirror there is no row for the gate to resolve, so this
    // now fails closed rather than reaching the insert.
    await expect(
      createCommand({ ...baseInput, dispatcherAction: undefined }, db.pool),
    ).rejects.toMatchObject({ code: 'dispatcher_action_invalid', status: 422 });

    expect(db.sqlLog.some((sql) => sql.toLowerCase().startsWith('insert into dispatcher_actions'))).toBe(false);
  });

  it('rolls back the mirrored approval when the command insert fails', async () => {
    const db = fakeDatabase();
    await createCommand(baseInput, db.pool);
    db.sqlLog.length = 0;

    // Same approval, second attempt: the UNIQUE constraint rejects it.
    await expect(createCommand(baseInput, db.pool)).rejects.toMatchObject({
      code: 'dispatcher_action_already_used',
    });
    expect(db.sqlLog).toContain('rollback');
    expect(db.sqlLog.includes('commit')).toBe(false);
  });
});

describe('createCommand — exactly-once dispatch on retry', () => {
  it('creates exactly one command when the same dispatcherActionId is sent twice', async () => {
    const db = fakeDatabase();

    const first = await createCommand(baseInput, db.pool);

    // The retry-after-timeout case, which is routine rather than
    // hypothetical: the web client has an 8s timeout and a circuit breaker,
    // so it can time out on a request this service already committed. Because
    // the mirrored id is the CALLER's, the retry collides with
    // commands.dispatcher_action_id's UNIQUE constraint instead of issuing a
    // second live command against the same bus. A control-generated id would
    // have produced two holds on one vehicle.
    await expect(createCommand(baseInput, db.pool)).rejects.toMatchObject({
      code: 'dispatcher_action_already_used',
      status: 409,
    });

    expect(db.commandsByDispatcherAction.size).toBe(1);
    expect(db.commandsByDispatcherAction.get(DISPATCHER_ACTION_ID)).toBe(first.id);
  });
});

describe('createCommandRequestSchema — inline approval cross-field checks', () => {
  it('rejects an inline approval whose id differs from dispatcherActionId', () => {
    const parsed = createCommandRequestSchema.safeParse({
      ...baseInput,
      dispatcherAction: { ...inlineAction, id: '55555555-5555-5555-5555-555555555555' },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path.join('.') === 'dispatcherAction.id')).toBe(true);
  });

  it('rejects an inline approval for a different action than the command being issued', () => {
    // The attack this closes: get a human to approve `speed_guidance`, then
    // issue `stop_skip` against that approval. Both fields are individually
    // valid; only the cross-check catches it.
    const parsed = createCommandRequestSchema.safeParse({
      ...baseInput,
      actionType: 'stop_skip',
      dispatcherAction: { ...inlineAction, actionType: 'speed_guidance' },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path.join('.') === 'dispatcherAction.actionType')).toBe(true);
  });

  it('accepts a consistent inline approval', () => {
    expect(createCommandRequestSchema.safeParse(baseInput).success).toBe(true);
  });

  it('still accepts a request with no inline approval (the cross-checks are conditional, not required)', () => {
    expect(createCommandRequestSchema.safeParse({ ...baseInput, dispatcherAction: undefined }).success).toBe(true);
  });
});

describe('inlineDispatcherActionSchema — routeDirectionId fails closed at the wire', () => {
  it.each([
    ['null', null],
    ['absent', undefined],
    ['an empty string', ''],
    ['a non-uuid', 'rd-1'],
  ])('rejects a routeDirectionId that is %s', (_label, value) => {
    // The rollout gate resolves the route-direction it gates on FROM this
    // row. Accepting null here would have meant every bridged command
    // reaching a gate with nothing to check — which used to be an ALLOW.
    const candidate: Record<string, unknown> = { ...inlineAction };
    if (value === undefined) delete candidate.routeDirectionId;
    else candidate.routeDirectionId = value;

    const parsed = inlineDispatcherActionSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path.join('.') === 'routeDirectionId')).toBe(true);
  });

  it('accepts a uuid routeDirectionId', () => {
    expect(inlineDispatcherActionSchema.safeParse(inlineAction).success).toBe(true);
  });
});
