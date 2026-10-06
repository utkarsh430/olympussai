import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YardMapKey, YardMapNote } from '@/components/depot/yard/YardMapLegend';

// The key (state swatches, marker shapes, what
// the circle is) moved inside the map's bottom-left on a 90% surface chip; the drawn-count
// caption is the one sans line under the map. Every assertion of the old caption row is
// kept, split across the two pieces.
describe('YardMapNote', () => {
  const html = renderToStaticMarkup(
    <YardMapNote caption="3 buses drawn: 2 in the yard, 1 visiting." />,
  );

  it('carries the model caption as the map note, in the sans face', () => {
    expect(html).toContain('data-testid="yard-map-note"');
    expect(html).toContain('depot-note');
    expect(html.replace(/<[^>]*>/g, '')).toContain('3 buses drawn: 2 in the yard, 1 visiting.');
  });
});

describe('YardMapKey', () => {
  const html = renderToStaticMarkup(<YardMapKey />);
  const text = html.replace(/<[^>]*>/g, '');

  it('names every state beside its swatch, and both marker shapes', () => {
    for (const word of ['In service', 'Standing', 'Dark', 'Off road']) expect(text).toContain(word);
    expect(text).toContain('this depot');
    expect(text).toContain('visiting');
  });

  it('says the circle is inferred, not surveyed', () => {
    expect(text).toContain('not surveyed');
  });

  it('sits inside the map bottom-left on a 90% surface chip from 640px', () => {
    for (const cls of ['sm:absolute', 'sm:left-2', 'sm:bottom-8', 'sm:bg-depot-surface/90']) {
      expect(html).toContain(cls);
    }
  });
});
