import { describe, expect, it } from 'vitest';
import { ROUTES_TEXT, disclosureWord } from '@/lib/depot/routes/routesPageText';

describe('routes page text', () => {
  it('never says "simulated" and ends every sentence with a full stop', () => {
    for (const text of Object.values(ROUTES_TEXT)) {
      expect(text.toLowerCase()).not.toContain('simulated');
    }
    for (const sentence of [ROUTES_TEXT.unmovedHint, ROUTES_TEXT.unmovedNone, ROUTES_TEXT.noRoutes]) {
      expect(sentence.endsWith('.')).toBe(true);
    }
  });

  it('says why the route list is empty, and that only a missing profile can leave nothing unmoved', () => {
    expect(ROUTES_TEXT.noRoutes).toContain('no bus carrying a route name');
    expect(ROUTES_TEXT.unmovedNone).toContain('missing profile');
  });

  it('words a disclosure state rather than relying on an arrow', () => {
    expect(disclosureWord(false)).toBe('Show');
    expect(disclosureWord(true)).toBe('Hide');
  });
});
