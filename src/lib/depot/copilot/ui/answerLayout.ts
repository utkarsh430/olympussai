import type { Provenance } from '@/lib/depot/types';
import type {
  CopilotAnswerScope,
  CopilotAnswerTable,
  CopilotFactView,
} from '@/lib/depot/copilot/wire';

/**
 * The ask page's pure view of one answer: the scope chip the ANSWER used, and the evidence
 * table with units in the headers, bare right-aligned numbers and a MODELLED tag on a
 * column whose figures are generated. Pure; the components render what this returns.
 */

/** "Whole network", the depot's name, or both names for a comparison; the form's label otherwise. */
export function answerScopeLabel(scope: CopilotAnswerScope | undefined, formLabel: string): string {
  if (!scope) return formLabel;
  if (scope.kind === 'network') return 'Whole network';
  if (scope.kind === 'depot') return scope.depotName;
  return scope.depots.length === 0 ? formLabel : scope.depots.map((d) => d.depotName).join(' and ');
}

export interface AnswerColumnView {
  readonly header: string;
  /** Shown after the header ("Short by" + "buses"); the cells then carry bare numbers. */
  readonly unit: string | null;
  readonly align: 'left' | 'right';
  /** MODELLED when a figure in the column rests on a generated fact. */
  readonly tag: Provenance | null;
}

export interface AnswerTableView {
  readonly columns: readonly AnswerColumnView[];
  readonly rows: readonly (readonly string[])[];
}

/** "9 buses" → ["9", "buses"]; "37.2" → ["37.2", null]; text → null. */
const NUMBER_CELL = /^(-?[\d,]+(?:\.\d+)?%?)(?:\s+(\S.*))?$/;
/** One unit word whatever the count: "1 bus" and "9 buses" share the header "buses". */
const PLURAL: Readonly<Record<string, string>> = { bus: 'buses', depot: 'depots' };

function splitCell(cell: string): { readonly figure: string; readonly unit: string | null } | null {
  const match = NUMBER_CELL.exec(cell.trim());
  if (!match || match[1] === undefined) return null;
  const unit = match[2] ?? null;
  return { figure: match[1], unit: unit === null ? null : (PLURAL[unit] ?? unit) };
}

/**
 * A column's provenance from the facts behind its cells: the fact of row n has an id
 * `<list>.<n>.<field>` and the cell's text. Any generated fact makes the column MODELLED.
 */
function columnTag(
  table: CopilotAnswerTable,
  column: number,
  facts: readonly CopilotFactView[],
): Provenance | null {
  const modelled = table.rows.some((row, index) => {
    const cell = row[column];
    const rowPart = `.${index + 1}.`;
    return facts.some(
      (f) => f.provenance === 'modelled' && f.id.includes(rowPart) && f.text === cell,
    );
  });
  return modelled ? 'modelled' : null;
}

export function answerTableView(
  table: CopilotAnswerTable,
  facts: readonly CopilotFactView[],
): AnswerTableView {
  const split = table.columns.map((_, c) => table.rows.map((row) => splitCell(row[c] ?? '')));
  const columns = table.columns.map((header, c): AnswerColumnView => {
    const cells = split[c] ?? [];
    const numeric = cells.length > 0 && cells.every((cell) => cell !== null);
    const units = new Set(cells.map((cell) => cell?.unit ?? null));
    const unit = numeric && units.size === 1 ? ([...units][0] ?? null) : null;
    return { header, unit, align: numeric ? 'right' : 'left', tag: columnTag(table, c, facts) };
  });
  const rows = table.rows.map((row, r) =>
    row.map((cell, c) => {
      const column = columns[c];
      const parts = split[c]?.[r];
      return column && column.unit !== null && parts ? parts.figure : cell;
    }),
  );
  return { columns, rows };
}
