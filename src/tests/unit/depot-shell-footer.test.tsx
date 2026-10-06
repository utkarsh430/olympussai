import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FooterDisclaimer } from '@/components/shared/FooterDisclaimer';
import { FOOTER_DISCLAIMER } from '@/lib/constants';

afterEach(cleanup);

const BELOW_FLOOR = /\btext-\[(?:9|10)px\]/;

function summary(): HTMLElement {
  return screen.getByText(FOOTER_DISCLAIMER, { selector: 'button span' });
}

describe('the footer disclaimer in the depot shell', () => {
  it('wraps the whole sentence at 11px instead of cutting it off', () => {
    render(<FooterDisclaimer variant="depot" />);
    const line = summary();
    expect(line.className).not.toMatch(/\btruncate\b/);
    expect(line.className).toMatch(/\btext-\[11px\]/);
  });

  it('puts nothing below 11px, open or closed, and does not repeat the sentence when open', () => {
    render(<FooterDisclaimer variant="depot" />);
    fireEvent.click(screen.getByRole('button'));
    const footer = screen.getByTestId('footer-disclaimer');
    const small = Array.from(footer.querySelectorAll('*')).filter((el) =>
      BELOW_FLOOR.test(el.getAttribute('class') ?? ''),
    );
    expect(small).toEqual([]);
    expect(screen.getAllByText(FOOTER_DISCLAIMER)).toHaveLength(1);
  });
});

describe('the footer disclaimer elsewhere', () => {
  it.each(['dark', 'light'] as const)('keeps the %s variant exactly as before', (variant) => {
    render(<FooterDisclaimer variant={variant} />);
    expect(summary().className).toMatch(/\btruncate\b/);
    expect(summary().className).toMatch(/\btext-\[10px\]/);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByText(FOOTER_DISCLAIMER)).toHaveLength(2);
  });
});
