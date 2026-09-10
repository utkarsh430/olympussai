/**
 * Bundle and serve the simulator review harness on a scratch port.
 *
 * See scripts/preview-simulator.tsx for why a harness exists at all. This
 * script is the plumbing: esbuild for the entry, the project's own Tailwind
 * build for the stylesheet, and a static server. It binds nothing but the port
 * it is given, talks to no database and to no control service, and refuses to
 * start if the port is taken - a review tool that quietly steals the port a
 * live app is serving on would be a considerably worse bug than anything it
 * was built to find.
 *
 *   pnpm --dir control-service sim:fleet --corridor urban --vehicles 1000 --out /tmp/trial
 *   node scripts/serve-simulator-preview.mjs /tmp/trial/report.json [port]
 *
 * Modelled on scripts/serve-control-room-preview.mjs, which does the same job
 * for the sibling console; the two are deliberately the same shape.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.preview-simulator');

const reportPath = process.argv[2];
const port = Number(process.argv[3] ?? 3112);

/** The only paths under public/ this server will hand out. See its use below. */
const FONT_FILES = new Set([
  '/fonts/NotoSans-Latin.woff2',
  '/fonts/NotoSans-Devanagari.woff2',
  '/fonts/JetBrainsMono-Latin.woff2',
]);

async function buildCss() {
  const out = path.join(outDir, 'preview.css');
  await run('npx', ['tailwindcss', '-i', 'src/app/globals.css', '-o', out, '--minify'], {
    cwd: root,
  });
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
      path.join(root, 'scripts/preview-simulator.tsx'),
      '--bundle',
      `--outfile=${out}`,
      '--format=iife',
      '--jsx=automatic',
      '--target=es2022',
      '--log-level=warning',
      '--define:process.env.NODE_ENV="production"',
      `--alias:@=${path.join(root, 'src')}`,
      `--alias:server-only=${path.join(root, 'src/tests/stubs/server-only.ts')}`,
    ],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );
  return out;
}

const page = () => `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Simulator — review harness</title>
<link rel="stylesheet" href="/preview.css" />
<style>
  /* The SAME local families the app loads (src/app/fonts.ts), served from
     public/fonts below, rather than fetched from Google — a review tool has no
     business needing the network to render the product's own typeface. */
  @font-face { font-family: 'Noto Sans'; src: url('/fonts/NotoSans-Latin.woff2') format('woff2'); font-display: swap; }
  @font-face { font-family: 'Noto Sans'; src: url('/fonts/NotoSans-Devanagari.woff2') format('woff2'); unicode-range: U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+A830-A839, U+A8E0-A8FF; font-display: swap; }
  @font-face { font-family: 'JetBrains Mono'; src: url('/fonts/JetBrainsMono-Latin.woff2') format('woff2'); font-display: swap; }
  :root { --font-sans: 'Noto Sans'; --font-mono: 'JetBrains Mono'; }
  html, body, #root { height: 100%; margin: 0; }
</style>
</head>
<body>
<div id="root"></div>
<script src="/preview.js"></script>
</body>
</html>`;

async function main() {
  if (!reportPath) {
    console.error(
      'usage: node scripts/serve-simulator-preview.mjs <report.json> [port]\n' +
        '  produce one with: pnpm --dir control-service sim:fleet --vehicles 1000 --out <dir>',
    );
    process.exit(2);
  }
  if (!existsSync(reportPath)) {
    console.error(`[preview] no such report: ${reportPath}`);
    process.exit(2);
  }

  await mkdir(outDir, { recursive: true });
  const [cssPath, jsPath] = await Promise.all([buildCss(), buildJs()]);
  const [css, js, report] = await Promise.all([
    readFile(cssPath, 'utf8'),
    readFile(jsPath, 'utf8'),
    readFile(reportPath, 'utf8'),
  ]);
  const html = page();

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
    if (url === '/report.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(report);
      return;
    }
    // The app's own font files. Exact-match against the known three rather
    // than joining the URL onto a directory: this server is a review tool, not
    // a static host, and `/fonts/../../.env.local` must not resolve to
    // anything.
    if (FONT_FILES.has(url)) {
      readFile(path.join(root, 'public', url.slice(1))).then(
        (bytes) => {
          response.writeHead(200, { 'content-type': 'font/woff2' });
          response.end(bytes);
        },
        () => {
          response.writeHead(404).end();
        },
      );
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
