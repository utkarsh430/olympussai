import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Prose is never in the mono face (design critique round 4, pattern 1). The shell's
 * inherited face is mono, which is right for data, so any sentence a page forgets to
 * class comes out mono and the page reads like a log. Every `<p>` under
 * `src/components/depot/**` must therefore carry a class that sets the sans face.
 *
 * Allowed classes:
 * - `depot-prose`   sans 14/20, body sentences
 * - `depot-note`    sans 13/18, muted: notes, captions, state-panel second lines, legends
 * - `depot-caption` sans 12/16, muted: a band figure's caption
 * - `sr-only`       never seen, so its face does not matter
 * - `font-sans`     the Tailwind utility that sets the sans face directly
 */
const ALLOWED = ['depot-prose', 'depot-note', 'depot-caption', 'sr-only', 'font-sans'] as const;

/**
 * The ratchet: files that still have a `<p>` without a sans class. A page agent removes
 * its files from this list as it converts them; the list must end empty. The test also
 * fails when a listed file no longer needs to be here, so the list only ever shrinks.
 * The four shell entries are chrome (nav, scope switcher, stale strip), converted by the
 * chrome's owner, not by a page.
 */
const EXEMPT: readonly string[] = [
  'src/components/depot/cockpit/AvailabilityBar.tsx',
  'src/components/depot/cockpit/CockpitMethod.tsx',
  'src/components/depot/cockpit/DepotCockpit.tsx',
  'src/components/depot/cockpit/DepotExceptions.tsx',
  'src/components/depot/copilot/AnswerView.tsx',
  'src/components/depot/copilot/AskPanel.tsx',
  'src/components/depot/copilot/BriefingCard.tsx',
  'src/components/depot/copilot/CopilotFooter.tsx',
  'src/components/depot/copilot/RationaleButton.tsx',
  'src/components/depot/crew/AvailabilityHero.tsx',
  'src/components/depot/duties/DutyBoard.tsx',
  'src/components/depot/duties/DutyPage.tsx',
  'src/components/depot/duties/DutyTable.tsx',
  'src/components/depot/economics/EconomicsBreakdown.tsx',
  'src/components/depot/exceptions/BusExceptionSection.tsx',
  'src/components/depot/exceptions/ExceptionCentre.tsx',
  'src/components/depot/maintenance/FiguresDisclosure.tsx',
  'src/components/depot/network/DepotMap.tsx',
  'src/components/depot/network/DepotMapLegend.tsx',
  'src/components/depot/network/DepotMapPanel.tsx',
  'src/components/depot/network/DepotTable.tsx',
  'src/components/depot/network/ExceptionSummary.tsx',
  'src/components/depot/network/KpiBand.tsx',
  'src/components/depot/rebalance/DepotValueField.tsx',
  'src/components/depot/rebalance/MapHoverCard.tsx',
  'src/components/depot/rebalance/NumberField.tsx',
  'src/components/depot/rebalance/PageIntro.tsx',
  'src/components/depot/rebalance/RebalanceMethod.tsx',
  'src/components/depot/rebalance/RebalancePage.tsx',
  'src/components/depot/rebalance/ScenarioPanel.tsx',
  'src/components/depot/rebalance/TransferMap.tsx',
  'src/components/depot/rebalance/TransferMapLegend.tsx',
  'src/components/depot/rebalance/TransferRowView.tsx',
  'src/components/depot/revenue/HowProduced.tsx',
  'src/components/depot/roster/BusTimetable.tsx',
  'src/components/depot/roster/RosterFilters.tsx',
  'src/components/depot/routes/ProfileLoader.tsx',
  'src/components/depot/routes/RoutesMethod.tsx',
  'src/components/depot/sources/SourcesRegistry.tsx',
  'src/components/depot/trends/DepotTrends.tsx',
  'src/components/depot/trends/NetworkTrends.tsx',
  'src/components/depot/yard/ParkingPlan.tsx',
  'src/components/depot/yard/ParkingPlanSection.tsx',
  'src/components/depot/yard/YardMap.tsx',
  'src/components/depot/yard/YardPage.tsx',
  'src/components/depot/yard/YardRoll.tsx',
];

/** Chrome files in the shell that may sit on the list: none since the chrome was converted. */
const CHROME = new Set<string>();

const ROOT = join(process.cwd(), 'src', 'components', 'depot');
const ALLOWED_PATTERN = new RegExp(`(^|[\\s'"\`{])(${ALLOWED.join('|')})(?=[\\s'"\`}]|$)`);

function tsxFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return name.endsWith('.tsx') ? [path] : [];
  });
}

/** Removes block comments and whole-line `//` comments, so prose in a doc comment is not read as markup. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The full text of every `<p …>` opening tag, walking braces and quotes so `=>` or `>` in an attribute does not end it. */
function paragraphTags(source: string): readonly string[] {
  const text = stripComments(source);
  const tags: string[] = [];
  const start = /<p(?=[\s>/])/g;
  for (let match = start.exec(text); match !== null; match = start.exec(text)) {
    let depth = 0;
    let quote: string | null = null;
    let index = match.index + 2;
    for (; index < text.length; index += 1) {
      const ch = text[index];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(text.slice(match.index, index + 1));
  }
  return tags;
}

/** True when the tag carries an allowed class token anywhere in its attributes. */
function isSansParagraph(tag: string): boolean {
  return ALLOWED_PATTERN.test(tag);
}

function failingFiles(): readonly string[] {
  return tsxFiles(ROOT)
    .filter((path) => paragraphTags(readFileSync(path, 'utf8')).some((tag) => !isSansParagraph(tag)))
    .map((path) => relative(process.cwd(), path))
    .sort();
}

describe('paragraph tag scanner', () => {
  it('finds a paragraph whose attribute holds an arrow function', () => {
    const tags = paragraphTags('<p onClick={() => go(a > b)} className="x">hi</p><pre>no</pre>');
    expect(tags).toEqual(['<p onClick={() => go(a > b)} className="x">']);
  });

  it('accepts an allowed class in any branch and rejects a mono-only paragraph', () => {
    expect(isSansParagraph(`<p className={a ? 'depot-note mt-1' : 'x'}>`)).toBe(true);
    expect(isSansParagraph('<p className="font-mono text-[13px]">')).toBe(false);
    expect(isSansParagraph('<p>')).toBe(false);
    expect(isSansParagraph('<p className="depot-noted">')).toBe(false);
  });

  it('ignores a paragraph written inside a comment', () => {
    expect(paragraphTags('/** a <p> in a doc comment */\n// <p> here too\n')).toEqual([]);
  });
});

describe('prose is never in the mono face', () => {
  const failing = failingFiles();

  it('every <p> outside the exemption list carries a sans class', () => {
    expect(failing.filter((file) => !EXEMPT.includes(file))).toEqual([]);
  });

  it('every exempt file still needs its exemption (the list only shrinks)', () => {
    expect(EXEMPT.filter((file) => !failing.includes(file))).toEqual([]);
  });

  it('the exemption list is sorted and covers no shared content piece', () => {
    expect([...EXEMPT].sort()).toEqual(EXEMPT);
    const shell = EXEMPT.filter((file) => file.includes('/depot/shell/'));
    expect(shell.filter((file) => !CHROME.has(file))).toEqual([]);
  });
});
