'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ShowAllButton } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import type { MaintenanceResponse } from '@/lib/depot/maintenance/api';
import { preventiveView } from '@/lib/depot/maintenance/preventiveView';
import type { ModelledService, ServiceGroup } from '@/lib/depot/maintenance/serviceModel';
import {
  groupRowLabel,
  kmToNextCell,
  kmToNextText,
  NEXT_SERVICE_HEADER,
  noAttentionText,
  preventiveCaption,
  preventiveGuard,
  serviceClassLabel,
} from '@/lib/depot/maintenance/text';
import {
  PREVENTIVE_COLUMN_WIDTH_PX,
  preventiveColumnKeys,
  preventiveExpanderKeys,
  preventiveTier,
  type PreventiveColumnKey,
} from '@/lib/depot/maintenance/preventiveLayout';
import { useBelowDesktop, usePhone } from './useBelowDesktop';

const GROUP_ORDER: readonly ServiceGroup[] = ['overdue', 'due_soon', 'not_due'];

const groupsShown = (rows: readonly ModelledService[]): readonly ServiceGroup[] =>
  GROUP_ORDER.filter((group) => rows.some((bus) => bus.group === group));

const EXPANDED_WORDS: Readonly<Record<PreventiveColumnKey, (bus: ModelledService) => string>> = {
  registration: (bus) => bus.registrationNumber,
  next: (bus) => kmToNextCell(bus.kmToNextService),
  class: (bus) => `Class: ${serviceClassLabel(bus.serviceClass)}`,
  odometer: (bus) => `Odometer: ${formatCount(bus.odometerKm)} km`,
  age: (bus) => `Age: ${bus.ageYears} years`,
};

/** What the width's column set leaves out, as labelled values under the row. */
function ExpandedBus({
  bus,
  keys,
}: {
  readonly bus: ModelledService;
  readonly keys: readonly PreventiveColumnKey[];
}) {
  return (
    <p className="depot-note flex flex-wrap gap-x-6">
      {keys.map((key) => (
        <span key={key}>{EXPANDED_WORDS[key](bus)}</span>
      ))}
    </p>
  );
}

function buildColumns(
  depotId: string,
  dueSoonWithinKm: number,
): readonly Column<ModelledService>[] {
  const columns: Column<ModelledService>[] = [
    {
      key: 'registration',
      header: 'Registration',
      sortValue: (bus) => bus.registrationNumber,
      render: (bus) => (
        <Link
          href={rosterBusHref(depotId, bus.registrationNumber)}
          className="depot-table-link text-holo-glow underline-offset-2 hover:underline focus-visible:underline"
        >
          {bus.registrationNumber}
        </Link>
      ),
    },
    {
      key: 'next',
      header: NEXT_SERVICE_HEADER,
      align: 'right',
      sortValue: (bus) => bus.kmToNextService,
      render: (bus) => (
        <span title={kmToNextText(bus.kmToNextService, dueSoonWithinKm)}>
          {kmToNextCell(bus.kmToNextService)}
        </span>
      ),
    },
    {
      key: 'class',
      header: 'Class',
      sortValue: (bus) => bus.serviceClass,
      render: (bus) => serviceClassLabel(bus.serviceClass),
    },
    {
      key: 'odometer',
      header: 'Odometer, km',
      align: 'right',
      sortValue: (bus) => bus.odometerKm,
      render: (bus) => formatCount(bus.odometerKm),
    },
  ];
  columns.push({
    key: 'age',
    header: 'Age, years',
    align: 'right',
    sortValue: (bus) => bus.ageYears,
    render: (bus) => String(bus.ageYears),
  });
  return columns;
}

export interface PreventiveSectionProps {
  readonly depotId: string;
  readonly preventive: MaintenanceResponse['preventive'];
}

/**
 * Buses a model says are overdue or due soon, beside their real registrations. The
 * section label carries the one MODELLED tag (ruling S51), the group rows say
 * "Modelled overdue" in their own words, and one sentence above the table says these
 * are not workshop records. Below 1024px the odometer moves into the row expander.
 */
export function PreventiveSection({ depotId, preventive }: PreventiveSectionProps) {
  const [opened, setOpened] = useState<ReadonlySet<ServiceGroup>>(() => new Set());
  const tier = preventiveTier(useBelowDesktop(), usePhone());
  const hidden = preventiveExpanderKeys(tier);
  const view = useMemo(() => preventiveView(preventive.buses, opened), [preventive.buses, opened]);
  const columns = useMemo(() => {
    const shown = new Set<string>(preventiveColumnKeys(tier));
    return buildColumns(depotId, preventive.dueSoonWithinKm)
      .filter((column) => shown.has(column.key))
      .map((column) => ({
        ...column,
        width: PREVENTIVE_COLUMN_WIDTH_PX[column.key as PreventiveColumnKey],
      }));
  }, [depotId, preventive.dueSoonWithinKm, tier]);
  const toggle = (group: ServiceGroup): void =>
    setOpened((current) =>
      current.has(group)
        ? new Set([...current].filter((open) => open !== group))
        : new Set([...current, group]),
    );
  return (
    <section aria-labelledby="depot-preventive-heading" className="min-w-0 animate-rise">
      <SectionLabel
        id="depot-preventive-heading"
        label="Preventive maintenance"
        count={preventive.buses.length}
        tag="modelled"
        note="Most urgent first"
      />
      <p className="depot-prose mb-2">{preventiveGuard()}</p>
      {preventive.buses.length === 0 ? (
        <StatePanel kind="empty" sentence={noAttentionText()} />
      ) : (
        // One table per group, so each group's "SHOW ALL N ›" is its own last row (critique
        // round 5, maintenance Must 2); the shared widths keep the groups' columns aligned.
        <div className="flex flex-col gap-4">
          {groupsShown(view.rows).map((group) => (
            <div key={group} data-testid="depot-preventive-group" className="min-w-0">
              <DataTable
                id={`depot-preventive-${group}`}
                columns={columns}
                rows={view.rows.filter((bus) => bus.group === group)}
                rowKey={(bus) => bus.registrationNumber}
                caption={preventiveCaption()}
                fixedRows
                freezeFirstColumn
                overflowCue
                group={{
                  key: (bus) => bus.group,
                  label: (key) =>
                    groupRowLabel(key as ServiceGroup, view.totals[key as ServiceGroup] ?? 0),
                }}
                renderExpanded={
                  hidden.length > 0 ? (bus) => <ExpandedBus bus={bus} keys={hidden} /> : undefined
                }
                expandLabel={(bus) => `Show ${bus.registrationNumber} in full`}
                rowLabel={(bus) => bus.registrationNumber}
              />
              {view.cappable.includes(group) ? (
                <div className="mt-1">
                  <ShowAllButton
                    total={view.totals[group]}
                    expanded={opened.has(group)}
                    onToggle={() => toggle(group)}
                    controls={`depot-preventive-${group}`}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
