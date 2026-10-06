import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopilotFooter } from '@/components/depot/copilot/CopilotFooter';
import { figureWords, isOutdatedText, writtenWords } from '@/lib/depot/copilotFooter';
import { isLaterFeedTime } from '@/lib/depot/format';

afterEach(cleanup);

const FACTS = [
  { id: 'a', label: 'Fleet', text: '143', provenance: 'live' as const },
  { id: 'b', label: '<b>bold</b>', text: '12', provenance: 'modelled' as const },
];
const BASE = {
  provider: 'scripted' as const,
  notice: 'none' as const,
  generatedAt: '2026-10-06T08:30:00.000Z',
  cached: false,
  facts: FACTS,
};

describe('copilot footer wording', () => {
  it('writes the time in Indian time and counts the figures', () => {
    expect(writtenWords('2026-10-06T08:30:00.000Z', false)).toBe('written 14:00');
    expect(writtenWords('2026-10-06T08:30:00.000Z', true)).toBe('written 14:00, reused');
    expect(writtenWords('nope', false)).toBe('written just now');
    expect(figureWords(18)).toBe('18 figures');
    expect(figureWords(1)).toBe('1 figure');
  });

  it('is outdated only when the page feed is strictly newer', () => {
    expect(isOutdatedText('2026-10-06T14:00:00Z', '2026-10-06T14:01:00Z')).toBe(true);
    expect(isOutdatedText('2026-10-06T14:00:00Z', '2026-10-06T14:00:00Z')).toBe(false);
    expect(isOutdatedText(null, '2026-10-06T14:01:00Z')).toBe(false);
    expect(isLaterFeedTime('2026-10-06T14:01:00', 'x')).toBe(false);
  });
});

describe('CopilotFooter', () => {
  it('is one line naming the writer in words, and opens the figures from it', () => {
    render(<CopilotFooter {...BASE} />);
    const footer = screen.getByTestId('copilot-footer');
    expect(footer.querySelector('p')?.textContent).toBe('SCRIPTED · written 14:00 · 2 figures');
    const button = screen.getByRole('button', { name: '2 figures' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(footer.querySelector('ul')).toBeNull();
    fireEvent.click(button);
    expect(footer.querySelectorAll('li')).toHaveLength(2);
    // Server text stays text.
    expect(footer.querySelector('b')).toBeNull();
    expect(footer.textContent).toContain('<b>bold</b>');
  });

  it('names Claude and keeps the fallback sentence', () => {
    const { rerender } = render(<CopilotFooter {...BASE} provider="claude" />);
    expect(screen.getByTestId('copilot-provider').textContent).toBe('CLAUDE');
    rerender(<CopilotFooter {...BASE} notice="claude_unavailable" />);
    expect(screen.getByText(/Claude was not available/)).toBeTruthy();
  });

  it('offers to write again when the page has moved on, and only on a press', () => {
    const again = vi.fn();
    const { rerender } = render(
      <CopilotFooter
        {...BASE}
        writtenFromFeedTime="2026-10-06T14:00:00Z"
        currentFeedTime="2026-10-06T14:00:00Z"
        onWriteAgain={again}
      />,
    );
    expect(screen.queryByText('The page has updated since; write again.')).toBeNull();
    rerender(
      <CopilotFooter
        {...BASE}
        writtenFromFeedTime="2026-10-06T14:00:00Z"
        currentFeedTime="2026-10-06T14:02:00Z"
        onWriteAgain={again}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain(
      'The page has updated since; write again.',
    );
    expect(again).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Write again' }));
    expect(again).toHaveBeenCalledOnce();
  });
});
