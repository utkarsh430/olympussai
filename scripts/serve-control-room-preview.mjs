/**
 * Bundle and serve the control-room review harness on a scratch port.
 *
 * See scripts/preview-control-room.tsx for why a harness exists at all. This
 * script is the plumbing: esbuild for the entry, the project's own Tailwind
 * build for the stylesheet, and a static server. It binds nothing but the port
 * it is given, talks to no database, and refuses to start if the port is taken -
 * a review tool that quietly steals the port a live app is serving on would be
 * a considerably worse bug than anything it was built to find.
 *
 *   node scripts/serve-control-room-preview.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.preview-control-room');
const port = Number(process.argv[2] ?? 3111);

const stubs = {
  link: path.join(outDir, 'stub-link.tsx'),
  navigation: path.join(outDir, 'stub-navigation.ts'),
};

async function writeStubs() {
  await mkdir(outDir, { recursive: true });
  // next/link and next/navigation only exist inside a Next runtime. The shell
  // uses Link for its nav and usePathname to mark the current entry; in the
  // harness those are a plain anchor and a fixed path.
  await writeFile(
    stubs.link,
    `import type { ReactNode } from 'react';
export default function Link({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) {
  return <a href={href} {...rest}>{children}</a>;
}
`,
  );
  await writeFile(stubs.navigation, `export function usePathname() { return '/ops/control-room'; }\n`);

  // Next inlines NEXT_PUBLIC_* at build time; a plain esbuild bundle has to be
  // given them. Written to a file rather than passed as a --define so the value
  // never appears in a process argument list. See buildJs.
  await writeFile(
    path.join(outDir, 'maps-key.js'),
    `globalThis.process = globalThis.process || { env: {} };
globalThis.process.env = globalThis.process.env || {};
globalThis.process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = ${JSON.stringify(
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
    )};
export {};
`,
  );
}

async function buildCss() {
  const out = path.join(outDir, 'preview.css');
  await run('npx', ['tailwindcss', '-i', 'src/app/globals.css', '-o', out, '--minify'], { cwd: root });
  return out;
}

/**
 * esbuild's own binary, located in the pnpm store.
 *
 * It is a transitive dependency here rather than a declared one, so a bare
 * `import 'esbuild'` fails under pnpm's strict node_modules and `npx esbuild`
 * finds nothing on PATH. Resolving the shipped binary uses the exact version
 * the toolchain already installed without adding a dependency for a review
 * tool.
 */
async function esbuildBinary() {
  const base = path.join(root, 'node_modules/.pnpm');
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(base);
  const dir = entries.find((name) => name.startsWith('esbuild@'));
  if (!dir) throw new Error('esbuild is not installed');
  return path.join(base, dir, 'node_modules/esbuild/bin/esbuild');
}

async function buildJs() {
  const out = path.join(outDir, 'preview.js');
  await run(
    await esbuildBinary(),
    [
      path.join(root, 'scripts/preview-control-room.tsx'),
      '--bundle',
      `--outfile=${out}`,
      '--format=iife',
      '--jsx=automatic',
      '--target=es2022',
      '--log-level=warning',
      '--define:process.env.NODE_ENV="production"',
      // The basemap key reaches the bundle through a GENERATED FILE, never
      // through argv. Process arguments are world-readable via `ps` and are
      // echoed verbatim in any spawn error, and a review tool has no business
      // putting a credential of any grade where either can see it - even one
      // that is public by design and referrer-restricted.
      `--inject:${path.join(outDir, 'maps-key.js')}`,
      `--alias:@=${path.join(root, 'src')}`,
      `--alias:next/link=${stubs.link}`,
      `--alias:next/navigation=${stubs.navigation}`,
      `--alias:server-only=${path.join(root, 'src/tests/stubs/server-only.ts')}`,
    ],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );
  return out;
}

function page(fixture) {
  return `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Control room — review harness</title>
<link rel="stylesheet" href="/preview.css" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400..900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<style>
  :root { --font-display: 'Orbitron', system-ui, sans-serif; --font-mono: 'JetBrains Mono', ui-monospace, monospace; }
  html, body, #root { height: 100%; margin: 0; background: #02040a; }
</style>
</head>
<body>
<div id="root"></div>
<script>
  window.__FIXTURE__ = ${JSON.stringify(fixture)};
</script>
<script src="/preview.js"></script>
</body>
</html>`;
}

async function main() {
  if (!existsSync(path.join(root, 'scripts/preview-control-room-data.json'))) {
    throw new Error('Run scripts/capture-control-room-fixture.ts first.');
  }
  await writeStubs();
  const [cssPath, jsPath] = await Promise.all([buildCss(), buildJs()]);
  const [css, js, fixtureRaw] = await Promise.all([
    readFile(cssPath, 'utf8'),
    readFile(jsPath, 'utf8'),
    readFile(path.join(root, 'scripts/preview-control-room-data.json'), 'utf8'),
  ]);
  const fixture = JSON.parse(fixtureRaw);
  const html = page(fixture);

  const server = createServer((request, response) => {
    const url = (request.url ?? '/').split('?')[0];
    if (url === '/preview.css') {
      response.writeHead(200, { 'content-type': 'text/css' });
      response.end(css);
      return;
    }
    if (url === '/preview.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(js);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });

  server.on('error', (error) => {
    console.error(`[preview] could not bind :${port} — ${error.message}`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => console.log(`[preview] http://127.0.0.1:${port}`));
}

void main();
