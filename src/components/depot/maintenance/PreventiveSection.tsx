'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import type { MaintenanceResponse } from '@/lib/depot/maintenance/api';
import { SERVICE_INTERVAL_KM } from '@/lib/depot/maintenance/config';
import type { ModelledService, ServiceGroup } from '@/lib/depot/maintenance/serviceModel';
import {
  distanceNotice,
  groupSummary,
  intervalText,
  NEXT_SERVICE_HEADER,
  SERVICE_HEADER,
  kmToNextText,
  noAttentionText,
  preventiveNote,
  serviceClassLabel,
  serviceGroupLabel,
} from '@/lib/depot/maintenance/text';
import type { ServiceClass } from '@/lib/depot/sim/types';

const GROUP_ORDER: Readonly<Record<ServiceGroup, number>> = { overdue: 0, due_soon: 1, not_due: 2 };
const CLASSES = Object.keys(SERVICE_INTERVAL_KM) as readonly ServiceClass[];

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
      render: (bus) => kmToNextText(bus.kmToNextService, dueSoonWithinKm),
    },
    {
      key: 'class',
      header: 'Class',
      sortValue: (bus) => bus.serviceClass,
      render: (bus) => serviceClassLabel(bus.serviceClass),
    },
    {
      key: 'age',
      header: 'Modelled age',
      align: 'right',
      sortValue: (bus) => bus.ageYears,
      render: (bus) => `${bus.ageYears} y`,
    },
    {
      key: 'odometer',
      header: 'Modelled odometer',
      align: 'right',
      sortValue: (bus) => bus.odometerKm,
      render: (bus) => `${formatCount(bus.odometerKm)} km`,
    },
  ];
}

export interface PreventiveSectionProps {
  readonly depotId: string;
  readonly preventive: MaintenanceResponse['preventive'];
  readonly distanceCoverage: MaintenanceResponse['distanceCoverage'];
}

/**
 * Buses grouped by words (overdue, due soon, not due) on a modelled odometer.
 * Only the buses that need attention are listed; the rest are counted.
 */
export function PreventiveSection({
  depotId,
  preventive,
  distanceCoverage,
}: PreventiveSectionProps) {
  const columns = useMemo(
    () => buildColumns(depotId, preventive.dueSoonWithinKm),
    [depotId, preventive.dueSoonWithinKm],
  );
  const attention = useMemo(
    () => preventive.buses.filter((bus) => bus.group !== 'not_due'),
    [preventive.buses],
  );
  return (
    <section aria-labelledby="depot-preventive-heading" className="min-w-0 animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-preventive-heading" className="depot-section-label !mb-0">
          Preventive maintenance
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <p className="depot-prose mb-2 flex flex-wrap items-center gap-x-2">
        <ProvenanceBadge provenance="live" coverage={distanceCoverage.coverage} />
        <span>{distanceNotice(distanceCoverage.coverage)}</span>
      </p>
      <p className="depot-prose mb-2">{preventiveNote(preventive.dueSoonWithinKm)}</p>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-depot-muted">
        {CLASSES.map((serviceClass) => (
          <li key={serviceClass}>
            {intervalText(serviceClass, SERVICE_INTERVAL_KM[serviceClass])}
          </li>
        ))}
      </ul>
      <p className="depot-prose mb-3" role="status">
        {groupSummary(preventive.counts)}
      </p>
      {attention.length === 0 ? (
        <EmptyState>{noAttentionText()}</EmptyState>
      ) : (
        <DataTable
          columns={columns}
          rows={attention}
          rowKey={(bus) => bus.registrationNumber}
          caption="Buses overdue or due soon for a preventive service, modelled"
        />
      )}
    </section>
  );
}
