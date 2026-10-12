import type { AuditEvent, AuditEventType } from '@/lib/audit/auditLog';
import { isValidDepotId } from '../ids';
import { PAYLOAD_VERSION, VERB, isString, kindOfType, readPayload, type NewAuditEvent, type TrailFlags } from '../rebalance/decisionEvents';
import { currentOf, flagTrail, replay } from '../rebalance/decisionReducers';
import type { TransferDecisionKind } from '../rebalance/rebalanceModel';

/*
 * A planner's decisions on a depot's schedule plan, kept in the same browser
 * trail as the transfer and proposal decisions. A decision is on the plan's
 * figures (its key): a changed plan has no decision until one is made.
 */

export interface ScheduleSubject {
  readonly kind: 'schedule';
  readonly depotId: string;
  readonly depotName: string;
  readonly planKey: string;
  readonly busesScheduled: number;
  readonly crewSlotsUsed: number;
}

export interface ScheduleDecisionInput {
  readonly subject: ScheduleSubject;
  readonly operatingDate: string;
  readonly note: string;
  readonly decision: TransferDecisionKind;
}

export interface ScheduleDecisionEntry extends ScheduleDecisionInput {
  readonly eventId: string;
  readonly at: string;
  readonly undoes: string | null;
}

export interface ScheduleTrailItem extends ScheduleDecisionEntry, TrailFlags {}

const EVENT_TYPE: Readonly<Record<TransferDecisionKind, AuditEventType>> = {
  approved: 'depot-schedule-approved',
  rejected: 'depot-schedule-rejected',
  deferred: 'depot-schedule-deferred',
};

const MAX_TEXT = 120;

export function scheduleWhat(subject: ScheduleSubject): string {
  return `${subject.depotName} schedule plan: ${subject.busesScheduled} buses, ${subject.crewSlotsUsed} crew slots`;
}

function eventFor(record: ScheduleDecisionInput, undoes: string | null, summary: string): NewAuditEvent {
  return {
    type: EVENT_TYPE[record.decision],
    summary,
    simulated: true,
    detail: JSON.stringify({ v: PAYLOAD_VERSION, subject: record.subject, operatingDate: record.operatingDate, note: record.note, undoes }),
  };
}

export function scheduleDecisionEvent(record: ScheduleDecisionInput): NewAuditEvent {
  return eventFor(record, null, `${VERB[record.decision]} ${scheduleWhat(record.subject)}`);
}

export function scheduleUndoEvent(entry: ScheduleDecisionEntry): NewAuditEvent {
  const record = { subject: entry.subject, operatingDate: entry.operatingDate, note: entry.note, decision: entry.decision };
  return eventFor(record, entry.eventId, `Undid ${VERB[entry.decision].toLowerCase()} ${scheduleWhat(entry.subject)}`);
}

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function readScheduleSubject(value: unknown): ScheduleSubject | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'schedule' || !isString(v.depotId) || !isValidDepotId(v.depotId)) return null;
  if (!isString(v.depotName) || v.depotName.length > MAX_TEXT || !isString(v.planKey) || v.planKey.length > MAX_TEXT) return null;
  if (!isWhole(v.busesScheduled) || !isWhole(v.crewSlotsUsed)) return null;
  return { kind: 'schedule', depotId: v.depotId, depotName: v.depotName, planKey: v.planKey, busesScheduled: v.busesScheduled, crewSlotsUsed: v.crewSlotsUsed };
}

export function parseScheduleDecisionEvent(event: unknown): ScheduleDecisionEntry | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as Record<string, unknown>;
  const decision = kindOfType(e.type, EVENT_TYPE);
  const p = readPayload(e.detail);
  if (!decision || !p || !isString(e.id) || !isString(e.at)) return null;
  if (p.v !== PAYLOAD_VERSION || !isString(p.operatingDate) || !isString(p.note)) return null;
  if (p.undoes !== null && !isString(p.undoes)) return null;
  const subject = readScheduleSubject(p.subject);
  if (subject === null) return null;
  return { subject, operatingDate: p.operatingDate, note: p.note, decision, eventId: e.id, at: e.at, undoes: p.undoes };
}

/** One subject per depot and date: the latest decision on any of its plans is the one in force. */
const keyOf = (entry: ScheduleDecisionEntry): string => entry.subject.depotId;

function entriesFor(events: readonly AuditEvent[], depotId: string, operatingDate: string): ScheduleDecisionEntry[] {
  return events
    .map(parseScheduleDecisionEvent)
    .filter((e): e is ScheduleDecisionEntry => e !== null && e.operatingDate === operatingDate && e.subject.depotId === depotId)
    .reverse();
}

/** The decision in force on the depot's plan for the date, or null. */
export function scheduleDecisionFor(events: readonly AuditEvent[], depotId: string, operatingDate: string): ScheduleDecisionEntry | null {
  return currentOf(replay(entriesFor(events, depotId, operatingDate), keyOf).stacks).get(depotId) ?? null;
}

export function scheduleTrail(events: readonly AuditEvent[], depotId: string, operatingDate: string): readonly ScheduleTrailItem[] {
  return flagTrail(entriesFor(events, depotId, operatingDate), keyOf);
}

/** Every depot with a decision in force for the date, by depot id. */
export function scheduleDecisionsByDepot(events: readonly AuditEvent[], operatingDate: string): ReadonlyMap<string, ScheduleDecisionEntry> {
  const entries = events
    .map(parseScheduleDecisionEvent)
    .filter((e): e is ScheduleDecisionEntry => e !== null && e.operatingDate === operatingDate)
    .reverse();
  return currentOf(replay(entries, keyOf).stacks);
}

export function describeScheduleTrailItem(item: ScheduleTrailItem): string {
  const verb = item.undoes === null ? VERB[item.decision] : `Undid ${VERB[item.decision].toLowerCase()}`;
  return `${verb} ${scheduleWhat(item.subject)}`;
}
