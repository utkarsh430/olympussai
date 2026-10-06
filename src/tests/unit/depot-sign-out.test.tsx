import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepotSignOut, SIGN_OUT_FAILED } from '@/components/depot/shell/DepotSignOut';

const originalFetch = globalThis.fetch;
const originalLocation = window.location;
const assign = vi.fn();

beforeEach(() => {
  assign.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

async function press(): Promise<void> {
  await act(async () => {
    screen.getByTestId('depot-sign-out').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('signing out of the depot module', () => {
  it('goes to the login page once the server has ended the session', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;
    render(<DepotSignOut />);
    await press();
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('stays on the page and says so when the server refused', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response) as typeof fetch;
    render(<DepotSignOut />);
    await press();
    expect(assign).not.toHaveBeenCalled();
    const button = screen.getByTestId('depot-sign-out') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Sign-out failed: retry');
    expect(screen.getByRole('status').textContent).toBe(SIGN_OUT_FAILED);
  });

  it('stays on the page when the request never reached the server', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    render(<DepotSignOut />);
    await press();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(SIGN_OUT_FAILED);
  });
});
