// @vitest-environment jsdom
//
// The two people-screen actions whose consequences are invisible in the UI and
// severe outside it.
//
// ROLE ASSIGNMENT had no control anywhere until now: POST
// /api/ops/admin/users/:id/role has existed since the auth collapse, and the
// only way an admin could move somebody between roles was to disable them and
// re-invite — which the invite endpoint refuses, because the address already
// has an account. It is also the one write in this product that must land in
// two stores or neither, and it always costs the operator their current
// sign-in.
//
// DISABLING revokes this product immediately and bans the sign-in identity,
// but it cannot invalidate a token already issued: that signature stays valid
// until it expires. Inside this product that grants nothing; against the
// Supabase project it is a real, bounded window. "Access revoked immediately"
// is the simpler sentence and the false one.
//
// So both are asserted on what the admin is TOLD, not only on what is sent.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OpsAdminPeoplePanel } from '@/components/ops/admin/OpsAdminPeoplePanel';

const DEPOT_ID = 'aaaaaaaa-0000-4000-8000-00000000bbbb';

function users() {
  return {
    users: [
      {
        id: 'user-dispatcher-1',
        email: 'dispatcher1@olympuss.us',
        name: 'Dispatcher One',
        role: 'dispatcher',
        status: 'active',
        vehicleId: null,
        depotId: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  };
}

interface Sent {
  url: string;
  method?: string;
  body?: unknown;
}

function mount(
  handlers: {
    role?: (body: unknown) => { ok: boolean; json: unknown };
    disable?: () => { ok: boolean; json: unknown };
  } = {},
) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        if (url === '/api/ops/admin/users') return { ok: true, json: async () => users() };
        if (url === '/api/ops/admin/invites')
          return { ok: true, json: async () => ({ invites: [] }) };
        if (url === '/api/ops/admin/depots') {
          return {
            ok: true,
            json: async () => ({ depots: [{ id: DEPOT_ID, code: 'BAREILLY', name: 'Bareilly' }] }),
          };
        }
      }
      if (url.endsWith('/role') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        sent.push({ url, method: 'POST', body });
        const result = handlers.role?.(body) ?? {
          ok: true,
          json: { ok: true, role: body.role, claimWritten: true, requiresReauth: true },
        };
        return { ok: result.ok, json: async () => result.json };
      }
      if (url.endsWith('/disable') && init?.method === 'POST') {
        sent.push({ url, method: 'POST' });
        const result = handlers.disable?.() ?? {
          ok: true,
          json: { ok: true, id: 'user-dispatcher-1', status: 'disabled', identityRevoked: true },
        };
        return { ok: result.ok, json: async () => result.json };
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    }),
  );
  const view = render(<OpsAdminPeoplePanel />);
  return { ...view, sent };
}

async function operatorRow() {
  return (await screen.findByText('Dispatcher One')).closest('tr')!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('changing an operator’s role', () => {
  it('does not send on the first click — it states what the change costs', async () => {
    const { sent } = mount();
    const row = await operatorRow();

    fireEvent.change(within(row).getByLabelText(/change role/i), { target: { value: 'planner' } });
    fireEvent.click(within(row).getByRole('button', { name: /^change$/i }));

    expect(within(row).getByText(/from dispatcher to planner/i)).toBeInTheDocument();
    expect(
      within(row).getByText(/writes both this system and their sign-in, or neither/i),
    ).toBeInTheDocument();
    expect(within(row).getByText(/must sign in again/i)).toBeInTheDocument();
    // Nothing has been written.
    expect(sent).toEqual([]);
  });

  it('sends the new role only after the confirmation', async () => {
    const { sent } = mount();
    const row = await operatorRow();

    fireEvent.change(within(row).getByLabelText(/change role/i), { target: { value: 'planner' } });
    fireEvent.click(within(row).getByRole('button', { name: /^change$/i }));
    fireEvent.click(within(row).getByRole('button', { name: /^change role$/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      url: '/api/ops/admin/users/user-dispatcher-1/role',
      method: 'POST',
      body: { role: 'planner' },
    });
  });

  it('reports the sign-out the operator is about to experience', async () => {
    mount();
    const row = await operatorRow();

    fireEvent.change(within(row).getByLabelText(/change role/i), { target: { value: 'planner' } });
    fireEvent.click(within(row).getByRole('button', { name: /^change$/i }));
    fireEvent.click(within(row).getByRole('button', { name: /^change role$/i }));

    await waitFor(() =>
      expect(within(row).getByRole('status')).toHaveTextContent(/until they sign in again/i),
    );
  });

  it('offers setting the SAME role again, because that is the documented repair', async () => {
    // Setting the role somebody already holds is not a no-op: it writes the
    // role onto their sign-in again, and it is the fix for a sign-in that
    // disagrees with this system. A UI that greyed it out would remove the
    // only repair path.
    const { sent } = mount();
    const row = await operatorRow();

    fireEvent.click(within(row).getByRole('button', { name: /^set again$/i }));
    expect(
      within(row).getByText(/fix for somebody whose sign-in disagrees with this system/i),
    ).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: /^set role again$/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ role: 'dispatcher' });
  });

  it('says nothing was applied when the two-store write failed', async () => {
    // The route rolls the database change back when the claim write fails,
    // precisely so the account is never left half-assigned. Reporting that as
    // a generic error would leave an admin unsure which half landed.
    mount({
      role: () => ({
        ok: false,
        json: {
          error: {
            code: 'ROLE_CLAIM_WRITE_FAILED',
            message:
              'The role was not changed. The sign-in provider could not be updated, and applying only half of the change would have locked this operator out.',
          },
        },
      }),
    });
    const row = await operatorRow();

    fireEvent.change(within(row).getByLabelText(/change role/i), { target: { value: 'planner' } });
    fireEvent.click(within(row).getByRole('button', { name: /^change$/i }));
    fireEvent.click(within(row).getByRole('button', { name: /^change role$/i }));

    await waitFor(() =>
      expect(within(row).getByRole('alert')).toHaveTextContent(/the role was not changed/i),
    );
  });
});

