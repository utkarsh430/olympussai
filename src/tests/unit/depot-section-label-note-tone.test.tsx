import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';

describe('a section label note that names a severity', () => {
  it('is printed in that severity colour, and stays plain without a tone', () => {
    const toned = renderToStaticMarkup(<SectionLabel label="Emergency flag" note="Critical" noteTone="critical" />);
    expect(toned).toMatch(/class="depot-note[^"]*text-alert-crimson[^"]*">Critical</);
    const plain = renderToStaticMarkup(<SectionLabel label="Roster" note="Nearest first" />);
    expect(plain).not.toMatch(/text-alert-/);
  });
});
