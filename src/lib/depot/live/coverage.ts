import type { DepotBusRow } from '@/models/depotLive';
import type { FieldCoverage } from '../types';

interface FieldSpec {
  readonly field: string;
  readonly label: string;
  readonly isPopulated: (row: Readonly<DepotBusRow>) => boolean;
}

const present = (value: unknown): boolean => value !== null && value !== undefined;

/** Listed in the order the Data Sources page shows them. */
const FIELDS: readonly FieldSpec[] = [
  { field: 'depotId', label: 'Depot', isPopulated: (r) => present(r.depotId) },
  {
    field: 'position',
    label: 'Position',
    isPopulated: (r) => present(r.latitude) && present(r.longitude),
  },
  {
    field: 'vehicleStatus',
    label: 'Vehicle status',
    isPopulated: (r) => r.vehicleStatus !== 'unknown',
  },
  { field: 'gpsTimestamp', label: 'GPS time', isPopulated: (r) => present(r.gpsTimestamp) },
  { field: 'routeName', label: 'Route', isPopulated: (r) => present(r.routeName) },
  { field: 'scheduledStart', label: 'Scheduled start', isPopulated: (r) => present(r.scheduledStart) },
  { field: 'actualStart', label: 'Actual start', isPopulated: (r) => present(r.actualStart) },
  { field: 'delayMinutes', label: 'Delay', isPopulated: (r) => present(r.delayMinutes) },
  { field: 'odometerRaw', label: 'Odometer', isPopulated: (r) => present(r.odometerRaw) },
  { field: 'mainPowerOn', label: 'Main power', isPopulated: (r) => present(r.mainPowerOn) },
  { field: 'tamperCode', label: 'Tamper code', isPopulated: (r) => present(r.tamperCode) },
];

/** How many feed records populate each field; `of` is the record count. */
export function fieldCoverage(rows: readonly DepotBusRow[]): FieldCoverage[] {
  return FIELDS.map(({ field, label, isPopulated }) => ({
    field,
    label,
    populated: rows.filter(isPopulated).length,
    of: rows.length,
  }));
}