describe('disabling an operator', () => {
  it('states the residual window rather than promising instant revocation', async () => {
    const { sent } = mount();
    const row = await operatorRow();

    fireEvent.click(within(row).getByRole('button', { name: /^disable$/i }));

    expect(
      within(row).getByText(/everything this account asks for is refused/i),
    ).toBeInTheDocument();
    expect(within(row).getByText(/sign-in is blocked/i)).toBeInTheDocument();
    // THE HONEST HALF. "Access revoked immediately" is the simpler sentence
    // and the slightly false one.
    expect(within(row).getByText(/stays technically valid until it runs out/i)).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('disables only after the confirmation', async () => {
    const { sent } = mount();
    const row = await operatorRow();

    fireEvent.click(within(row).getByRole('button', { name: /^disable$/i }));
    fireEvent.click(within(row).getByRole('button', { name: /^disable account$/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.url).toBe('/api/ops/admin/users/user-dispatcher-1/disable');
  });

  it('surfaces a failed identity revocation instead of reporting a clean disable', async () => {
    // The ops surface IS revoked at that point, so the route answers 200 — but
    // the Supabase sign-in is still live, and that is a fact an admin has to
    // act on rather than one to swallow because the status code was green.
    mount({
      disable: () => ({
        ok: true,
        json: {
          ok: true,
          id: 'user-dispatcher-1',
          status: 'disabled',
          identityRevoked: false,
          warning:
            'Access is revoked — every request from this account is now refused. Their Supabase sign-in identity could NOT be revoked.',
        },
      }),
    });
    const row = await operatorRow();

    fireEvent.click(within(row).getByRole('button', { name: /^disable$/i }));
    fireEvent.click(within(row).getByRole('button', { name: /^disable account$/i }));

    // Deliberately NOT inside the row: disabling rewrites that row in the same
    // update, so a warning rendered there would flash and vanish. This is the
    // one message on the screen an admin has to act on.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not be revoked/i),
    );
    expect(screen.getByText(/its sign-in is not/i)).toBeInTheDocument();
  });
});

describe('inviting somebody who already has an account', () => {
  it('shows the endpoint’s own remedy rather than a generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (!init || init.method === undefined) {
          if (url === '/api/ops/admin/users') return { ok: true, json: async () => users() };
          if (url === '/api/ops/admin/invites') {
            return { ok: true, json: async () => ({ invites: [] }) };
          }
          if (url === '/api/ops/admin/depots')
            return { ok: true, json: async () => ({ depots: [] }) };
        }
        if (url === '/api/ops/admin/invites' && init?.method === 'POST') {
          return {
            ok: false,
            json: async () => ({
              error: {
                code: 'USER_ALREADY_EXISTS',
                message:
                  'dispatcher1@olympuss.us already has an operations account (dispatcher). Invites only create new accounts. To move this person to another role, change their role on the people screen.',
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<OpsAdminPeoplePanel />);

    fireEvent.change(await screen.findByLabelText(/^email/i), {
      target: { value: 'dispatcher1@olympuss.us' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already has an operations account/i);
    expect(alert).toHaveTextContent(/change their role/i);
  });
});
