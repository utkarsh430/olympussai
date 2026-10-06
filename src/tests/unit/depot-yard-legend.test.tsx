import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YardMapLegend } from '@/components/depot/yard/YardMapLegend';

// Rewritten for the design wave: the legend, the drawn-count note and the circle
// explanation are one caption row. The drawn count and the visitors with no position
// now come from `mapCaption` (tested in depot-yard-page-model.test.ts); the row shows
// that caption, every state by name, both marker shapes and what the circle is.
describe('YardMapLegend caption row', () => {
  const html = renderToStaticMarkup(
    <YardMapLegend caption="3 buses drawn: 2 in the yard, 1 visiting." />,
  );
  const text = html.replace(/<[^>]*>/g, '');

  it('carries the model caption as the map note', () => {
    expect(html).toContain('data-testid="yard-map-note"');
    expect(text).toContain('3 buses drawn: 2 in the yard, 1 visiting.');
  });

  it('names every state beside its swatch, and both marker shapes', () => {
    for (const word of ['In service', 'Standing', 'Dark', 'Off road']) expect(text).toContain(word);
    expect(text).toContain('this depot');
    expect(text).toContain('visiting');
  });

  it('says the circle is inferred, not surveyed', () => {
    expect(text).toContain('not surveyed');
  });
});
