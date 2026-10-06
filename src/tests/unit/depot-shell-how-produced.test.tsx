import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOW_PRODUCED_SUMMARY, HowProduced } from '@/components/depot/shell/HowProduced';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;
let container: HTMLElement;

async function mount(node: React.ReactNode): Promise<HTMLDetailsElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  const details = container.querySelector('details');
  if (!details) throw new Error('no details element');
  return details;
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '', '/');
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

describe('HowProduced', () => {
  it('is a closed native disclosure with the fixed summary text', async () => {
    const details = await mount(
      <HowProduced>
        <p>One sentence.</p>
      </HowProduced>,
    );
    expect(details.open).toBe(false);
    // The chevron is aria-hidden; the summary's readable text is the fixed sentence.
    const summary = details.querySelector('summary');
    summary?.querySelector('[aria-hidden]')?.remove();
    expect(summary?.textContent).toBe(HOW_PRODUCED_SUMMARY);
    expect(HOW_PRODUCED_SUMMARY).toBe('How these figures are produced');
    expect(details.getAttribute('data-testid')).toBe('depot-how-produced');
  });

  it('renders paragraphs as text, then the children, unchanged', async () => {
    const details = await mount(
      <HowProduced paragraphs={['First <b>line</b>.', 'Second line.']}>
        <p>Third line.</p>
      </HowProduced>,
    );
    const lines = [...details.querySelectorAll('p')].map((p) => p.textContent);
    expect(lines).toEqual(['First <b>line</b>.', 'Second line.', 'Third line.']);
    expect(details.querySelector('b')).toBeNull();
  });

  it('keeps a page test id when one is given', async () => {
    const details = await mount(<HowProduced testId="depot-cockpit-method" />);
    expect(details.getAttribute('data-testid')).toBe('depot-cockpit-method');
  });

  it('opens when the address names its id, on load and on a later hash change', async () => {
    window.history.replaceState(null, '', '/#how');
    const details = await mount(<HowProduced id="how" />);
    expect(details.id).toBe('how');
    expect(details.open).toBe(true);

    details.open = false;
    window.history.replaceState(null, '', '/#elsewhere');
    await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(details.open).toBe(false);
    window.history.replaceState(null, '', '/#how');
    await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(details.open).toBe(true);
  });

  it('stays closed when it has no id, whatever the address says', async () => {
    window.history.replaceState(null, '', '/#how');
    const details = await mount(<HowProduced />);
    expect(details.open).toBe(false);
  });
});
