// @vitest-environment node
//
// Structural proof that everything reachable from src/middleware.ts stays
// Edge-safe.
//
// Collapsing the two front doors moved real logic into middleware's import
// graph (src/lib/auth/rbac/edgeSession.ts -> supabaseClaims.ts), and the
// modules right next to it in the same directory are emphatically NOT
// edge-safe: rbac/server.ts pulls in `next/headers`, and rbac/repo.ts pulls
// in `pg`, which opens raw TCP sockets. One convenience import from either
// and the Edge bundle stops building — in `next build`, i.e. after the change
// has been written, reviewed and merged.
//
// No RUNTIME test can catch this. The unit suite runs middleware under Node,
// where `next/headers` resolves fine and vitest.config.ts deliberately aliases
// `server-only` to a no-op stub so the rest of the suite can import Node
// modules at all. So this walks the actual import graph instead, statically,
// the same way opsMiddlewareRoleGate.test.ts walks the real route tree rather
// than trusting a hand-maintained list.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.join(process.cwd(), 'src');
const ENTRY = path.join(SRC, 'middleware.ts');

/**
 * Modules that cannot run on the Edge runtime. `pg` opens raw TCP sockets;
 * `next/headers` is a Node-runtime-only API; `server-only` is a build-time
 * assertion that a module must never leave the server, which middleware
 * bundling treats as an error.
 */
const FORBIDDEN = ['server-only', 'pg', 'next/headers', 'bcryptjs', 'node:fs', 'fs'] as const;

const IMPORT_SOURCES = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [IMPORT_SOURCES, BARE_IMPORT]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      if (match[1]) found.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return found;
}

/** Resolve a local specifier to a file on disk, or null if it is a package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate).length >= 0 && /\.tsx?$/.test(candidate)) return candidate;
      } catch {
        // Directory, not a file — keep looking.
      }
    }
  }
  return null;
}

/** Every local module reachable from `entry`, plus which file pulled each one in. */
function reachable(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const specifiers = specifiersOf(readFileSync(file, 'utf8'));
    graph.set(file, specifiers);

    for (const specifier of specifiers) {
      const resolved = resolveLocal(specifier, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return graph;
}

describe('src/middleware.ts import graph stays Edge-safe', () => {
  const graph = reachable(ENTRY);

  it('reaches the modules this change put on the edge path (guards against the scan going empty)', () => {
    const files = [...graph.keys()].map((file) => path.relative(SRC, file));
    expect(files).toContain('middleware.ts');
    expect(files).toContain('lib/auth/rbac/edgeSession.ts');
    expect(files).toContain('lib/auth/rbac/supabaseClaims.ts');
  });

  it.each(FORBIDDEN)('never imports %s, directly or transitively', (forbidden) => {
    const offenders = [...graph.entries()]
      .filter(([, specifiers]) => specifiers.includes(forbidden))
      .map(([file]) => path.relative(SRC, file));

    expect(
      offenders,
      `${offenders.join(', ')} import '${forbidden}', which cannot run on the Edge runtime. ` +
        'Middleware may only read a role out of a verified token; the database authority ' +
        'lives in src/lib/auth/rbac/server.ts, on the Node runtime.',
    ).toEqual([]);
  });
});
