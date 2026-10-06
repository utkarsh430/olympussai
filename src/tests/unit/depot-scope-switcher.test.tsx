import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScopeSwitcher } from '@/components/depot/shell/ScopeSwitcher';

const push = vi.fn();
const DEPOTS = [
  { id: '20', name: 'Varanasi', kind: 'depot', fleet: 142 },
  { id: '7', name: 'Agra Fort', kind: 'depot', fleet: 88 },
];

vi.mock('next/navigation', () => ({
  usePathname: (): string => '/project/depots/d/20',
  useRouter: (): { push: typeof push } => ({ push }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { depots: DEPOTS },
    error: null,
    loading: false,
    refresh: () => {},
  }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  push.mockClear();
});

function activeLabel(): string | undefined {
  const id = screen.getByRole('combobox').getAttribute('aria-activedescendant');
  return id ? (document.getElementById(id)?.textContent ?? undefined) : undefined;
}

describe('ScopeSwitcher', () => {
  it('opens on the current scope, marked current, with focus in the filter', async () => {
    const user = userEvent.setup();
    render(<ScopeSwitcher />);
    await user.click(screen.getByRole('button', { name: /UPSRTC \/ Varanasi/ }));
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(activeLabel()).toContain('Varanasi');
    expect(screen.getByRole('option', { current: true }).textContent).toContain('Varanasi');
  });

  it('filters as you type, wraps with the arrows, and navigates on Enter', async () => {
    const user = userEvent.setup();
    render(<ScopeSwitcher />);
    await user.click(screen.getByRole('button'));
    await user.type(screen.getByRole('combobox'), 'a');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Agra Fort'),
      expect.stringContaining('Varanasi'),
    ]);
    await user.keyboard('{ArrowUp}');
    expect(activeLabel()).toContain('Varanasi');
    await user.keyboard('{ArrowDown}');
    expect(activeLabel()).toContain('Agra Fort');
    await user.keyboard('{Enter}');
    expect(push).toHaveBeenCalledWith('/project/depots/d/7');
  });

  it('closes on Escape and returns focus to the button', async () => {
    const user = userEvent.setup();
    render(<ScopeSwitcher />);
    const button = screen.getByRole('button');
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
