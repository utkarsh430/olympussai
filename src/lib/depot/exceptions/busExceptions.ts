import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState, DepotSummary } from '../types';
import { gpsAgeMinutes } from '../infer/busState';
import { LONG_DARK_AFTER_MIN } from '../infer/thresholds';
import { NORMAL_TAMPER_CODE, SEVERITY_ORDER } from './config';
import { compareText } from './depotExceptions';
import type { BusException, BusExceptionKind, ExceptionSeverity } from './types';

interface Finding {
  readonly kind: BusExceptionKind;
  readonly severity: ExceptionSeverity;
  readonly detail: string | null;
}

/**
 * Every rule that fires for one bus. `long_dark` needs the feed clock: with no
 * `feedNow` there is no age, so it stays silent rather than guessing.
 */
function findingsFor(row: DepotBusRow, state: BusOpState, feedNow: string | null): Finding[] {
  const findings: Finding[] = [];
  const offRoad = state === 'off_road';
  if (row.emergency === true) findings.push({ kind: 'emergency', severity: 'critical', detail: null });
  const age = gpsAgeMinutes(row, feedNow);
  if (!offRoad && age !== null && age > LONG_DARK_AFTER_MIN) {
    findings.push({ kind: 'long_dark', severity: 'warning', detail: null });
  }
  if (!offRoad && row.mainPowerOn === false) {
    findings.push({ kind: 'power_cut', severity: 'info', detail: null });
  }
  if (row.tamperCode && row.tamperCode !== NORMAL_TAMPER_CODE) {
    // The raw code is shown as-is; its meaning is not asserted.
    findings.push({ kind: 'tamper_code', severity: 'info', detail: row.tamperCode });
  }
  return findings;
}

/** Null names sort last, so named depots lead the list. */
function compareNullableText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareText(a, b);
}

export function compareBusExceptions(a: BusException, b: BusException): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    compareNullableText(a.depotName, b.depotName) ||
    compareText(a.registrationNumber, b.registrationNumber) ||
    compareText(a.kind, b.kind)
  );
}

/**
 * Bus-level exceptions, uncapped and sorted. The depot name comes from the
 * depot summary (its modal name) so every bus of a depot sorts together, even
 * when individual feed records spell the name differently.
 */
export function detectBusExceptions(
  rows: readonly DepotBusRow[],
  depots: readonly DepotSummary[],
  feedNow: string | null,
  stateOf: (row: DepotBusRow) => BusOpState,
): BusException[] {
  const names = new Map(depots.map((d) => [d.id, d.name] as const));
  const found: BusException[] = [];
  for (const row of rows) {
    const findings = findingsFor(row, stateOf(row), feedNow);
    if (findings.length === 0) continue;
    const depotName =
      row.depotId === null ? null : (names.get(row.depotId) ?? row.depotName ?? null);
    for (const { kind, severity, detail } of findings) {
      found.push({
        id: `${kind}:${row.registrationNumber}`,
        registrationNumber: row.registrationNumber,
        depotId: row.depotId,
        depotName,
        kind,
        severity,
        lastSeen: row.gpsTimestamp,
        detail,
      });
    }
  }
  return found.sort(compareBusExceptions);
}
