import { describe, expect, it } from 'vitest';
import { bannedOnScreen } from './depot-guard-rendered';

/* The page checks rest on this scanner, so it is shown to catch what it must and only that. */
describe('the rendered-page scanner', () => {
  it('finds the banned word and a raw date in text and in human-facing attributes', () => {
    const markup = [
      '<p>Simulated fleet</p>',
      '<span title="as of 2026-10-06">6 Oct</span>',
      '<button aria-label="simulated buses">x</button>',
      '<div>Updated 2026-10-06T08:00:00Z</div>',
    ].join('');
    expect(bannedOnScreen(markup)).toEqual([
      '"simulated" in text',
      'raw date in text: 2026-10-06',
      'raw date in span[title]: 2026-10-06',
      '"simulated" in button[aria-label]',
    ]);
  });

  it('accepts a plain date in words and the machine-readable datetime attribute', () => {
    expect(bannedOnScreen('<time datetime="2026-10-06">6 Oct 2026</time> MODELLED')).toEqual([]);
  });

  it('reads a rendered element as well as markup', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-label', '2026-10-06');
    expect(bannedOnScreen(el)).toEqual(['raw date in div[aria-label]: 2026-10-06']);
  });
});
