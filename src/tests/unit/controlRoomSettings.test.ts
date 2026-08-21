// @vitest-environment node
//
// The switch that decides what the controller optimises:
// GET/PUT /api/ops/control-room/settings.
//
// ─── WHAT THE SWITCH MEANS ───────────────────────────────────────────────
//
// OFF (the default) the engine weighs the operator's two stated priorities and
// nothing else: even spacing, and the timetable delay bunching causes. ON it
// also prices the delay a hold imposes on passengers already aboard.
//
// ON is not simply "kinder". The exchange rate between those groups is the
// passenger arrival rate, still proxied as one passenger per planned headway,
// under which the in-vehicle term costs roughly half a headway of hold per
// person aboard - so a single passenger cancels any hold. Turning it on early
// silences the controller, and a silent controller looks exactly like a
// healthy network.
//
// The assertions below are mostly about the two ways that could go wrong: an
// unattributed change, and an unreadable setting being rendered as "off".
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ControlServiceConfigError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';
import { rolesForOpsApiPath } from '@/lib/auth/rbac/roles';

const requireOpsRole = vi.fn();
const fetchControlService = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));

vi.mock('@/lib/controlService/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/controlService/client')>();
  return { ...actual, fetchControlService: (...args: unknown[]) => fetchControlService(...args) };
});

const { GET, PUT } = await import('@/app/api/ops/control-room/settings/route');

const SETTINGS_OFF = {
  weighOccupancy: false,
  updatedAt: '2026-08-20T09:00:00.000Z',
  updatedBy: null,
  updateReason: null,
};

function putRequest(body: unknown, origin = 'https://ops.example.com') {
  return new NextRequest('https://ops.example.com/api/ops/control-room/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', origin, host: 'ops.example.com' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({
    ok: true,
    claims: { sub: 'user-1', email: 'operator@example.com', role: 'control_room' },
  });
});

describe('GET /api/ops/control-room/settings', () => {
  it('reports what the controller is currently weighing, and who set it', async () => {
    fetchControlService.mockResolvedValue({
      ...SETTINGS_OFF,
      weighOccupancy: true,
      updatedBy: 'someone@example.com',
      updateReason: 'boardings loaded',
    });

    const body = await (await GET()).json();
    expect(body.weighOccupancy).toBe(true);
    expect(body.updatedBy).toBe('someone@example.com');
    expect(body.updateReason).toBe('boardings loaded');
  });

  // Unknown and off are different facts, and only one of them is safe to act
  // on. The route must not answer 200-with-false when it could not read.
  it('fails loudly rather than reporting the switch as off when it cannot be read', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('down'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('UNAVAILABLE');
  });

  it('says so when the control service is not configured at all', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceConfigError('unset'));
    expect((await GET()).status).toBe(503);
  });

  it('refuses anyone who is not control room', async () => {
    requireOpsRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('is reachable at the edge by exactly the role the handler admits', () => {
    expect(rolesForOpsApiPath('/api/ops/control-room/settings', 'GET')).toEqual(['control_room']);
    expect(rolesForOpsApiPath('/api/ops/control-room/settings', 'PUT')).toEqual(['control_room']);
  });
});

describe('PUT /api/ops/control-room/settings', () => {
  it('flips the switch and records the reason', async () => {
    fetchControlService.mockResolvedValue({
      ...SETTINGS_OFF,
      weighOccupancy: true,
      updatedBy: 'operator@example.com',
      updateReason: 'boardings loaded for Lucknow',
    });

    const response = await PUT(
      putRequest({ weighOccupancy: true, updateReason: 'boardings loaded for Lucknow' }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).weighOccupancy).toBe(true);
  });

  // THE LOAD-BEARING ONE. An audit field the client can set is not an audit
  // field - it records whatever the caller typed. The actor must come from
  // the session, and a submitted one must be ignored rather than honoured.
  it('attributes the change to the signed-in operator, never to the request body', async () => {
    fetchControlService.mockResolvedValue({ ...SETTINGS_OFF, updatedBy: 'operator@example.com' });

    await PUT(
      putRequest({
        weighOccupancy: true,
        updateReason: 'because',
        updatedBy: 'someone-else@evil.example.com',
      }),
    );

    const [, options] = fetchControlService.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body.updatedBy).toBe('operator@example.com');
  });

  // Six months from now the only evidence of why the engine's priorities
  // changed is this field, so an empty one is refused rather than stored.
  it('refuses a change with no reason', async () => {
    const response = await PUT(putRequest({ weighOccupancy: true, updateReason: '   ' }));
    expect(response.status).toBe(400);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a settings change at all', async () => {
    expect((await PUT(putRequest({ nonsense: true }))).status).toBe(400);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  // A state-changing request on a control surface goes through the same
  // origin gate as every other operator-initiated control-room write.
  it('refuses a cross-origin write', async () => {
    const response = await PUT(
      putRequest({ weighOccupancy: true, updateReason: 'x' }, 'https://evil.example.com'),
    );
    expect(response.status).toBe(403);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('refuses anyone who is not control room', async () => {
    requireOpsRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const response = await PUT(putRequest({ weighOccupancy: true, updateReason: 'x' }));
    expect(response.status).toBe(403);
    expect(fetchControlService).not.toHaveBeenCalled();
  });
});
