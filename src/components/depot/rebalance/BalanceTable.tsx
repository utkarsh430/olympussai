'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { DEPOT_KIND_LABEL } from '@/lib/depot/labels';
import { formatCount } from '@/lib/depot/format';
import type { BalanceRow } from '@/lib/depot/rebalance/rebalanceModel';
import { BalanceBar } from './BalanceBar';

export interface BalanceTableProps {
  /** In model order: operating depots by balance, deepest deficit first; other kinds after. */
  readonly rows: readonly BalanceRow[];
}

function count(n: number): string {
  return formatCount(n);
}

function columnsFor(maxMagnitude: number): readonly Column<BalanceRow>[] {
  return [
    {
      key: 'name',
      header: 'Depot',
      sortValue: (r) => r.depotName,
      render: (r) => (
        <span className="block max-w-[220px] truncate" title={r.depotName}>
          {r.depotName}
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'Part of plan',
      render: (r) => (r.takesPart ? 'Yes' : `No, ${DEPOT_KIND_LABEL[r.kind].toLowerCase()}`),
    },
    {
      key: 'fleet',
      header: 'Fleet · live',
      align: 'right',
      sortValue: (r) => r.fleet,
      render: (r) => count(r.fleet),
    },
    {
      key: 'offRoad',
      header: 'Off road · live',
      align: 'right',
      sortValue: (r) => r.offRoad,
      render: (r) => count(r.offRoad),
    },
    {
      key: 'available',
      header: 'Available · live',
      align: 'right',
      sortValue: (r) => r.available,
      render: (r) => count(r.available),
    },
    {
      key: 'peak',
      header: 'Peak need · modelled',
      align: 'right',
      sortValue: (r) => r.peakRequirement,
      render: (r) => count(r.peakRequirement),
    },
    {
      key: 'spare',
      header: 'Spare · modelled',
      align: 'right',
      sortValue: (r) => r.spareTarget,
      render: (r) => count(r.spareTarget),
    },
    {
      key: 'required',
      header: 'Required · modelled',
      align: 'right',
      sortValue: (r) => r.required,
      render: (r) => count(r.required),
    },
    {
      key: 'balance',
      header: 'Balance · modelled',
      sortValue: (r) => r.balance,
      render: (r) => <BalanceBar balance={r.balance} maxMagnitude={maxMagnitude} />,
    },
  ];
}

/**
 * Every depot's live availability against its modelled requirement. Columns
 * name their provenance in the header; the balance is a diverging bar with
 * its figure written beside it.
 */
export function BalanceTable({ rows }: BalanceTableProps) {
  const maxMagnitude = useMemo(
    () => rows.filter((r) => r.takesPart).reduce((m, r) => Math.max(m, Math.abs(r.balance)), 0),
    [rows],
  );
  const columns = useMemo(() => columnsFor(maxMagnitude), [maxMagnitude]);

  return (
    <section aria-labelledby="rebalance-balance-heading" data-testid="rebalance-balances">
      <h2 id="rebalance-balance-heading" className="depot-section-label">
        Every depot: available against required
      </h2>
      <p className="depot-prose mb-2 text-xs">
        Deepest shortfall first. Hired, electric and enforcement units are listed after the depots
        and take no part in the plan.
      </p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.depotId}
        caption="Depot balances: live availability against modelled requirement"
        emptyMessage="No depot balances are available on this snapshot."
      />
    </section>
  );
}
