import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';

function band(title?: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <FigureBand label="Yard">
      <Figure label="Capacity" value="40" title={title} />
    </FigureBand>,
  );
  return host;
}

describe('Figure title', () => {
  it('explains the figure on hover and to assistive technology, as text', () => {
    const host = band('Bays come from the depot master <b>not</b> a survey.');
    const item = host.querySelector('li');
    expect(item?.getAttribute('title')).toBe('Bays come from the depot master <b>not</b> a survey.');
    expect(item?.querySelector('.sr-only')?.textContent).toBe(
      'Bays come from the depot master <b>not</b> a survey.',
    );
    expect(host.querySelector('b')).toBeNull();
  });

  it('adds nothing without a title', () => {
    const item = band().querySelector('li');
    expect(item?.hasAttribute('title')).toBe(false);
    expect(item?.querySelector('.sr-only')).toBeNull();
  });
});
