/**
 * The React Server Component import boundary, as a check a machine can run.
 *
 * ─── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────
 *
 * src/app/(ops)/ops/control-room/page.tsx is a Server Component. It imported
 * `isConsoleTab` from ControlRoomConsole.tsx, which carries 'use client'.
 * Across that boundary the import is not the function — it is a client
 * reference proxy — so the first call threw and the page was a hard HTTP 500
 * on 100% of requests, in `next dev` and `next start` alike:
 *
 *     Attempted to call isConsoleTab() from the server but isConsoleTab is
 *     on the client.
 *
 * Every gate this repo had was green while that page was completely dead:
 *
 *   • `tsc --noEmit`  at type level the export IS a real function. TypeScript
 *                     does not model the RSC boundary at all.
 *   • `next lint`     no rule covers it.
 *   • `next build`    the page is `force-dynamic`, so it is never rendered at
 *                     build time and the throw never happens.
 *   • `pnpm test`     vitest/jsdom has no server/client boundary either; the
 *                     import is just an import.
 *
 * The only thing that caught it was opening the page in a browser. That is
 * far too slow and skippable a feedback loop for a mistake this easy to make,
 * hence this module: a parse-only scan of the tree, no build, no browser.
 *
 * ─── THE RULE ────────────────────────────────────────────────────────────
 *
 * A module WITHOUT 'use client' must not import a lowercase-initial VALUE
 * from a module WITH it.
 *
 *   • Lowercase-initial, because that is what separates a plain function or
 *     constant (which becomes an uncallable proxy) from a component (which is
 *     exactly what a client reference is FOR — handing a client component to a
 *     server tree is the normal, correct pattern, and this repo does it in
 *     dozens of places).
 *   • Value, not type. `import type { ConsoleTabId }` is erased before
 *     anything runs and crosses nothing.
 *
 * A shared value a server module needs belongs in a plain sibling module with
 * no directive, imported by both sides — see
 * src/components/ops/control-room/console/consoleTabs.ts for the shape.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface ClientBoundaryViolation {
  /** Path of the offending server module, relative to the repo root. */
  file: string;
  line: number;
  column: number;
  /** The name as exported by the client module. */
  imported: string;
  /** The name the server module binds it to. */
  local: string;
  /** Path of the client module, relative to the repo root. */
  target: string;
}

/** Where the scan looks by default. */
const DEFAULT_INCLUDE = ['src'];

/**
 * Skipped while walking. `tests` covers src/tests: vitest has no RSC
 * boundary, so a test importing a client helper is not a defect — and the
 * scanner's own fixtures live there.
 */
const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'tests']);

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/** Suffixes tried, in order, when resolving an extensionless specifier. */
const RESOLUTION_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
];

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      listSourceFiles(full, out);
      continue;
    }
    if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * Whether this module carries the 'use client' directive.
 *
 * Read from the parsed statement list rather than from line one, so a licence
 * header or a doc comment above the directive cannot hide it.
 */
function isClientModule(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) break;
    const expression = statement.expression;
    if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) break;
    if (expression.text === 'use client') return true;
  }
  return false;
}

/** Resolve a relative or `@/`-aliased specifier to a file on disk. Null for a package import, which is out of scope. */
function resolveSpecifier(specifier: string, fromFile: string, srcDir: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(srcDir, specifier.slice(2));
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else return null;

  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = base + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface Binding {
  local: string;
  imported: string;
}

/**
 * Every binding a declaration pulls in as a VALUE, with the local name the
 * importing module will use. Type-only clauses and type-only specifiers are
 * skipped: they are erased before anything runs.
 */
function valueBindings(node: ts.ImportDeclaration | ts.ExportDeclaration): Binding[] {
  const bindings: Binding[] = [];

  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    // `import './side-effect'` binds nothing; `import type {…}` binds nothing at runtime.
    if (clause === undefined || clause.isTypeOnly) return bindings;
    if (clause.name !== undefined) bindings.push({ local: clause.name.text, imported: 'default' });
    const named = clause.namedBindings;
    if (named !== undefined) {
      if (ts.isNamespaceImport(named)) bindings.push({ local: named.name.text, imported: '*' });
      else {
        for (const element of named.elements) {
          if (element.isTypeOnly) continue;
          bindings.push({ local: element.name.text, imported: (element.propertyName ?? element.name).text });
        }
      }
    }
    return bindings;
  }

  // `export { x } from './client'` republishes the same proxy under this
  // module's own name, so a server module doing it is the same defect one hop
  // further out.
  if (node.moduleSpecifier === undefined || node.isTypeOnly) return bindings;
  const clause = node.exportClause;
  // `export * from` and `export * as ns from` bind no judgeable name here.
  if (clause === undefined || ts.isNamespaceExport(clause)) return bindings;
  for (const element of clause.elements) {
    if (element.isTypeOnly) continue;
    bindings.push({ local: element.name.text, imported: (element.propertyName ?? element.name).text });
  }
  return bindings;
}

/** A binding whose name starts lowercase is a plain value, not a component. Components are the legitimate reason to cross this boundary. */
function isLowercaseInitial(name: string): boolean {
  const first = name.slice(0, 1);
  return first !== '' && first === first.toLowerCase() && first !== first.toUpperCase();
}

/**
 * Scan the tree and return every server→client value import, sorted so the
 * output is stable. Paths are relative to `rootDir` for the same reason.
 *
 * `include` exists for the scanner's own tests, which point it at a fixture
 * directory; production callers use the default.
 */
export function findClientBoundaryViolations(
  rootDir: string,
  include: readonly string[] = DEFAULT_INCLUDE,
): ClientBoundaryViolation[] {
  const srcDir = path.join(rootDir, 'src');
  const files = include.flatMap((dir) => {
    const full = path.join(rootDir, dir);
    return fs.existsSync(full) ? listSourceFiles(full) : [];
  });

  const parsed = new Map<string, ts.SourceFile>();
  for (const file of files) parsed.set(file, parse(file, fs.readFileSync(file, 'utf8')));

  const clientCache = new Map<string, boolean>();
  const isClient = (file: string): boolean => {
    const cached = clientCache.get(file);
    if (cached !== undefined) return cached;
    // An import target can sit outside the scanned set (an excluded directory,
    // say). Read it rather than assuming it is safe.
    const sourceFile = parsed.get(file) ?? parse(file, fs.readFileSync(file, 'utf8'));
    const result = isClientModule(sourceFile);
    clientCache.set(file, result);
    return result;
  };

  const violations: ClientBoundaryViolation[] = [];

  for (const [file, sourceFile] of parsed) {
    if (isClientModule(sourceFile)) continue;

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifierNode = statement.moduleSpecifier;
      if (specifierNode === undefined || !ts.isStringLiteral(specifierNode)) continue;

      const target = resolveSpecifier(specifierNode.text, file, srcDir);
      if (target === null || !isClient(target)) continue;

      for (const binding of valueBindings(statement)) {
        if (!isLowercaseInitial(binding.local)) continue;
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
        violations.push({
          file: path.relative(rootDir, file),
          line: line + 1,
          column: character + 1,
          imported: binding.imported,
          local: binding.local,
          target: path.relative(rootDir, target),
        });
      }
    }
  }

  violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.local.localeCompare(b.local),
  );
  return violations;
}

/** One violation, as a line an engineer can act on without opening this file. */
export function formatViolation(violation: ClientBoundaryViolation): string {
  return `${violation.file}:${violation.line}:${violation.column}  imports value \`${violation.imported}\` from client module ${violation.target}`;
}
