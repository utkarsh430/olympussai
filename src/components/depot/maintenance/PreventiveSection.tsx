'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import type { MaintenanceResponse } from '@/lib/depot/maintenance/api';
import type { ModelledService, ServiceGroup } from '@/lib/depot/maintenance/serviceModel';
import {
  kmToNextCell,
  kmToNextText,
  NEXT_SERVICE_HEADER,
  noAttentionText,
  preventiveGuard,
  SERVICE_HEADER,
  serviceClassLabel,
  serviceGroupLabel,
} from '@/lib/depot/maintenance/text';

const GROUP_ORDER: Readonly<Record<ServiceGroup, number>> = { overdue: 0, due_soon: 1, not_due: 2 };
const TABLE_CAP = 25;

function buildColumns(
  depotId: string,
  dueSoonWithinKm: number,
): readonly Column<ModelledService>[] {
  return [
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
      key: 'group',
      header: SERVICE_HEADER,
      sortValue: (bus) => GROUP_ORDER[bus.group],
      render: (bus) => serviceGroupLabel(bus.group),
    },
    {
      key: 'next',
      header: NEXT_SERVICE_HEADER,
      align: 'right',
      sortValue: (bus) => bus.kmToNextService,
      render: (bus) => <span title={kmToNextText(bus.kmToNextService, dueSoonWithinKm)}>{kmToNextCell(bus.kmToNextService)}</span>,
    },
    {
      key: 'class',
      header: 'Class',
      sortValue: (bus) => bus.serviceClass,
      render: (bus) => serviceClassLabel(bus.serviceClass),
    },
    {
      key: 'odometer',
      header: 'Odometer, km (MODELLED)',
      align: 'right',
      sortValue: (bus) => bus.odometerKm,
      render: (bus) => formatCount(bus.odometerKm),
    },
    {
      key: 'age',
      header: 'Age, years (MODELLED)',
      align: 'right',
      sortValue: (bus) => bus.ageYears,
      render: (bus) => String(bus.ageYears),
    },
  ];
}

export interface PreventiveSectionProps {
  readonly depotId: string;
  readonly preventive: MaintenanceResponse['preventive'];
}

/**
 * Buses a model says are overdue or due soon, beside their real registrations. The
 * section label and the modelled columns carry the MODELLED tag, and one sentence
 * above the table says these are not workshop records (rulings, section 2).
 */
export function PreventiveSection({ depotId, preventive }: PreventiveSectionProps) {
  const columns = useMemo(
    () => buildColumns(depotId, preventive.dueSoonWithinKm),
    [depotId, preventive.dueSoonWithinKm],
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
        <DataTable
          columns={columns}
          rows={preventive.buses}
          rowKey={(bus) => bus.registrationNumber}
          caption="Buses a model puts as overdue or due soon for a preventive service"
          fixedRows
          freezeFirstColumn
          overflowCue
          maxRows={TABLE_CAP}
        />
      )}
    </section>
  );
}
