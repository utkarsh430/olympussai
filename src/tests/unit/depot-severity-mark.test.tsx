import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SeverityMark } from '@/components/depot/shell/SeverityMark';

afterEach(cleanup);

/** One severity treatment (design critique round 4, H). */
describe('SeverityMark', () => {
  it.each([
    ['critical', 'Critical', 'bg-alert-crimson'],
    ['warning', 'Warning', 'bg-alert-amber'],
    ['info', 'Info', 'bg-depot-muted'],
  ] as const)('shows %s as a square and the word', (severity, word, colour) => {
    render(<SeverityMark severity={severity} />);
    const mark = screen.getByTestId('depot-severity');
    expect(mark.textContent).toBe(word);
    expect(mark.querySelector('[aria-hidden]')?.className).toContain(colour);
    expect(mark.className).not.toContain('border');
  });
});
