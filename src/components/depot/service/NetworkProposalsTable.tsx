'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { Notice } from '@/components/depot/shell/Notice';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { TableGrouping } from '@/components/depot/shell/tableGroups';
import { useWidthTier } from '@/components/depot/shell/useWidthTier';
import { depotHref } from '@/lib/depot/depotNav';
import { pageRange } from '@/lib/depot/listPaging';
import {
  NETWORK_PROPOSAL_COLUMN_WIDTHS as W,
  NETWORK_PROPOSAL_TIERS,
  networkProposalColumnKeys,
  type NetworkProposalColumnKey,
} from '@/lib/depot/service/networkProposalColumns';
import {
  NETWORK_GROUP_LABEL,
  networkProposalRow,
  orderNetworkProposals,
  type NetworkProposalRow,
} from '@/lib/depot/service/networkPageModel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import type { NetworkProposal } from '@/lib/depot/service/types';

const TITLE_ID = 'service-network-proposals';

const COLUMNS: Readonly<Record<NetworkProposalColumnKey, Column<NetworkProposalRow>>> = {
  // Not sortable: the rows come grouped, and a sort would split the groups.
  band: { key: 'band', header: 'Hour band', width: W.band, render: (r) => r.band },
  change: { key: 'change', header: 'Change', width: W.change, render: (r) => r.change, title: (r) => r.changeTitle },
  route: {
    key: 'route',
    header: 'Route',
    width: W.route,
    render: (r) => <span className="block max-w-[152px] truncate font-mono text-[11px]">{r.route}</span>,
    title: (r) => r.route,
  },
  depot: {
    key: 'depot',
    header: 'Depot',
    width: W.depot,
    render: (r) => <span className="block max-w-[104px] truncate">{r.depot}</span>,
    title: (r) => r.depot,
  },
  needed: {
    key: 'needed',
    header: 'Needed',
    unit: SERVICE_TEXT.bandMean,
    tag: 'modelled',
    align: 'right',
    width: W.needed,
    render: (r) => r.needed,
  },
  impact: { key: 'impact', header: 'Impact', tag: 'modelled', align: 'right', width: W.impact, render: (r) => r.impact, title: (r) => r.impactTitle },
  restsOn: { key: 'restsOn', header: 'Rests on', width: W.restsOn, render: (r) => r.restsOn, title: (r) => r.restsOnTitle },
};

const GROUP: TableGrouping<NetworkProposalRow> = { key: (r) => NETWORK_GROUP_LABEL[r.group] };

/** The expanded row: the reason, the route and depot, what it rests on, its impact, and a window's link. */
function NetworkProposalDetail({ row }: { readonly row: NetworkProposalRow }) {
  const p = row.proposal;
  const lines = [
    `Route: ${row.route}. Depot: ${row.depot}.`,
    `Deployed ${row.deployed}, needed ${row.needed} (band means; needed is modelled).`,
    row.sourceTitle,
    row.restsOnTitle,
    ...row.impactLines,
  ];
  return (
    <div className="space-y-1 py-2" data-testid="network-proposal-detail">
      <p className="depot-prose">{row.reason}</p>
      {lines.map((line) => (
        <p key={line} className="depot-note">{line}</p>
      ))}
      {p.kind === 'maintenance_window' && p.depotId !== null ? (
        <Link href={`${depotHref(p.depotId)}/maintenance`} className="depot-link depot-note">
          {`${row.depot} maintenance`}
        </Link>
      ) : null}
    </div>
  );
}

/** The band's proposals across the network, grouped (changes, findings, network moves), 25 a page. */
export function NetworkProposalsTable({ proposals }: { readonly proposals: readonly NetworkProposal[] }) {
  const tier = useWidthTier(NETWORK_PROPOSAL_TIERS);
  const [page, setPage] = useState(0);
  const rows = useMemo(() => orderNetworkProposals(proposals).map(networkProposalRow), [proposals]);
  const columns = useMemo(() => networkProposalColumnKeys(tier).map((key) => COLUMNS[key]), [tier]);
  const range = pageRange(page, rows.length);
  return (
    <section aria-labelledby={TITLE_ID} className="min-w-0" data-testid="service-network-proposals">
      <SectionLabel id={TITLE_ID} label={SERVICE_TEXT.proposalsTitle} />
      <div className="mb-3">
        <Notice status="info" word="Recommendation only">
          {SERVICE_TEXT.recommendation}
        </Notice>
      </div>
      {rows.length === 0 ? (
        <StatePanel kind="empty" compact tone="ok" sentence="No proposal in this band: no route or depot is short or over by enough to act." />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows.slice(range.start, range.end)}
            rowKey={(r) => r.id}
            rowLabel={(r) => `${r.band} ${r.change} ${r.route}`}
            caption="Proposals across the network for this band"
            fixedRows
            renderExpanded={(r) => <NetworkProposalDetail row={r} />}
            group={GROUP}
            multipleExpanded
          />
          <Pager page={range.page} total={rows.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}
