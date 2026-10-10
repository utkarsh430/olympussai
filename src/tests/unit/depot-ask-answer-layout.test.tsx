import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnswerView } from '@/components/depot/copilot/AnswerView';
import type { CopilotApiResponse } from '@/lib/depot/copilot/wire';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

const RESPONSE = {
  headline: 'Depots by dark rate',
  paragraphs: ['<b>Not markup</b>'],
  provider: 'scripted',
  notice: null,
  generatedAt: '2026-10-06T08:30:00.000Z',
  cached: false,
  facts: [],
  interpretedAs: 'Depots by dark rate, highest first, up to 5',
  table: { columns: ['Depot', 'Value'], rows: [['LALGANJ', '38%']] },
} as unknown as CopilotApiResponse;

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

describe('AnswerView layout', () => {
  it('puts "Understood as" under the question, keeps text as text, and ends with the footer', () => {
    act(() =>
      root.render(
        <ol>
          <AnswerView entry={{ id: 1, question: 'Which depots are dark?', scopeLabel: 'Headquarters', response: RESPONSE }} />
        </ol>,
      ),
    );
    // The question line, then "Understood as" directly under it as its own muted
    // line, both in the first block; the headline starts a separate block.
    const parts = Array.from(container.querySelectorAll('li > *')).map((el) => el.textContent ?? '');
    expect(parts[0]).toContain('Which depots are dark?');
    const understood = container.querySelector('[data-testid="ask-understood-as"]');
    expect(understood?.textContent).toBe('Understood as: Depots by dark rate, highest first, up to 5');
    expect(understood?.previousElementSibling?.textContent).toContain('Which depots are dark?');
    expect(understood?.className).toContain('depot-note');
    expect(parts[1]).not.toContain('Understood as');
    expect(container.querySelector('b')).toBeNull();
    const last = container.querySelector('li')?.lastElementChild;
    expect(last?.querySelector('[data-testid="copilot-provider"]')).not.toBeNull();
  });

  it("says the answer's data source on its footer line", () => {
    const response = { ...RESPONSE, dataSource: 'sample' } as CopilotApiResponse;
    act(() =>
      root.render(
        <ol>
          <AnswerView entry={{ id: 1, question: 'Which depots are dark?', scopeLabel: 'Headquarters', response }} />
        </ol>,
      ),
    );
    const source = container.querySelector('[data-testid="copilot-data-source"]');
    expect(source?.textContent).toBe('sample data');
  });

  it('does not draw a title on the evidence table, but names it for assistive technology', () => {
    act(() =>
      root.render(
        <ol>
          <AnswerView entry={{ id: 1, question: 'q', scopeLabel: 'Headquarters', response: RESPONSE }} />
        </ol>,
      ),
    );
    const caption = container.querySelector('caption');
    expect(caption?.className).toContain('sr-only');
    expect(caption?.textContent).toBe('Depots by dark rate');
  });
});
