import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AttentionStrip } from '@/components/depot/cockpit/AttentionStrip';
import { BriefingRow } from '@/components/depot/cockpit/BriefingRow';
import type { CopilotScope } from '@/lib/depot/copilot/wire';
import type { AttentionLine } from '@/lib/depot/cockpit/attention';

function line(key: string, count: number, text: string): AttentionLine {
  return { key, count, text: `${count} ${text}`, href: '/roster', destination: 'Roster' };
}

function render(lines: readonly AttentionLine[]): Document {
  const markup = renderToStaticMarkup(<AttentionStrip attention={{ lines, calm: null }} />);
  return new DOMParser().parseFromString(markup, 'text/html');
}

const FIVE = [
  line('power', 31, 'buses report main power off'),
  line('off', 10, 'buses are off the road'),
  line('tamper', 4, 'buses report a tamper code'),
  line('dark', 35, 'buses are dark: no signal for 6 h or more'),
  line('heard', 22, 'buses have not been heard for over 30 min'),
];

describe('the attention strip', () => {
  it('draws the bottom rule across the empty fifth cell of a 3+2 strip', () => {
    const filler = render(FIVE).querySelector('[data-testid="depot-attention-filler"]');
    expect(filler?.className).toContain('border-b');
    expect(filler?.getAttribute('aria-hidden')).not.toBeNull();
  });

  it('has no filler when the strip is even', () => {
    expect(render(FIVE.slice(0, 4)).querySelector('[data-testid="depot-attention-filler"]')).toBeNull();
  });

  it('keeps one heading on the opened briefing: the card label and headline are not drawn', () => {
    const markup = renderToStaticMarkup(
      <BriefingRow scope={{ kind: 'depot', depotId: '20' } as CopilotScope} feedNow={null} />,
    );
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    // The card is embedded (it draws no label and no headline), not hidden with CSS: a
    // hidden headline could still take focus and be read.
    const body = doc.querySelector('[data-testid="depot-briefing-row"] > div[hidden]');
    expect(body?.className).not.toContain('[&_h');
    expect(doc.querySelectorAll('h2')).toHaveLength(1);
  });

  it('wraps a line on a phone instead of cutting it; truncates only from 640px', () => {
    const doc = render(FIVE);
    const words = doc.querySelector('[data-testid="depot-attention-dark"] [title]');
    const classes = (words?.className ?? '').split(/\s+/);
    expect(classes).not.toContain('truncate');
    expect(classes).toContain('sm:truncate');
  });
});
