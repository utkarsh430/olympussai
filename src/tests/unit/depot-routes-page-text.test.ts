import { describe, expect, it } from 'vitest';
import { ROUTES_TEXT, disclosureWord } from '@/lib/depot/routes/routesPageText';

describe('routes page text', () => {
  it('never says "simulated" and ends every sentence with a full stop', () => {
    for (const text of Object.values(ROUTES_TEXT)) {
      expect(text.toLowerCase()).not.toContain('simulated');
    }
    expect(ROUTES_TEXT.noRoutes.endsWith('.')).toBe(true);
  });

  it('says why the route list is empty', () => {
    expect(ROUTES_TEXT.noRoutes).toContain('no bus carrying a route name');
  });

  it('words a disclosure state rather than relying on an arrow', () => {
    expect(disclosureWord(false)).toBe('Show');
    expect(disclosureWord(true)).toBe('Hide');
  });
});
