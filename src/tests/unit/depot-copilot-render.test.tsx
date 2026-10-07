import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnswerTable } from '@/components/depot/copilot/AnswerTable';
import { AskPanel } from '@/components/depot/copilot/AskPanel';
import { BriefingCard } from '@/components/depot/copilot/BriefingCard';
import { RationaleButton } from '@/components/depot/copilot/RationaleButton';

// The panel only reads the depot list; the real provider would start a poll.
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({ data: null, error: null, loading: false, refresh: () => {} }),
}));
import { CopilotText } from '@/components/depot/copilot/CopilotText';
import { FactChips } from '@/components/depot/copilot/FactChips';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

const HOSTILE = [
  '<img src=x onerror=alert(1)>',
  '[a](http://b)',
  '<script>alert(1)</script>',
  'https://example.com and **bold** and 12 buses',
];

let root: Root | null = null;
let container: HTMLElement;

async function render(element: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

function expectInert(): void {
  expect(container.querySelector('img, a, script, iframe, style')).toBeNull();
  for (const text of HOSTILE) expect(container.textContent).toContain(text);
}

describe('model text is rendered literally', () => {
  it('CopilotText shows headline and paragraphs as text', async () => {
    await render(<CopilotText headline={HOSTILE[0] ?? ''} paragraphs={HOSTILE.slice(1)} />);
    expectInert();
  });

  it('a fact row shows label and value as text', async () => {
    await render(
      <FactChips
        facts={[
          { id: 'a', label: HOSTILE[0] ?? '', text: HOSTILE[1] ?? '', provenance: 'live' },
          { id: 'b', label: HOSTILE[2] ?? '', text: HOSTILE[3] ?? '', provenance: 'modelled' },
        ]}
      />,
    );
    await act(async () => {
      container.querySelector('button')?.click();
    });
    expectInert();
  });

  it('table cells, columns and caption show as text', async () => {
    await render(
      <AnswerTable
        caption={HOSTILE[3] ?? ''}
        table={{ columns: [HOSTILE[0] ?? '', HOSTILE[1] ?? ''], rows: [[HOSTILE[2] ?? '', 'x']] }}
      />,
    );
    expect(container.querySelector('img, a, script')).toBeNull();
    expect(container.textContent).toContain(HOSTILE[0]);
    expect(container.textContent).toContain(HOSTILE[2]);
  });
});

describe('small component behaviour', () => {
  it('an empty table says so instead of drawing a bare frame', async () => {
    await render(<AnswerTable caption="c" table={{ columns: ['a'], rows: [] }} />);
    expect(container.textContent).toBe('No rows matched.');
    expect(container.querySelector('table')).toBeNull();
  });

  it('the figures disclosure is a button that toggles the list', async () => {
    await render(
      <FactChips facts={[{ id: 'a', label: 'L', text: 'T', provenance: 'live' }]} />,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Figures used: 1');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // Collapsed means absent: a display utility would beat the `hidden` attribute.
    expect(container.querySelector('ul')).toBeNull();
    expect(button.hasAttribute('aria-controls')).toBe(false);
    await act(async () => {
      button.click();
    });
    const list = container.querySelector('ul') as HTMLElement;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(list.id);
    await act(async () => {
      button.click();
    });
    expect(container.querySelector('ul')).toBeNull();
  });

  it('CopilotText can take focus on its headline', async () => {
    await render(<CopilotText headline="H" paragraphs={['p']} focusOnMount />);
    expect(document.activeElement?.textContent).toBe('H');
  });

  it('CopilotText renders no heading element when the level is null', async () => {
    await render(<CopilotText headline="H" paragraphs={['p']} headingLevel={null} />);
    expect(container.querySelector('h2, h3, h4')).toBeNull();
  });
});

const ANSWER = {
  headline: 'Headline',
  paragraphs: ['Body.'],
  provider: 'scripted',
  notice: 'none',
  generatedAt: '2026-10-06T09:30:00.000Z',
  cached: false,
  facts: [],
};

function stubFetchOk(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ status: 200, ok: true, json: async () => ANSWER }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

async function click(element: Element | null): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

describe('BriefingCard', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('requests nothing until asked, announces progress and focuses the headline', async () => {
    const fn = stubFetchOk();
    await render(<BriefingCard scope={{ kind: 'network' }} title="Network briefing" />);
    expect(fn).not.toHaveBeenCalled();
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toBe('');
    await click(container.querySelector('button'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toBe('Briefing ready');
    expect(document.activeElement?.textContent).toBe('Headline');
  });
});

describe('rationale parts', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('requests once per expansion and keeps the text across collapse and re-open', async () => {
    const fn = stubFetchOk();
    await render(<RationaleButton transferId="t1" label="Kurla to Panvel" headingLevel={4} />);
    const toggle = container.querySelector('button') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Why? Kurla to Panvel');
    // The panel is not rendered while collapsed, so nothing is controlled.
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    await click(toggle);
    expect(fn).toHaveBeenCalledTimes(1);
    const panel = container.querySelector('[data-testid="rationale-panel"]');
    expect(toggle.getAttribute('aria-controls')).toBe(panel?.id);
    expect(container.querySelector('[data-testid="rationale-status"]')?.textContent).toBe(
      'Explanation ready',
    );
    expect(container.querySelector('[data-testid="rationale-panel"]')?.textContent).toContain(
      'Body.',
    );
    await click(toggle);
    expect(container.querySelector('[data-testid="rationale-panel"]')).toBeNull();
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    await click(toggle);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="rationale-panel"]')?.textContent).toContain(
      'Headline',
    );
  });

  it('starts fresh when the plan changes the bus count for the same transfer', async () => {
    const fn = stubFetchOk();
    const element = (buses: number): React.ReactElement => (
      <RationaleButton transferId="t1" planBuses={buses} label="Kurla to Panvel" />
    );
    await render(element(5));
    const toggle = container.querySelector('button') as HTMLButtonElement;
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="rationale-panel"]')?.textContent).toContain(
      'Body.',
    );
    // The same count keeps the text; a new count resets it.
    await act(async () => root?.render(element(5)));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await act(async () => root?.render(element(9)));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="rationale-panel"]')).toBeNull();
    await click(toggle);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('live region holds only a short string, never the text', async () => {
    stubFetchOk();
    await render(<RationaleButton transferId="t1" label="x" />);
    await click(container.querySelector('button'));
    const status = container.querySelector('[data-testid="rationale-status"]');
    expect(status?.textContent).not.toContain('Body.');
  });
});

describe('AskPanel', () => {
  it('shows only network examples when no depot is chosen', async () => {
    await render(
        <AskPanel />
    );
    expect(container.textContent).not.toContain('this depot');
    expect(container.querySelectorAll('[aria-label="Example questions"] button')).toHaveLength(10);
  });

  it('an empty submit keeps the button enabled and says what to do in the status line', async () => {
    await render(
        <AskPanel />
    );
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await click(submit);
    expect(container.querySelector('p[role="status"]')?.textContent).toBe('Type a question first.');
  });
});
