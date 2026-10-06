import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireProjectSession } from '@/lib/auth/server';
import { filesUnder, ROOT } from './depot-guard-source';

/*
 * Every depot page and layout gates itself: layouts do not re-run on client
 * navigation, so a page that relies on its layout (or on the middleware alone)
 * is served to anyone holding a stale tab. Each module is found by walking the
 * folder, so a page added later is checked without editing this file.
 *
 * The session gate is replaced by one that throws a sentinel. Rendering a
 * gated page rejects with it; a page that forgot its gate resolves to JSX
 * instead, and fails. The depot gate (`requireDepotPage`) is left real, so a
 * depot-scope page is shown to reach the session gate through it.
 */

vi.mock('@/lib/auth/server', () => ({ requireProjectSession: vi.fn() }));
// The module layout loads its typeface at import; outside Next the loader is not there.
vi.mock('next/font/google', () => {
  const font = (): object => ({ className: 'font', variable: '--font', style: {} });
  // Any font name resolves; `then` stays absent so the module is not taken for a promise.
  const isFont = (key: string | symbol): boolean => typeof key === 'string' && key !== 'then';
  return new Proxy({}, {
    get: (_t, key) => (isFont(key) ? font : undefined),
    has: (_t, key) => isFont(key),
  });
});

const PAGES_DIR = 'src/app/(protected)/project/depots';
const SENTINEL = new Error('the session gate ran');

type PageModule = { default: (props: Record<string, unknown>) => unknown };

const FILES = filesUnder(PAGES_DIR, (name) => name === 'page.tsx' || name === 'layout.tsx');

/** The props Next passes a page or layout: params for each dynamic segment, an empty query. */
function propsFor(file: string): Record<string, unknown> {
  const params = Object.fromEntries([...file.matchAll(/\[([^\]]+)\]/g)].map((m) => [m[1], '1']));
  return {
    params: Promise.resolve(params),
    searchParams: Promise.resolve({}),
    children: null,
  };
}

beforeEach(() => {
  vi.mocked(requireProjectSession).mockReset();
  vi.mocked(requireProjectSession).mockRejectedValue(SENTINEL);
});

describe('every depot page and layout calls its session gate', () => {
  it('finds the pages', () => {
    expect(FILES.filter((f) => f.endsWith('page.tsx')).length).toBeGreaterThanOrEqual(18);
  });

  it.each(FILES.map((f) => [f.slice(PAGES_DIR.length + 1), f] as const))(
    '%s rejects with the gate before it renders anything',
    async (_name, file) => {
      const mod = (await import(/* @vite-ignore */ join(ROOT, file))) as PageModule;
      const render = Promise.resolve().then(() => mod.default(propsFor(file)));
      await expect(render).rejects.toBe(SENTINEL);
      expect(requireProjectSession).toHaveBeenCalledTimes(1);
      const [returnTo] = vi.mocked(requireProjectSession).mock.calls[0] ?? [];
      // The return path brings the user back into the module after signing in.
      expect(String(returnTo)).toMatch(/^\/project\/depots(\/|$)/);
    },
    30_000,
  );
});
