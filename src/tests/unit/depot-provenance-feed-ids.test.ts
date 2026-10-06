import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEED_REGISTRY } from '@/lib/depot/sources/registry';

/* A page's provenance line links to Data sources at the replacing feed's section;
   an id the registry does not know would open the page at no section. */

const APP_ROOT = join(process.cwd(), 'src/app/(protected)/project/depots');

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

describe('every feed id a page passes exists in the registry', () => {
  const known = new Set(FEED_REGISTRY.map((feed) => feed.id));
  const passed = pageFiles(APP_ROOT).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/feedId: '([^']+)'/g)].map((m) => ({ file, id: m[1] ?? '' })),
  );

  it('finds the pages that name a replacing feed', () => {
    expect(passed.length).toBeGreaterThanOrEqual(5);
  });

  it.each(passed.map((p) => [p.id, p.file] as const))('%s is a registry feed (%s)', (id) => {
    expect(known.has(id)).toBe(true);
  });
});
