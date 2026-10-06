import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/*
 * Shared helpers for the depot source guards. They parse with the TypeScript
 * compiler rather than matching text, so comments are never seen (the parser
 * drops them) and a string is told apart from code by its node kind.
 */

export const ROOT = process.cwd();

/** Every file under `dir` (relative to the repository root) whose name passes `keep`. */
export function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  const walk = (abs: string): string[] =>
    readdirSync(abs).flatMap((name) => {
      const path = join(abs, name);
      if (statSync(path).isDirectory()) return walk(path);
      return keep(name) ? [relative(ROOT, path)] : [];
    });
  return walk(join(ROOT, dir)).sort();
}

export const isTsSource = (name: string): boolean =>
  /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);

/** Parses source text; `name` decides whether JSX is understood. */
export function parseSource(name: string, text: string): ts.SourceFile {
  const kind = name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
}

export const parseFile = (path: string): ts.SourceFile =>
  parseSource(path, readFileSync(join(ROOT, path), 'utf8'));

function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
}

export interface Finding {
  readonly what: string;
  readonly line: number;
}

const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const isCallOf = (node: ts.CallExpression, object: string, member: string): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === object &&
  node.expression.name.text === member;

/**
 * Every read of the wall clock or of an unseeded random source: `Date.now()`,
 * `performance.now()`, `Math.random()`, `new Date()` with no argument, and
 * `Date()` called as a function (which also reads the clock).
 */
export function wallClockReads(sf: ts.SourceFile): Finding[] {
  const found: Finding[] = [];
  visit(sf, (node) => {
    const at = (what: string): void => {
      found.push({ what, line: lineOf(sf, node) });
    };
    if (ts.isCallExpression(node)) {
      if (isCallOf(node, 'Date', 'now')) at('Date.now()');
      else if (isCallOf(node, 'performance', 'now')) at('performance.now()');
      else if (isCallOf(node, 'Math', 'random')) at('Math.random()');
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'Date') at('Date()');
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date' &&
      (node.arguments === undefined || node.arguments.length === 0)
    ) {
      at('new Date()');
    }
  });
  return found;
}

/**
 * Every piece of text the code carries: string literals, template literal
 * parts and JSX text (attribute values such as `title` and `aria-label` are
 * string literals or templates, so they are included). Comments are not nodes,
 * so they never appear here. Object property names written as bare words are
 * identifiers, not text, and are not included either.
 */
export function textPieces(sf: ts.SourceFile): Finding[] {
  const found: Finding[] = [];
  visit(sf, (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push({ what: node.text, line: lineOf(sf, node) });
    }
  });
  return found;
}
