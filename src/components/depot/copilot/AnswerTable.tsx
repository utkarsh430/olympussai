import type { CopilotAnswerTable } from '@/lib/depot/copilot/wire';

export interface AnswerTableProps {
  readonly table: CopilotAnswerTable;
  /** Names the table for assistive technology and sighted readers alike. */
  readonly caption: string;
}

/** The rows behind an answer: a real table, every cell display text. */
export function AnswerTable({ table, caption }: AnswerTableProps) {
  if (table.columns.length === 0 || table.rows.length === 0) {
    return (
      <p className="depot-prose" data-testid="copilot-table-empty">
        No rows matched.
      </p>
    );
  }
  return (
    <div className="depot-table-frame" data-testid="copilot-table">
      <table className="depot-table w-full">
        <caption className="depot-label px-3 py-2 text-left">{caption}</caption>
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={index} scope="col" className="text-left">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="tabular-nums">
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
