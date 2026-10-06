import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnswerTable } from '@/components/depot/copilot/AnswerTable';
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
    const list = container.querySelector('ul') as HTMLElement;
    expect(button.textContent).toBe('Figures used: 1');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(list.id);
    expect(list.hidden).toBe(true);
    await act(async () => {
      button.click();
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
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
