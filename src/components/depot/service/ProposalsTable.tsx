'use client';

import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { Notice } from '@/components/depot/shell/Notice';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { useWidthTier } from '@/components/depot/shell/useWidthTier';
import { pageRange } from '@/lib/depot/listPaging';
import {
  PROPOSAL_COLUMN_WIDTHS,
  PROPOSAL_TIERS,
  proposalColumnKeys,
  proposalRow,
  type ProposalColumnKey,
  type ProposalRow,
} from '@/lib/depot/service/servicePageModel';
import { PROPOSAL_KIND_LABEL, SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import type { Proposal } from '@/lib/depot/service/types';

const TITLE_ID = 'service-proposals';
const W = PROPOSAL_COLUMN_WIDTHS;

const COLUMNS: Readonly<Record<ProposalColumnKey, Column<ProposalRow>>> = {
  band: { key: 'band', header: 'Hour band', width: W.band, render: (r) => r.band, sortValue: (r) => r.proposal.band.fromHour },
  change: { key: 'change', header: 'Change', width: W.change, render: (r) => r.change, title: (r) => r.changeTitle },
  deployed: { key: 'deployed', header: 'Deployed', align: 'right', width: W.deployed, render: (r) => r.deployed },
  scheduled: {
    key: 'scheduled',
    header: 'Scheduled',
    align: 'right',
    width: W.scheduled,
    render: (r) => r.scheduled,
    title: (r) => r.scheduledTitle,
  },
  needed: { key: 'needed', header: 'Needed', tag: 'modelled', align: 'right', width: W.needed, render: (r) => r.needed },
  source: { key: 'source', header: 'Source', width: W.source, render: (r) => r.source, title: (r) => r.sourceTitle },
  impact: {
    key: 'impact',
    header: 'Impact',
    unit: 'pax',
    tag: 'modelled',
    align: 'right',
    width: W.impact,
    render: (r) => r.impact,
    title: (r) => r.impactTitle,
  },
  restsOn: { key: 'restsOn', header: 'Rests on', width: W.restsOn, render: (r) => r.restsOn, title: (r) => r.restsOnTitle },
  reason: { key: 'reason', header: 'Reason', width: W.reason, render: (r) => r.reason, title: (r) => r.reason },
};

/** The expanded row: the full reason, the figures a narrow width drops, the impact ranges. */
function ProposalDetail({ row }: { readonly row: ProposalRow }) {
  const lines = [
    `${PROPOSAL_KIND_LABEL[row.proposal.kind]}, ${row.band}.`,
    `Deployed ${row.deployed}, scheduled ${row.scheduled}, needed ${row.needed}.`,
    row.sourceTitle,
    row.restsOnTitle,
    ...(row.maybeCovered ? [SERVICE_TEXT.maybeCovered] : []),
  ];
  return (
    <div className="space-y-1 py-2" data-testid="proposal-detail">
      <p className="depot-prose">{row.reason}</p>
      {lines.map((line) => (
        <p key={line} className="depot-note">{line}</p>
      ))}
      {row.impactLines.length > 0 ? (
        <ul className="depot-note" aria-label="Modelled impact ranges">
          {row.impactLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="depot-note">{SERVICE_TEXT.noImpact}</p>
      )}
    </div>
  );
}

/** The route's proposals: the recommendation notice, the table at this width, the pager. */
export function ProposalsTable({ proposals }: { readonly proposals: readonly Proposal[] }) {
  const tier = useWidthTier(PROPOSAL_TIERS);
  const [page, setPage] = useState(0);
  const rows = useMemo(() => proposals.map(proposalRow), [proposals]);
  const columns = useMemo(() => proposalColumnKeys(tier).map((key) => COLUMNS[key]), [tier]);
  const range = pageRange(page, rows.length);
  return (
    <section aria-labelledby={TITLE_ID} className="min-w-0" data-testid="service-proposals">
      <SectionLabel id={TITLE_ID} label={SERVICE_TEXT.proposalsTitle} />
      <div className="mb-3">
        <Notice status="info" word="Recommendation only">
          {`${SERVICE_TEXT.recommendation} ${SERVICE_TEXT.demand}`}
        </Notice>
      </div>
      {rows.length === 0 ? (
        <StatePanel kind="empty" compact tone="ok" sentence={SERVICE_TEXT.noProposals} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows.slice(range.start, range.end)}
            rowKey={(r) => r.id}
            rowLabel={(r) => `${r.band} ${r.change}`}
            caption={SERVICE_TEXT.proposalsCaption}
            fixedRows
            renderExpanded={(r) => <ProposalDetail row={r} />}
            multipleExpanded
          />
          <Pager page={range.page} total={rows.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}
