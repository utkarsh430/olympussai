import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingCard } from '@/components/depot/copilot/BriefingCard';

const ANSWER = {
  headline: 'Headline',
  paragraphs: ['Body.'],
  provider: 'scripted',
  notice: 'none',
  generatedAt: '2026-10-06T09:30:00.000Z',
  cached: false,
  facts: [],
};
const WRITTEN_AT = '2026-10-06T09:30:00Z';
const LATER = '2026-10-06T09:31:00Z';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
let root: Root | null = null;
let container: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;

async function show(feedTime: string): Promise<void> {
  await act(async () =>
    root?.render(
      <BriefingCard scope={{ kind: 'network' }} title="Network briefing" currentFeedTime={feedTime} />,
    ),
  );
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === name);
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn(async () => ({ status: 200, ok: true, json: async () => ANSWER }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

describe('BriefingCard and the page feed time', () => {
  it('says nothing while the page shows the feed the text was written from', async () => {
    await show(WRITTEN_AT);
    await act(async () => buttonsNamed('Write briefing')[0]?.click());
    expect(container.textContent).not.toContain('The page has updated since');
    expect(buttonsNamed('Write again')).toHaveLength(1);
  });

  it('says the page has updated since, and offers to write again once', async () => {
    await show(WRITTEN_AT);
    await act(async () => buttonsNamed('Write briefing')[0]?.click());
    await show(LATER);
    expect(container.textContent).toContain('The page has updated since; write again.');
    const again = buttonsNamed('Write again');
    expect(again).toHaveLength(1);
    await act(async () => again[0]?.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('The page has updated since');
  });
});

describe('BriefingCard embedded in a row that already names it', () => {
  it('draws no heading of its own and lands focus on the first paragraph', async () => {
    // A page row labelled "Briefing" opens the card: a second label and the answer's
    // headline would make three headings for one panel.
    await act(async () =>
      root?.render(
        <BriefingCard
          scope={{ kind: 'network' }}
          title="Network briefing"
          currentFeedTime={WRITTEN_AT}
          embedded
        />,
      ),
    );
    expect(container.querySelectorAll('h2, h3, h4')).toHaveLength(0);
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('Network briefing');
    await act(async () => buttonsNamed('Write briefing')[0]?.click());
    expect(container.querySelectorAll('h2, h3, h4')).toHaveLength(0);
    expect(container.textContent).not.toContain('Headline');
    expect(container.textContent).toContain('Body.');
    expect(document.activeElement?.textContent).toBe('Body.');
  });

  it('keeps its label and the headline when it stands alone', async () => {
    await show(WRITTEN_AT);
    expect(container.querySelector('h2')?.textContent).toBe('Network briefing');
    await act(async () => buttonsNamed('Write briefing')[0]?.click());
    expect(container.querySelector('h3')?.textContent).toBe('Headline');
  });
});
