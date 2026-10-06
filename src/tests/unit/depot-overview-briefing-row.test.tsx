import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkBriefingRow } from '@/components/depot/network/NetworkBriefingRow';

// The card itself is tested elsewhere; here, what the row asks of it.
vi.mock('@/components/depot/copilot/BriefingCard', () => ({
  BriefingCard: (props: { readonly embedded?: boolean; readonly title: string }) => (
    <div data-testid="card" data-embedded={String(props.embedded === true)}>
      {props.embedded ? null : <h2>{props.title}</h2>}
    </div>
  ),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const tokens = (el: Element | null): string[] => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('overview briefing row', () => {
  it('stacks on a phone: the sentence whole on its own line, the button on the next', () => {
    act(() => root.render(<NetworkBriefingRow feedNow={null} />));
    const sentence = container.querySelector('[data-testid="depot-briefing-row-sentence"]');
    // Full width below 640, so the button wraps to a line of its own; never truncated there.
    expect(tokens(sentence)).toContain('basis-full');
    expect(tokens(sentence)).not.toContain('truncate');
    expect(tokens(sentence)).toContain('sm:truncate');
    expect(tokens(sentence?.parentElement ?? null)).toContain('flex-wrap');
    const order = Array.from(sentence?.parentElement?.children ?? []).map((el) => el.tagName);
    expect(order).toEqual(['H2', 'P', 'BUTTON']);
  });

  it('opens the card embedded, so the opened panel has one heading, and keeps it when closed', () => {
    act(() => root.render(<NetworkBriefingRow feedNow="2026-10-06T17:04:00+05:30" />));
    expect(container.querySelector('[data-testid="card"]')).toBeNull();
    const button = container.querySelector('button') as HTMLButtonElement;
    act(() => button.click());
    const card = container.querySelector('[data-testid="card"]');
    expect(card?.getAttribute('data-embedded')).toBe('true');
    expect(container.querySelectorAll('h2, h3')).toHaveLength(1);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    act(() => button.click());
    const body = card?.parentElement as HTMLElement;
    expect(body.hidden).toBe(true);
    // No display class beside the attribute: a display class would keep it visible.
    expect(tokens(body).some((t) => /^(block|flex|grid|hidden)$/.test(t))).toBe(false);
    expect(container.querySelector('[data-testid="card"]')).not.toBeNull();
  });
});
