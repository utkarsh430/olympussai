// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filesUnder, isTsSource, parseFile, parseSource, textPieces } from './depot-guard-source';

/*
 * The interface never says "simulated": the on-screen word is MODELLED. Every
 * piece of text in the depot's components, libraries and pages is checked:
 * string literals, template literal parts and JSX text, which covers every
 * `title`, `aria-label` and other attribute value as well. Comments are
 * excluded because the source is parsed with the TypeScript compiler and a
 * comment is not a node of the tree; a bare object key (`simulated: true`) is
 * an identifier, not text, and is not shown to anyone.
 */

const FOLDERS = [
  'src/components/depot',
  'src/lib/depot',
  'src/app/(protected)/project/depots',
] as const;
const BANNED = /simulated/i;

/** Real violations not yet fixed: file, and what is wrong. Each must be fixed and removed. */
const KNOWN_VIOLATIONS: Readonly<Record<string, string>> = {};

const offendersIn = (file: string): string[] =>
  textPieces(parseFile(file))
    .filter((piece) => BANNED.test(piece.what))
    .map((piece) => `${file}:${piece.line} ${JSON.stringify(piece.what)}`);

describe('no depot text says "simulated"', () => {
  const files = FOLDERS.flatMap((folder) => filesUnder(folder, isTsSource));

  it('scans the components, the libraries and the pages', () => {
    for (const folder of FOLDERS) {
      expect(files.filter((f) => f.startsWith(folder)).length).toBeGreaterThan(0);
    }
  });

  it('finds the word in no string, template or JSX text', () => {
    const offenders = files.filter((f) => !(f in KNOWN_VIOLATIONS)).flatMap(offendersIn);
    expect(offenders).toEqual([]);
  });

  it('keeps every known violation live, so the list can only shrink', () => {
    const fixed = Object.keys(KNOWN_VIOLATIONS).filter(
      (f) => !files.includes(f) || offendersIn(f).length === 0,
    );
    expect(fixed).toEqual([]);
  });

  it('catches the word in a string, a template, JSX text and an attribute, but not in a comment or a key', () => {
    const planted = parseSource(
      'planted.tsx',
      [
        "const a = 'Simulated fleet';",
        'const b = `${n} simulated buses`;',
        'const c = <p>SIMULATED</p>;',
        'const d = <span title="simulated" aria-label={`simulated ${n}`} />;',
        '// simulated, in a comment',
        '/* simulated */ const e = { simulated: true };',
      ].join('\n'),
    );
    const lines = textPieces(planted).filter((p) => BANNED.test(p.what)).map((p) => p.line);
    expect(lines).toEqual([1, 2, 3, 4, 4]);
  });
});
