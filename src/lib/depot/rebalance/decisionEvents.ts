import type { AuditEvent, AuditEventType } from '@/lib/audit/auditLog';
import { readTransferSubject, type TransferSubject } from './decisionSubject';
import type { TransferDecisionKind } from './rebalanceModel';

/*
 * A planner's decisions on recommended transfers, kept as events in the local
 * audit log. The trail also holds decisions on route proposals
 * (`proposalDecisionEvents.ts`); a transfer's payload names its subject, and one
 * written before subjects existed is read as a transfer. The log is append-only: an undo is a further event naming the
 * event it withdraws, never a deletion. These reducers only read events; they
 * never dispatch anything and never change the plan.
 */

export type { TransferDecisionKind };

export const NOTE_MAX_CHARS = 200;
/** Files a scenario decision under `scenarioKey`, with the sentence kept as a label. */
export const PAYLOAD_VERSION = 2;

export interface DecisionInput {
  readonly transferId: string;
  readonly fromDepotId: string;
  readonly fromDepotName: string;
  readonly toDepotId: string;
  readonly toDepotName: string;
  readonly buses: number;
  readonly operatingDate: string;
  /** `scenarioKey` of the what-if showing when the decision was made; null on the baseline. */
  readonly scenario: string | null;
  /** The scenario's sentence at the time, for display only; null on the baseline. */
  readonly scenarioLabel: string | null;
  readonly note: string;
  readonly decision: TransferDecisionKind;
}

export interface DecisionEntry extends DecisionInput {
  readonly subject: TransferSubject;
  readonly eventId: string;
  readonly at: string;
  /** Id of the decision event this one withdraws; null for a decision. */
  readonly undoes: string | null;
}

/** Where a recorded decision stands in its subject's history. */
export interface TrailFlags {
  /** The subject's current decision, so it can still be undone. */
  readonly undoable: boolean;
  /** A later event withdrew this decision. */
  readonly undone: boolean;
  /** A later decision on the same subject replaced this one and is still in force. */
  readonly superseded: boolean;
}

export interface TrailItem extends DecisionEntry, TrailFlags {}

export interface DecisionTrail {
  readonly baseline: readonly TrailItem[];
  readonly scenario: readonly TrailItem[];
}

export type NewAuditEvent = Omit<AuditEvent, 'id' | 'at'>;

export type NoteResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string };

const EVENT_TYPE: Readonly<Record<TransferDecisionKind, AuditEventType>> = {
  approved: 'depot-transfer-approved',
  rejected: 'depot-transfer-rejected',
  deferred: 'depot-transfer-deferred',
};

export const VERB: Readonly<Record<TransferDecisionKind, string>> = {
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
};

/** The decision an event type records, among the given family's types. */
export function kindOfType(
  type: unknown,
  family: Readonly<Record<TransferDecisionKind, AuditEventType>> = EVENT_TYPE,
): TransferDecisionKind | null {
  for (const [kind, eventType] of Object.entries(family)) {
    if (eventType === type) return kind as TransferDecisionKind;
  }
  return null;
}

function eventFor(record: DecisionInput, undoes: string | null, summary: string): NewAuditEvent {
  return {
    type: EVENT_TYPE[record.decision],
    summary,
    simulated: true,
    detail: JSON.stringify({
      v: PAYLOAD_VERSION,
      subject: { kind: 'transfer', transferId: record.transferId },
      ...record,
      undoes,
    }),
  };
}

function route(record: DecisionInput): string {
  return `${record.buses} ${record.buses === 1 ? 'bus' : 'buses'} ${record.fromDepotName} → ${record.toDepotName}`;
}

/** A decision as an audit event, flagged model-derived like the log's other model events. */
export function decisionEvent(record: DecisionInput): NewAuditEvent {
  const where = record.scenario === null ? 'modelled plan' : 'what-if scenario';
  return eventFor(record, null, `${VERB[record.decision]} transfer of ${route(record)} (${where})`);
}

/** Withdraws a decision by recording a further event of the same type. */
export function undoEvent(entry: DecisionEntry): NewAuditEvent {
  const record: DecisionInput = {
    transferId: entry.transferId,
    fromDepotId: entry.fromDepotId,
    fromDepotName: entry.fromDepotName,
    toDepotId: entry.toDepotId,
    toDepotName: entry.toDepotName,
    buses: entry.buses,
    operatingDate: entry.operatingDate,
    scenario: entry.scenario,
    scenarioLabel: entry.scenarioLabel,
    note: entry.note,
    decision: entry.decision,
  };
  const verb = VERB[entry.decision].toLowerCase();
  return eventFor(record, entry.eventId, `Undid ${verb} transfer of ${route(record)}`);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** An event's detail as a plain object, or null when it is not one. */
export function readPayload(detail: unknown): Record<string, unknown> | null {
  if (!isString(detail)) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The copy of a decision that goes to the shared audit log: the same event with its note
 * emptied. The trail's clear control does not reach that log, so a planner's note must
 * never be held there.
 */
export function withoutNote<T extends { readonly detail?: string }>(event: T): T {
  const payload = readPayload(event.detail);
  if (payload === null) return event;
  return { ...event, detail: JSON.stringify({ ...payload, note: '' }) };
}

/** A stored event as a decision, or null when it is not one or is malformed. */
export function parseDecisionEvent(event: unknown): DecisionEntry | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as Record<string, unknown>;
  const decision = kindOfType(e.type);
  const p = readPayload(e.detail);
  if (!decision || !p || !isString(e.id) || !isString(e.at)) return null;
  const strings = ['transferId', 'fromDepotId', 'fromDepotName', 'toDepotId', 'toDepotName'];
  if (p.v !== PAYLOAD_VERSION || !strings.every((k) => isString(p[k]))) return null;
  if (!isString(p.operatingDate) || !isString(p.note)) return null;
  if (typeof p.buses !== 'number' || !Number.isFinite(p.buses)) return null;
  if (p.scenario !== null && !isString(p.scenario)) return null;
  if (p.undoes !== null && !isString(p.undoes)) return null;
  const label = p.scenarioLabel;
  if (label !== null && !isString(label)) return null;
  const subject = readTransferSubject(p.subject, p.transferId as string);
  if (subject === null) return null;
  return {
    subject,
    eventId: e.id,
    at: e.at,
    transferId: p.transferId as string,
    fromDepotId: p.fromDepotId as string,
    fromDepotName: p.fromDepotName as string,
    toDepotId: p.toDepotId as string,
    toDepotName: p.toDepotName as string,
    buses: p.buses,
    operatingDate: p.operatingDate,
    scenario: p.scenario,
    scenarioLabel: label,
    note: p.note,
    decision,
    undoes: p.undoes,
  };
}

export function validateNote(raw: string): NoteResult {
  const value = raw.trim();
  if (value.length > NOTE_MAX_CHARS) {
    return { ok: false, error: `A note can be at most ${NOTE_MAX_CHARS} characters.` };
  }
  return { ok: true, value };
}
