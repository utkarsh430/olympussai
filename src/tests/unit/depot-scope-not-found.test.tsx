import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DepotNotFound from '@/app/(protected)/project/depots/d/not-found';

describe('depot scope not-found page', () => {
  const markup = renderToStaticMarkup(<DepotNotFound />);

  it('has its own h1 saying the address is not valid', () => {
    expect(markup).toMatch(/<h1[^>]*>Depot not found<\/h1>/);
    expect(markup).toContain('This depot address is not valid');
  });

  it('links back to the headquarters overview', () => {
    expect(markup).toMatch(
      /<a[^>]*href="\/project\/depots"[^>]*>Back to the headquarters overview<\/a>/,
    );
  });
});
