import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollapsedSection } from '@/components/depot/shell/CollapsedSection';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;
let container: HTMLElement;

async function mount(node: React.ReactNode): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
}

function toggle(): HTMLButtonElement {
  const button = container.querySelector('button');
  if (!button) throw new Error('no toggle');
  return button;
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

describe('CollapsedSection', () => {
  it('is closed by default and does not render its content', async () => {
    await mount(
      <CollapsedSection label="Every depot" count={1200} note="Deepest first" headingId="h">
        <p>Inside</p>
      </CollapsedSection>,
    );
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Inside');
    expect(container.querySelector('h2#h button')).toBe(toggle());
    expect(container.textContent).toContain('Every depot · 1,200');
    expect(container.textContent).toContain('Deepest first');
  });

  it('opens and closes from its button, which controls the content region', async () => {
    await mount(
      <CollapsedSection label="Sandbox">
        <p>Inside</p>
      </CollapsedSection>,
    );
    await act(async () => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const region = document.getElementById(toggle().getAttribute('aria-controls') ?? '');
    expect(region?.textContent).toBe('Inside');
    await act(async () => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Inside');
  });

  it('keeps content mounted and hidden while closed when asked, with no display class', async () => {
    function Typed() {
      const [value, setValue] = useState('');
      return <input aria-label="field" value={value} onChange={(e) => setValue(e.target.value)} />;
    }
    await mount(
      <CollapsedSection label="Sandbox" keepMounted>
        <Typed />
      </CollapsedSection>,
    );
    const region = document.getElementById(toggle().getAttribute('aria-controls') ?? '');
    // Hidden by the display class alone: no `hidden` attribute for a display class to beat.
    expect(region?.hasAttribute('hidden')).toBe(false);
    expect(region?.getAttribute('class')).toBe('hidden');
    await act(async () => toggle().click());
    expect(region?.getAttribute('class')).toBeNull();
  });

  it('follows a controlled open state', async () => {
    const seen: boolean[] = [];
    await mount(
      <CollapsedSection label="Sandbox" open onToggle={(next) => seen.push(next)}>
        <p>Inside</p>
      </CollapsedSection>,
    );
    expect(container.textContent).toContain('Inside');
    await act(async () => toggle().click());
    expect(seen).toEqual([false]);
    expect(container.textContent).toContain('Inside');
  });

  it('as a row, is a plain toggle with no heading', async () => {
    await mount(
      <CollapsedSection variant="row" label="Show the suggested roster">
        <p>Inside</p>
      </CollapsedSection>,
    );
    expect(container.querySelector('h2')).toBeNull();
    expect(toggle().textContent).toContain('Show the suggested roster');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await act(async () => toggle().click());
    expect(container.textContent).toContain('Inside');
  });
});
