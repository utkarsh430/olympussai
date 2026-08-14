/**
 * The fleet layer's frame cost and colour-blind separation, measured in a real
 * browser against the code that actually ships.
 *
 * ─── WHY A SCRIPT AND NOT A TEST ─────────────────────────────────────────
 *
 * src/tests/unit/fleetCanvasLayer.test.ts times the JavaScript half of a frame
 * against a recording stub — useful as a regression tripwire, useless as a
 * frame time, because it never parses a path or shades a pixel. The figures in
 * fleetCanvasLayer.ts's header are real-browser figures, and this is what
 * produces them. It needs Chromium and takes a few seconds, so it runs on
 * demand rather than in CI:
 *
 *     pnpm bench:fleet-map
 *
 * It reports two things, both of which the redundant-encoding change had to be
 * accountable for:
 *
 *   1. FRAME COST, before and after, at the real statewide fleet size, with
 *      every frame forced to completion. "Before" is the previous renderer —
 *      one fill per quality colour, no shape, no casing — rebuilt from the
 *      same geometry helper so the delta is the encoding change alone.
 *
 *   2. COLOUR-BLIND SEPARATION of the RENDERED MARKS, which is the number that
 *      actually matters and the one a palette audit cannot produce. Comparing
 *      three hex strings measures the palette; comparing rendered marks
 *      measures what the operator sees, which now differs by shape and casing
 *      as well as by hue.
 *
 * The in-page half lives in ./fleetCanvasBench.browser.ts and is bundled with
 * the real fleet layer, so what is timed is what ships.
 */
import { chromium } from '@playwright/test';
import { build, type Rollup } from 'vite';
import { join } from 'node:path';

import type { BenchOptions, BenchReport } from './fleetCanvasBench.browser';

const ROOT = join(import.meta.dirname, '..');

const OPTIONS: BenchOptions = {
  /** The real statewide count, with nothing culled. */
  vehicles: 9170,
  frames: 60,
  /** A 1920-wide wall display at the device pixel ratio the layer caps at. */
  width: 2800,
  height: 1800,
};

/**
 * Bundle the in-page half with the real fleet layer.
 *
 * Through Vite rather than esbuild directly, so this needs no dependency the
 * app does not already have — and so the module resolves `@/` exactly as the
 * app does.
 */
async function bundleBrowserHalf(): Promise<string> {
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@': join(ROOT, 'src') } },
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry: join(ROOT, 'scripts/fleetCanvasBench.browser.ts'),
        formats: ['iife'],
        name: 'Bench',
        fileName: () => 'bench.js',
      },
    },
  })) as Rollup.RollupOutput[];

  const chunk = result[0]?.output?.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('vite produced no chunk');
  return chunk.code;
}

async function main(): Promise<void> {
  const bundle = await bundleBrowserHalf();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    await page.addScriptTag({ content: bundle });

    // A bare arrow with no named declarations, so the loader's `keepNames`
    // helper is never referenced inside the page.
    const report = (await page.evaluate(
      (options) => (window as unknown as { Bench: { run: (o: BenchOptions) => BenchReport } }).Bench.run(options),
      OPTIONS,
    )) as BenchReport;

    const { cost, cvd } = report;

    console.log(
      `\nFRAME COST — ${OPTIONS.vehicles} marks, nothing culled, ` +
        `${OPTIONS.width}x${OPTIONS.height}, median of ${OPTIONS.frames}`,
    );
    console.log('  (each frame forced to completion with a 1px readback)\n');
    console.log(
      `  dark    before ${cost.beforeDark?.toFixed(2)} ms    after ${cost.afterDark?.toFixed(2)} ms`,
    );
    console.log(
      `  light   before ${cost.beforeLight?.toFixed(2)} ms    after ${cost.afterLight?.toFixed(2)} ms`,
    );

    if (report.breakdown) {
      console.log('\nPHASE BREAKDOWN (median ms/frame, each forced to completion)\n');
      for (const [phase, value] of Object.entries(report.breakdown)) {
        console.log(`  ${phase.padEnd(40)} ${value.toFixed(2)} ms`);
      }
    }

    console.log('\nCOLOUR-BLIND SEPARATION — linear-RGB distance after Viénot (1999) simulation');
    console.log("  'fill-only' is the palette audit's metric — the fill colour alone.");
    console.log("  'rendered' is the mark as actually drawn, over the WORST of road/land/water.\n");
    for (const theme of Object.keys(cvd)) {
      for (const kind of Object.keys(cvd[theme] ?? {})) {
        console.log(`  ${theme} / ${kind}`);
        for (const [pair, value] of Object.entries(cvd[theme]?.[kind] ?? {})) {
          console.log(`    ${pair.padEnd(28)} ${value.toFixed(3)}`);
        }
      }
    }
    console.log('');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
