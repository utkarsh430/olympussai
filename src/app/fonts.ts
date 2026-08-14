/**
 * The product's two typefaces, self-hosted.
 *
 * ─── WHY SELF-HOSTED RATHER THAN `next/font/google` ──────────────────────
 *
 * `next/font/google` fetches the font binary from Google at BUILD time and
 * inlines it. That is a network call on the critical path of every build,
 * and this repo has already had a build fail on it once. Three `.woff2`
 * files in `public/fonts/` (176 KB total) remove that dependency entirely:
 * the build now has no font-related network call at all, and the bytes that
 * ship are the exact bytes in the repository.
 *
 * Committing binaries is a repo convention change and is deliberate. It is
 * called out here rather than slipped in.
 *
 * ─── WHY ONE FAMILY FOR BOTH SCRIPTS ─────────────────────────────────────
 *
 * Driver-facing copy is bilingual English/Hindi, so the body face has to
 * carry Devanagari. The naive way to do that is to pair a Latin face with a
 * separate Devanagari face — and that is the trap, because the two faces
 * almost never share vertical metrics. IBM Plex Sans is 1025/-275 against
 * IBM Plex Sans Devanagari's 1070/-460: an 18% taller line box the moment a
 * single Devanagari glyph appears mid-sentence, which is the "mismatched
 * face" failure this was supposed to avoid.
 *
 * Noto Sans avoids it because both subsets are cuts of ONE family. Measured
 * with fontTools against the exact `.woff2` files committed here:
 *
 *   NotoSans-Latin.woff2       hhea 1069 / -293, unitsPerEm 1000
 *   NotoSans-Devanagari.woff2  hhea 1069 / -293, unitsPerEm 1000
 *
 * Identical. One baseline, one line box, two scripts.
 *
 * Coverage, also measured rather than assumed:
 *   • 128/128 of U+0900-097F (the Devanagari block)
 *   • the full `dev2` shaping feature set — akhn, rphf, blwf, half, cjct,
 *     nukt, abvs, blws, psts — so conjuncts and matras actually compose
 *     instead of rendering as separate marks
 *   • ZWNJ, ZWJ, dotted circle and the rupee sign
 *   • all 44 distinct Devanagari codepoints used by the product's real Hindi
 *     strings, with none missing
 *
 * Both `src` entries below sit under ONE `next/font/local` call, so they
 * resolve to a single CSS family with two `unicode-range`s. A Hindi word
 * inside an English sentence changes glyphs and nothing else — no fallback,
 * no reflow, no metric jump.
 *
 * ─── WHY THE MONO STAYS ──────────────────────────────────────────────────
 *
 * Noto Sans carries a real `tnum` feature (verified), so tabular figures now
 * work on the body face. The old habit of switching to mono purely to stop
 * digits jittering on a poll is no longer needed — use `tabular-nums`.
 *
 * JetBrains Mono is kept for IDENTIFIERS: registration plates, corridor ids,
 * command references. Its zero has three contours against its capital O's
 * two — genuinely dotted — which matters when an operator reads a plate
 * aloud over a radio to a driver.
 *
 * `display: 'swap'` on both: an operations console must show its text on the
 * first paint. A blocking font is a blank readout.
 */
import localFont from 'next/font/local';

/**
 * The body face for the entire product. English and Hindi, one family.
 *
 * Exposed as `--font-sans`. Tailwind's `font-sans` resolves to it, which
 * makes it the default for all unstyled text.
 */
export const sans = localFont({
  src: [
    {
      path: '../../public/fonts/NotoSans-Latin.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: '../../public/fonts/NotoSans-Devanagari.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
  // Matched to Noto Sans's own metrics so the fallback face occupies the same
  // box while the webfont loads. Without this the first paint reflows.
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
  adjustFontFallback: false,
});

/**
 * Identifiers only — plates, corridor ids, command and audit references.
 * Not for numbers: the body face has `tnum`, so use `tabular-nums` there.
 */
export const mono = localFont({
  src: [
    {
      path: '../../public/fonts/JetBrainsMono-Latin.woff2',
      weight: '100 800',
      style: 'normal',
    },
  ],
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  adjustFontFallback: false,
});

/**
 * `--font-display` is kept as an ALIAS of the body face rather than removed.
 *
 * Orbitron used to fill it, and roughly a dozen surfaces still say
 * `font-display`. Pointing the variable at Noto Sans retires Orbitron
 * everywhere in one move, with no edit to any of those surfaces — and, more
 * to the point, Orbitron carries no Devanagari at all, so any bilingual
 * string that landed on a `font-display` element would have fallen back to
 * a mismatched system face.
 *
 * The alias is a migration aid, not a permanent second name. When the last
 * `font-display` is gone, delete it.
 */
export const fontVariables = `${sans.variable} ${mono.variable}`;
