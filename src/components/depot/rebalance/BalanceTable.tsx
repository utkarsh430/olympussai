'use client';

import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { DEPOT_KIND_LABEL } from '@/lib/depot/labels';
import { formatCount } from '@/lib/depot/format';
import { balancePreview, partOfPlanVaries } from '@/lib/depot/rebalance/pageLayout';
import type { BalanceRow } from '@/lib/depot/rebalance/rebalanceModel';
import { BalanceBar } from './BalanceBar';
import { CollapsedSection } from '@/components/depot/shell/CollapsedSection';

export interface BalanceTableProps {
  /** In model order: operating depots by balance, deepest deficit first; other kinds after. */
  readonly rows: readonly BalanceRow[];
}

function count(n: number): string {
  return formatCount(n);
}

function columnsFor(maxMagnitude: number, withPart: boolean): readonly Column<BalanceRow>[] {
  const all: readonly Column<BalanceRow>[] = [
    {
      key: 'name',
      header: 'Depot',
      sortValue: (r) => r.depotName,
      render: (r) => r.depotName,
    },
    {
      key: 'kind',
      header: 'Part of plan',
      render: (r) => (r.takesPart ? 'Yes' : `No, ${DEPOT_KIND_LABEL[r.kind].toLowerCase()}`),
    },
    {
      key: 'fleet',
      header: 'Fleet',
      align: 'right',
      sortValue: (r) => r.fleet,
      render: (r) => count(r.fleet),
    },
    {
      key: 'offRoad',
      header: 'Off road',
      align: 'right',
      sortValue: (r) => r.offRoad,
      render: (r) => count(r.offRoad),
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      sortValue: (r) => r.available,
      render: (r) => count(r.available),
    },
    {
      key: 'peak',
      tag: 'modelled',
      header: 'Peak need',
      align: 'right',
      sortValue: (r) => r.peakRequirement,
      render: (r) => count(r.peakRequirement),
    },
    {
      key: 'spare',
      tag: 'modelled',
      header: 'Spare target',
      align: 'right',
      sortValue: (r) => r.spareTarget,
      render: (r) => count(r.spareTarget),
    },
    {
      key: 'required',
      tag: 'modelled',
      header: 'Required',
      align: 'right',
      sortValue: (r) => r.required,
      render: (r) => count(r.required),
    },
    {
      key: 'balance',
      tag: 'modelled',
      header: 'Balance',
      sortValue: (r) => r.balance,
      render: (r) => <BalanceBar balance={r.balance} maxMagnitude={maxMagnitude} />,
    },
  ];
  return withPart ? all : all.filter((c) => c.key !== 'kind');
}

/**
 * Generated columns (peak need, spare target, required, balance) carry the MODELLED tag in
 * their header cells, because each sits beside a real depot (ruling S51); the fleet, off
 * road and available columns match the page's line and carry nothing.
 *
 * Every depot's live availability against its modelled requirement, collapsed under its
 * heading: the fifteen deepest shortfalls, then "Show all N". The "Part of plan" column
 * shows only when some unit takes no part (it is constant otherwise).
 */
export function BalanceTable({ rows }: BalanceTableProps) {
  const [showAll, setShowAll] = useState(false);
  const maxMagnitude = useMemo(
    () => rows.filter((r) => r.takesPart).reduce((m, r) => Math.max(m, Math.abs(r.balance)), 0),
    [rows],
  );
  const withPart = partOfPlanVaries(rows);
  const columns = useMemo(() => columnsFor(maxMagnitude, withPart), [maxMagnitude, withPart]);
  const shown = balancePreview(rows, showAll);

  return (
    <CollapsedSection
      label="Every depot: available against required"
      count={rows.length}
      note="Deepest shortfall first"
      headingId="rebalance-balance-heading"
      testId="rebalance-balances"
    >
      {withPart ? (
        <p className="depot-prose mb-2 text-xs">
          Hired, electric and enforcement units are listed after the depots and take no part in
          the plan.
        </p>
      ) : null}
      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(r) => r.depotId}
        caption="Depot balances: live availability against modelled requirement"
        emptyMessage="No depot balances are available on this snapshot."
        fixedRows
        freezeFirstColumn
        overflowCue
      />
      {rows.length > shown.length || showAll ? (
        <button
          type="button"
          className="depot-link mt-2 text-[13px]"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show the fifteen deepest' : `Show all ${formatCount(rows.length)} depots`}
        </button>
      ) : null}
    </CollapsedSection>
  );
}
