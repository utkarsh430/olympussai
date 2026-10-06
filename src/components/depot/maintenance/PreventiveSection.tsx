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
import { useBelowDesktop } from './useBelowDesktop';

function buildColumns(
  depotId: string,
  dueSoonWithinKm: number,
  odometerColumn: boolean,
): readonly Column<ModelledService>[] {
  const columns: Column<ModelledService>[] = [
    {
      key: 'registration',
      header: 'Registration',
      sortValue: (bus) => bus.registrationNumber,
      render: (bus) => (
        <Link
          href={rosterBusHref(depotId, bus.registrationNumber)}
          className="text-holo-glow underline-offset-2 hover:underline"
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
  ];
  if (odometerColumn) {
    columns.push({
      key: 'odometer',
      header: 'Odometer, km',
      align: 'right',
      sortValue: (bus) => bus.odometerKm,
      render: (bus) => formatCount(bus.odometerKm),
    });
  }
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
  const below = useBelowDesktop();
  const view = useMemo(() => preventiveView(preventive.buses, opened), [preventive.buses, opened]);
  const columns = useMemo(
    () => buildColumns(depotId, preventive.dueSoonWithinKm, !below),
    [depotId, preventive.dueSoonWithinKm, below],
  );
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
        <>
          <DataTable
            columns={columns}
            rows={view.rows}
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
              below
                ? (bus) => <p className="depot-note">Odometer: {formatCount(bus.odometerKm)} km</p>
                : undefined
            }
            expandLabel={(bus) => `Show the odometer of ${bus.registrationNumber}`}
          />
          {view.cappable.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-6">
              {view.cappable.map((group) => (
                <span key={group} className="flex items-center gap-2">
                  <span className="depot-note">{groupRowLabel(group, view.totals[group])}</span>
                  <ShowAllButton
                    total={view.totals[group]}
                    expanded={opened.has(group)}
                    onToggle={() => toggle(group)}
                  />
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
