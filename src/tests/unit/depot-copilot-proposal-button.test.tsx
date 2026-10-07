import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposalRationaleButton } from '@/components/depot/copilot/RationaleButton';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;
const originalFetch = globalThis.fetch;

let root: Root | null = null;
let container: HTMLElement;

const ANSWER = {
  headline: 'R_1, proposed change: add 3 buses',
  paragraphs: ['Body.'],
  provider: 'scripted',
  notice: 'none',
  generatedAt: '2026-10-06T09:30:00.000Z',
  cached: false,
  facts: [],
};

async function render(element: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  globalThis.fetch = originalFetch;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('the rationale button on a route proposal', () => {
  it('asks for the proposal by id and route only when opened, and shows the explanation', async () => {
    const fn = vi.fn(async () => ({ status: 200, ok: true, json: async () => ANSWER }));
    globalThis.fetch = fn as unknown as typeof fetch;
    await render(
      <ProposalRationaleButton proposalId="p-0a1b2c3d" routeName="R_1" label="07:00–10:00 add 3" />,
    );
    const toggle = container.querySelector('button') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe('Why? 07:00–10:00 add 3');
    expect(fn).not.toHaveBeenCalled();
    await act(async () => toggle.click());
    expect(fn).toHaveBeenCalledTimes(1);
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      task: 'rationale',
      proposalId: 'p-0a1b2c3d',
      routeName: 'R_1',
    });
    expect(container.querySelector('[data-testid="rationale-panel"]')?.textContent).toContain('Body.');
  });

  it('starts closed and empty for another proposal', async () => {
    const fn = vi.fn(async () => ({ status: 200, ok: true, json: async () => ANSWER }));
    globalThis.fetch = fn as unknown as typeof fetch;
    const element = (id: string): React.ReactElement => (
      <ProposalRationaleButton proposalId={id} routeName="R_1" label="x" />
    );
    await render(element('p-0a1b2c3d'));
    const toggle = container.querySelector('button') as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await act(async () => root?.render(element('p-11111111')));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="rationale-panel"]')).toBeNull();
  });
});
