import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { answerTableView } from '@/lib/depot/copilot/ui/answerLayout';
import type { CopilotAnswerTable, CopilotFactView } from '@/lib/depot/copilot/wire';

export interface AnswerTableProps {
  readonly table: CopilotAnswerTable;
  /** The facts behind the answer: a column resting on a generated fact is tagged MODELLED. */
  readonly facts: readonly CopilotFactView[];
  /** Names the table for assistive technology; not drawn, because the answer's heading already says it. */
  readonly caption: string;
}

/**
 * The rows behind an answer: a real table, every cell display text. Units sit in the
 * header ("SHORT BY BUSES"), numbers are bare and right-aligned, and a column whose
 * figures are generated carries the MODELLED pill in its header cell (S51, guard X8).
 */
export function AnswerTable({ table, facts, caption }: AnswerTableProps) {
  if (table.columns.length === 0 || table.rows.length === 0) {
    return (
      <p className="depot-prose" data-testid="copilot-table-empty">
        No rows matched.
      </p>
    );
  }
  const view = answerTableView(table, facts);
  return (
    <div className="depot-table-frame" data-testid="copilot-table">
      <table className="depot-table w-full">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {view.columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={column.align === 'right' ? 'text-right' : 'text-left'}
              >
                <span className="inline-flex items-center gap-2">
                  <span>
                    {column.header}
                    {column.unit === null ? null : (
                      <span className="ml-1 text-depot-faint">{column.unit}</span>
                    )}
                  </span>
                  {column.tag === null ? null : <ProvenanceBadge provenance={column.tag} pill />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`tabular-nums ${view.columns[cellIndex]?.align === 'right' ? 'text-right' : ''}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
