'use client';

import { Fragment, useState } from 'react';
import { formatCount, formatPercent } from '@/lib/depot/format';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { Recommendation } from '@/lib/depot/redistribution/types';
import { clock, coveragePoints, FEASIBILITY_LABEL, FEASIBILITY_WORDS } from '@/lib/depot/redistribution/wording';
import { FEASIBILITY_CLASS, proposalNumber } from './RecommendationCard';

export interface RecommendationsTableProps {
  readonly rows: readonly Recommendation[];
  readonly model: EngineModel;
  readonly selectedId: string | null;
  readonly onToggle: (id: string) => void;
  readonly onPreview: (id: string) => void;
}

const HEADERS = ['#', 'Source', 'Destination', 'Buses', 'Departure', 'Gap Addressed', 'Impact', 'Feasibility', 'Actions'] as const;

/** The proposals as a compact operational table, each row expandable to its reason and actions. */
export function RecommendationsTable({ rows, model, selectedId, onToggle, onPreview }: RecommendationsTableProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="depot-table-frame overflow-x-auto">
      <table className="depot-table w-full min-w-[860px]" data-testid="recommendations-table">
        <caption className="sr-only">Proposed transfers for this window</caption>
        <thead>
          <tr>
            {HEADERS.map((h) => (
              <th key={h} scope="col" className={h === 'Buses' || h === 'Gap Addressed' ? 'text-right' : 'text-left'}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const included = model.includedIds.has(r.id);
            const open = openId === r.id;
            return (
              <Fragment key={r.id}>
                <tr className={`${selectedId === r.id ? 'depot-row-selected' : ''} ${included ? '' : 'opacity-55'}`} data-included={included}>
                  <td className="font-mono text-[11px] text-depot-muted">{proposalNumber(r)}</td>
                  <td className="font-mono text-[11px] text-alert-amber">{r.fromRouteId}</td>
                  <td className="font-mono text-[11px] text-holo-teal">{r.toRouteId}</td>
                  <td className="text-right font-mono tabular-nums">{formatCount(r.buses)}</td>
                  <td className="font-mono text-[11px] tabular-nums">{`${clock(r.repositionStartMin)} (~${r.repositionMin} min)`}</td>
                  <td className="text-right font-mono text-[11px] tabular-nums">{`${formatCount(r.gapBusHours)} bus-h`}</td>
                  <td className="font-mono text-[11px] tabular-nums text-alert-green">{`${coveragePoints(r.coverageBefore, r.coverageAfter)} · ~${formatCount(r.passengersServed)} pax`}</td>
                  <td>
                    <span className={`depot-tag ${FEASIBILITY_CLASS[r.feasibility]}`} title={FEASIBILITY_WORDS[r.feasibility]}>
                      {FEASIBILITY_LABEL[r.feasibility].replace(' feasibility', '')}
                    </span>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className="depot-filter-button" aria-expanded={open} onClick={() => setOpenId(open ? null : r.id)}>
                        Details
                      </button>
                      <button type="button" className="depot-filter-button" onClick={() => onPreview(r.id)}>
                        Preview
                      </button>
                      <button type="button" className={`depot-filter-button ${included ? '' : 'border-depot-line text-depot-muted'}`} aria-pressed={included} onClick={() => onToggle(r.id)}>
                        {included ? 'Included' : 'Excluded'}
                      </button>
                    </div>
                  </td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={HEADERS.length} className="!h-auto whitespace-normal py-3">
                      <p className="depot-prose">{r.reason}</p>
                      <p className="depot-note mt-1">{`Destination coverage over the target window ${formatPercent(r.coverageBefore)} before, ${formatPercent(r.coverageAfter)} after. ${FEASIBILITY_WORDS[r.feasibility]}`}</p>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
