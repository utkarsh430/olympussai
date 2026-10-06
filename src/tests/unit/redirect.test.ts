import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT, PROTECTED_ROOTS, sanitizeNext } from '@/lib/auth/redirect';

describe('sanitizeNext', () => {
  it('falls back to the default for empty input', () => {
    expect(sanitizeNext(null)).toBe(DEFAULT_NEXT);
    expect(sanitizeNext(undefined)).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('')).toBe(DEFAULT_NEXT);
  });

  it.each(PROTECTED_ROOTS)('allows the protected root %s and paths under it', (root) => {
    expect(sanitizeNext(root)).toBe(root);
    expect(sanitizeNext(`${root}/a/b`)).toBe(`${root}/a/b`);
  });

  it('allows a depot deep link and keeps its query string and hash', () => {
    expect(sanitizeNext('/project/depots/d/42/roster?state=dark#top')).toBe(
      '/project/depots/d/42/roster?state=dark#top',
    );
  });

  it('rejects a lookalike prefix', () => {
    expect(sanitizeNext('/project/depotsX')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/project/upsrtc-admin')).toBe(DEFAULT_NEXT);
  });

  it('rejects internal paths outside the protected roots', () => {
    expect(sanitizeNext('/project/other')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/api/auth/logout')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/login')).toBe(DEFAULT_NEXT);
  });

  it('rejects external and protocol-relative targets', () => {
    expect(sanitizeNext('https://evil.example')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('//evil.example')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/\\evil.example')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('javascript:alert(1)')).toBe(DEFAULT_NEXT);
  });

  it('rejects traversal out of a protected root', () => {
    expect(sanitizeNext('/project/depots/../../login')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/project/depots/%2e%2e/%2e%2e/login')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/project/depots\\..\\..\\login')).toBe(DEFAULT_NEXT);
  });

  it('rejects whitespace smuggling that would resolve off-origin', () => {
    expect(sanitizeNext('/\t/evil.example')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/\n/evil.example')).toBe(DEFAULT_NEXT);
  });

  it('normalises traversal that stays inside a protected root', () => {
    expect(sanitizeNext('/project/depots/d/../league')).toBe('/project/depots/league');
  });
});
