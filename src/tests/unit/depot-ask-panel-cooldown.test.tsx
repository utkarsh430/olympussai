import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskPanel } from '@/components/depot/copilot/AskPanel';
import type { CopilotState } from '@/hooks/useCopilot';

vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({ data: null, error: null, loading: false, refresh: () => {} }),
}));

let hookState: CopilotState = { status: 'idle' };
vi.mock('@/hooks/useCopilot', () => ({
  useCopilot: () => ({ state: hookState, request: () => {}, reset: () => {} }),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;
let root: Root | null = null;
let container: HTMLElement;

async function renderWith(state: CopilotState): Promise<void> {
  hookState = state;
  await act(async () => {
    root?.render(<AskPanel />);
  });
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('AskPanel rate-limit wait', () => {
  it('keeps the live region constant while the countdown ticks in its own element', async () => {
    await renderWith({ status: 'failed', kind: 'rate_limited', secondsRemaining: 5 });
    const live = container.querySelector('p[role="status"]') as HTMLElement;
    const liveBefore = live.textContent;
    const countdown = container.querySelector('[data-testid="ask-countdown"]') as HTMLElement;
    expect(liveBefore).toBe('Too many requests. Please wait.');
    expect(countdown.textContent).toBe('Try again in 5 seconds.');

    await renderWith({ status: 'failed', kind: 'rate_limited', secondsRemaining: 4 });
    expect(live.textContent).toBe(liveBefore);
    expect(countdown.textContent).toBe('Try again in 4 seconds.');
    expect(countdown.closest('[role="status"]')).toBeNull();
    expect(countdown.hasAttribute('aria-live')).toBe(false);
  });

  it('shows no countdown when the wait is not a rate limit', async () => {
    await renderWith({ status: 'failed', kind: 'network' });
    expect(container.querySelector('[data-testid="ask-countdown"]')).toBeNull();
  });
});
