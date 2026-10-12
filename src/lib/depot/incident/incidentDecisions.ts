import type { AuditEvent, AuditEventType } from '@/lib/audit/auditLog';
import { isValidDepotId, isValidRegistration } from '../ids';
import { PAYLOAD_VERSION, VERB, isString, kindOfType, readPayload, type NewAuditEvent, type TrailFlags } from '../rebalance/decisionEvents';
import { currentOf, flagTrail, replay } from '../rebalance/decisionReducers';
import type { TransferDecisionKind } from '../rebalance/rebalanceModel';
import type { ReplacementKind } from './types';

/*
 * Decisions on a replacement for a broken-down bus, kept in the same browser
 * trail as the other decisions. One subject per bus and date: the decision in
 * force is on the plan key it was made for.
 */

export interface ReplacementSubject {
  readonly kind: 'replacement';
  readonly depotId: string;
  readonly depotName: string;
  readonly registrationNumber: string;
  readonly candidateId: string;
  readonly candidateKind: ReplacementKind;
  readonly arrivalMinutes: number | null;
  readonly planKey: string;
}

export interface ReplacementDecisionInput {
  readonly subject: ReplacementSubject;
  readonly operatingDate: string;
  readonly note: string;
  readonly decision: TransferDecisionKind;
}

export interface ReplacementDecisionEntry extends ReplacementDecisionInput {
  readonly eventId: string;
  readonly at: string;
  readonly undoes: string | null;
}

export interface ReplacementTrailItem extends ReplacementDecisionEntry, TrailFlags {}

const EVENT_TYPE: Readonly<Record<TransferDecisionKind, AuditEventType>> = {
  approved: 'depot-replacement-approved',
  rejected: 'depot-replacement-rejected',
  deferred: 'depot-replacement-deferred',
};
const KINDS: ReadonlySet<string> = new Set<ReplacementKind>(['own_yard_spare', 'other_depot_spare', 'following_bus', 'block_ending_bus', 'next_scheduled']);
const MAX_TEXT = 120;

export function replacementWhat(subject: ReplacementSubject): string {
  return `replacement for ${subject.registrationNumber} at ${subject.depotName}`;
}

function eventFor(record: ReplacementDecisionInput, undoes: string | null, summary: string): NewAuditEvent {
  return {
    type: EVENT_TYPE[record.decision],
    summary,
    simulated: true,
    detail: JSON.stringify({ v: PAYLOAD_VERSION, subject: record.subject, operatingDate: record.operatingDate, note: record.note, undoes }),
  };
}

export const replacementDecisionEvent = (record: ReplacementDecisionInput): NewAuditEvent =>
  eventFor(record, null, `${VERB[record.decision]} ${replacementWhat(record.subject)}`);

export const replacementUndoEvent = (entry: ReplacementDecisionEntry): NewAuditEvent =>
  eventFor({ subject: entry.subject, operatingDate: entry.operatingDate, note: entry.note, decision: entry.decision }, entry.eventId, `Undid ${VERB[entry.decision].toLowerCase()} ${replacementWhat(entry.subject)}`);

export function readReplacementSubject(value: unknown): ReplacementSubject | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'replacement' || !isString(v.depotId) || !isValidDepotId(v.depotId)) return null;
  if (!isString(v.depotName) || v.depotName.length > MAX_TEXT || !isValidRegistration(v.registrationNumber)) return null;
  if (!isString(v.candidateId) || v.candidateId.length > MAX_TEXT || !isString(v.candidateKind) || !KINDS.has(v.candidateKind)) return null;
  if (!isString(v.planKey) || v.planKey.length > MAX_TEXT) return null;
  if (v.arrivalMinutes !== null && !(typeof v.arrivalMinutes === 'number' && Number.isFinite(v.arrivalMinutes))) return null;
  return { kind: 'replacement', depotId: v.depotId, depotName: v.depotName, registrationNumber: v.registrationNumber, candidateId: v.candidateId, candidateKind: v.candidateKind as ReplacementKind, arrivalMinutes: v.arrivalMinutes as number | null, planKey: v.planKey };
}

export function parseReplacementDecisionEvent(event: unknown): ReplacementDecisionEntry | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as Record<string, unknown>;
  const decision = kindOfType(e.type, EVENT_TYPE);
  const p = readPayload(e.detail);
  if (!decision || !p || !isString(e.id) || !isString(e.at)) return null;
  if (p.v !== PAYLOAD_VERSION || !isString(p.operatingDate) || !isString(p.note)) return null;
  if (p.undoes !== null && !isString(p.undoes)) return null;
  const subject = readReplacementSubject(p.subject);
  if (subject === null) return null;
  return { subject, operatingDate: p.operatingDate, note: p.note, decision, eventId: e.id, at: e.at, undoes: p.undoes };
}

const keyOf = (entry: ReplacementDecisionEntry): string => `${entry.subject.depotId}|${entry.subject.registrationNumber}`;

function entriesFor(events: readonly AuditEvent[], depotId: string, operatingDate: string): ReplacementDecisionEntry[] {
  return events
    .map(parseReplacementDecisionEvent)
    .filter((e): e is ReplacementDecisionEntry => e !== null && e.operatingDate === operatingDate && e.subject.depotId === depotId)
    .reverse();
}

/** The decision in force per bus of the depot for the date. */
export function replacementDecisionsFor(events: readonly AuditEvent[], depotId: string, operatingDate: string): ReadonlyMap<string, ReplacementDecisionEntry> {
  const current = currentOf(replay(entriesFor(events, depotId, operatingDate), keyOf).stacks);
  return new Map([...current].map(([key, entry]) => [key.slice(depotId.length + 1), entry] as const));
}

export function replacementTrail(events: readonly AuditEvent[], depotId: string, operatingDate: string): readonly ReplacementTrailItem[] {
  return flagTrail(entriesFor(events, depotId, operatingDate), keyOf);
}

export function describeReplacementTrailItem(item: ReplacementTrailItem): string {
  const verb = item.undoes === null ? VERB[item.decision] : `Undid ${VERB[item.decision].toLowerCase()}`;
  return `${verb} ${replacementWhat(item.subject)}`;
}
