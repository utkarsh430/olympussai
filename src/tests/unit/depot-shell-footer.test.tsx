import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FooterDisclaimer } from '@/components/shared/FooterDisclaimer';
import { FOOTER_DISCLAIMER } from '@/lib/constants';
import { depotDisclaimerText } from '@/lib/depot/shellModel';

afterEach(cleanup);

const BELOW_FLOOR = /\btext-\[(?:9|10)px\]/;

const DEPOT_TEXT = depotDisclaimerText(FOOTER_DISCLAIMER);

function summary(text: string = FOOTER_DISCLAIMER): HTMLElement {
  return screen.getByText(text, { selector: 'button span' });
}

describe('the depot disclaimer sentence', () => {
  it('drops the leading "Prototype." because the pill beside it already says it', () => {
    expect(FOOTER_DISCLAIMER.startsWith('Prototype. ')).toBe(true);
    expect(DEPOT_TEXT.startsWith('Vehicle positions and schedules are live')).toBe(true);
    expect(DEPOT_TEXT).toBe(FOOTER_DISCLAIMER.slice('Prototype. '.length));
    expect(depotDisclaimerText('No lead word here.')).toBe('No lead word here.');
  });
});

describe('the footer disclaimer in the depot shell', () => {
  it('wraps the sentence at sans 11/16, at most 90 characters wide, without "Prototype." twice', () => {
    render(<FooterDisclaimer variant="depot" />);
    const line = summary(DEPOT_TEXT);
    expect(line.className).not.toMatch(/\btruncate\b/);
    expect(line.className).toMatch(/\btext-\[11px\]/);
    expect(line.className).toMatch(/\bleading-4\b/);
    expect(line.className).toMatch(/\bmax-w-\[90ch\]/);
    expect(screen.getByTestId('footer-disclaimer').textContent?.match(/prototype/gi)).toHaveLength(1);
  });

  it('sets the sentence in the sans face in the depot shell, like every other sentence there', () => {
    render(<FooterDisclaimer variant="depot" />);
    expect(summary(DEPOT_TEXT).className).toMatch(/\bfont-sans\b/);
    expect(summary(DEPOT_TEXT).className).not.toMatch(/\bfont-mono\b/);
    fireEvent.click(screen.getByRole('button'));
    for (const p of screen.getByTestId('footer-disclaimer').querySelectorAll('p')) {
      expect(p.className).toMatch(/\bfont-sans\b/);
    }
  });

  it('puts nothing below 11px, open or closed, and does not repeat the sentence when open', () => {
    render(<FooterDisclaimer variant="depot" />);
    fireEvent.click(screen.getByRole('button'));
    const footer = screen.getByTestId('footer-disclaimer');
    const small = Array.from(footer.querySelectorAll('*')).filter((el) =>
      BELOW_FLOOR.test(el.getAttribute('class') ?? ''),
    );
    expect(small).toEqual([]);
    expect(screen.getAllByText(DEPOT_TEXT)).toHaveLength(1);
    expect(screen.queryByText(FOOTER_DISCLAIMER)).toBeNull();
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
