import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MapUnavailable } from '@/components/depot/shell/MapUnavailable';

function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, '');
}

describe('MapUnavailable', () => {
  it('says the basemap is unavailable in one sentence and offers Retry', () => {
    const markup = renderToStaticMarkup(<MapUnavailable onRetry={() => undefined} />);
    expect(textOf(markup)).toBe(
      'Basemap unavailable. The depot table and ranked lists below still work.Retry',
    );
    expect(markup).toContain('role="alert"');
  });

  it('carries no glow, icon or key detail', () => {
    const markup = renderToStaticMarkup(<MapUnavailable onRetry={() => undefined} />);
    expect(markup).not.toMatch(/shadow|glow|<svg|key|googleapis/i);
  });
});
