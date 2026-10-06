import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';

function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, '');
}

describe('ProvenanceBadge', () => {
  it('reads the label alone', () => {
    expect(textOf(renderToStaticMarkup(<ProvenanceBadge provenance="live" />))).toBe('LIVE');
  });

  it('separates the label from the coverage in its text', () => {
    const markup = renderToStaticMarkup(
      <ProvenanceBadge provenance="derived" coverage={{ n: 112, of: 143 }} />,
    );
    expect(textOf(markup)).toBe('DERIVED 112 of 143');
  });
});
