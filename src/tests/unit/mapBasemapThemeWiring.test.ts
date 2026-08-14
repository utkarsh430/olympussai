// The wiring defect that three separate lanes shipped, as a structural rule.
//
// The Google basemap is a JavaScript style array handed to the Maps
// constructor. No class, token or `prefers-color-scheme` rule reaches it, so
// `OpsFleetMap` takes the basemap as an OPT-IN prop defaulting to dark — a
// deliberate choice, so that one console moving does not move the others.
//
// The cost of that choice is that a surface which simply never passes the prop
// is INDISTINGUISHABLE, in every render test of the map itself, from one that
// passes 'dark' on purpose. And it looks correct on every night-shift
// screenshot. That is exactly how the control room shipped a light console
// over a black basemap on the largest map in the product, after two lanes had
// already flagged it and neither had fixed it, and how the rehearsal map
// shipped the same way unnoticed.
//
// A behavioural test per console cannot close this: it only covers the
// consoles somebody remembered to write one for, and the failure mode IS
// forgetting. So the rule is asserted over the source instead — every surface
// that renders a fleet map must both PASS `basemapTheme` and SUBSCRIBE to the
// resolved theme, and a sixth surface added tomorrow fails here rather than
// silently rendering a black rectangle under a light console.
//
// The behavioural counterpart — that the prop carries the operator's actual
// theme and follows it when they change it — lives in opsFleetMapTheme.test.tsx.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** The map components whose callers must opt in. */
const MAP_COMPONENTS = ['OpsFleetMap', 'OpsFleetMapPanel'];

/**
 * The one legitimate exception, and why.
 *
 * `OpsFleetMapPanel` is a passthrough: it takes `basemapTheme` from its own
 * caller and forwards it to `OpsFleetMap`. It deliberately does NOT call
 * `useTheme()` itself, because it is shared between the depot and the control
 * room and subscribing inside it would make one console's theme a side effect
 * of the other's. It still has to FORWARD the prop, which is checked below
 * like everything else; it is only excused from subscribing.
 */
const PASSTHROUGH = join('components', 'ops', 'map', 'OpsFleetMapPanel.tsx');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // The suite's own fixtures mock these components; they are not surfaces.
      return entry.name === 'tests' ? [] : tsxFiles(full);
    }
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * The text of a JSX opening tag starting at `start`, brace-aware so that
 * `>` inside a prop expression (an arrow function, a nested element, a JSX
 * comment) does not end the tag early.
 */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated JSX tag at offset ${start}`);
}

interface Usage {
  file: string;
  component: string;
  tag: string;
  source: string;
}

function mapUsages(): Usage[] {
  const found: Usage[] = [];
  for (const file of tsxFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const component of MAP_COMPONENTS) {
      // `<OpsFleetMap` must not also match `<OpsFleetMapPanel`.
      const pattern = new RegExp(`<${component}(?![A-Za-z0-9_])`, 'g');
      for (const match of source.matchAll(pattern)) {
        found.push({
          file: relative(process.cwd(), file),
          component,
          tag: openingTag(source, match.index),
          source,
        });
      }
    }
  }
  return found;
}

describe('every fleet-map surface opts into the basemap theme', () => {
  const usages = mapUsages();

  it('finds the map surfaces at all', () => {
    // Guards the guard: a rename that made the scan match nothing would
    // otherwise turn every assertion below into a vacuous pass.
    expect(usages.length).toBeGreaterThanOrEqual(4);
  });

  it('passes basemapTheme at every render site', () => {
    const missing = usages
      .filter((usage) => !/\bbasemapTheme\s*=/.test(usage.tag))
      .map((usage) => `${usage.file} <${usage.component}>`);

    expect(
      missing,
      'These surfaces render a fleet map without passing `basemapTheme`, so they ' +
        'silently take OpsFleetMap’s dark default — a light console over a black ' +
        'basemap. Read the resolved theme with useTheme() and pass it down.',
    ).toEqual([]);
  });

  it('subscribes to the resolved theme rather than hard-coding one', () => {
    // A literal `basemapTheme="dark"` would satisfy the check above while
    // reintroducing exactly the defect. The prop has to come from the theme.
    const notSubscribed = usages
      .filter((usage) => !usage.file.endsWith(PASSTHROUGH))
      .filter((usage) => !/useTheme\s*\(/.test(usage.source))
      .map((usage) => `${usage.file} <${usage.component}>`);

    expect(
      notSubscribed,
      'These surfaces pass `basemapTheme` without ever calling useTheme(), so the ' +
        'basemap cannot follow the operator when they change theme.',
    ).toEqual([]);
  });
});
