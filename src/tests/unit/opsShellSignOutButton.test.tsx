// The "Sign out" control has to be honest about what it did.
//
// Its original implementation fired POST /api/ops/auth/logout, ignored the
// response entirely and navigated to /login. Since that endpoint only cleared
// the legacy cookie, a Supabase-authenticated operator saw a login page over a
// session that was still live — and, crucially, had no way to tell. On a
// shared depot tablet the operator's confidence IS the control: they hand the
// device over because the screen said they were signed out.
//
// So the assertions here are about sequence and about failure. Navigation
// happens only after the server confirms the session ended, and a failed
// sign-out keeps the operator on the page with an error rather than showing
// them a login screen that means nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpsShell } from '@/components/ops/OpsShell';

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign, href: 'https://olympuss.test/ops/driver' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderShell() {
  return render(<OpsShell title="Driver" email="driver@olympuss.local" />);
}

describe('OpsShell sign out', () => {
  it('navigates to the front door only after the server ends the session', async () => {
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        order.push('logout');
        return { ok: true, json: async () => ({ ok: true, supabase: 'signed_out' }) };
      }),
    );
    assign.mockImplementation(() => order.push('navigate'));

    renderShell();
    await userEvent.click(screen.getByTestId('ops-sign-out'));

    expect(fetch).toHaveBeenCalledWith('/api/ops/auth/logout', { method: 'POST' });
    expect(order).toEqual(['logout', 'navigate']);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('stays put and says so when the sign-out failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ ok: false, error: { code: 'SIGN_OUT_INCOMPLETE' } }),
      })),
    );

    renderShell();
    await userEvent.click(screen.getByTestId('ops-sign-out'));

    // The login page would be a lie here: the session is still live.
    expect(assign).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/still signed in/i);
    // And the operator can try again.
    expect(screen.getByTestId('ops-sign-out')).toBeEnabled();
  });

  it('treats a request that never reached the server as a failed sign-out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderShell();
    await userEvent.click(screen.getByTestId('ops-sign-out'));

    expect(assign).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
