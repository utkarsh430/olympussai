import type { AuditEventType } from '@/lib/audit/auditLog';
import { networkChangeCell } from '../service/networkPageModel';
import { bandLabel } from '../service/serviceWording';
import {
  PAYLOAD_VERSION,
  VERB,
  isString,
  kindOfType,
  parseDecisionEvent,
  readPayload,
  type DecisionEntry,
  type NewAuditEvent,
  type TrailFlags,
} from './decisionEvents';
import {
  readProposalSubject,
  type ProposalFigures,
  type ProposalSubject,
} from './decisionSubject';
import type { TransferDecisionKind } from './rebalanceModel';

/*
 * A planner's decisions on a route's proposals, kept in the same append-only trail as the
 * transfer decisions and written the same way: an undo is a further event naming the one
 * it withdraws. A decision changes nothing but the record; no bus is moved or held.
 */

export interface ProposalDecisionInput {
  readonly subject: ProposalSubject;
  readonly operatingDate: string;
  readonly note: string;
  readonly decision: TransferDecisionKind;
}

export interface ProposalDecisionEntry extends ProposalDecisionInput {
  readonly eventId: string;
  readonly at: string;
  /** Id of the decision event this one withdraws; null for a decision. */
  readonly undoes: string | null;
}

export interface ProposalTrailItem extends ProposalDecisionEntry, TrailFlags {}

/** A stored decision on either subject, told apart by `subject.kind`. */
export type AnyDecisionEntry = DecisionEntry | ProposalDecisionEntry;

const EVENT_TYPE: Readonly<Record<TransferDecisionKind, AuditEventType>> = {
  approved: 'depot-proposal-approved',
  rejected: 'depot-proposal-rejected',
  deferred: 'depot-proposal-deferred',
};

/** The change as its table cell says it: "Add 3", "Reserve 4", "Shift 6 trips". */
export function subjectChange(subject: ProposalSubject, figures: ProposalFigures = subject): string {
  return networkChangeCell(subject.proposalKind, figures.change, figures.count);
}

/** Who a proposal is about: its route, a corridor's routes, or the depot of a network kind. */
function whoOf(subject: ProposalSubject): string {
  if (subject.routeName !== null) return subject.routeName;
  if (subject.routes.length > 0) return subject.routes.join(', ');
  return subject.depotName ?? 'The network';
}

/** "KANPUR-LUCKNOW 07:00–11:00, Add 3": who, the band and the change decided on. */
export function proposalWhat(subject: ProposalSubject): string {
  return `${whoOf(subject)} ${bandLabel(subject.band)}, ${subjectChange(subject)}`;
}

function eventFor(
  record: ProposalDecisionInput,
  undoes: string | null,
  summary: string,
): NewAuditEvent {
  return {
    type: EVENT_TYPE[record.decision],
    summary,
    simulated: true,
    detail: JSON.stringify({
      v: PAYLOAD_VERSION,
      subject: record.subject,
      operatingDate: record.operatingDate,
      note: record.note,
      undoes,
    }),
  };
}

/** A decision on a proposal as an audit event, flagged model-derived like a transfer's. */
export function proposalDecisionEvent(record: ProposalDecisionInput): NewAuditEvent {
  const summary = `${VERB[record.decision]} proposal ${proposalWhat(record.subject)} (modelled)`;
  return eventFor(record, null, summary);
}

/** Withdraws a proposal decision by recording a further event of the same type. */
export function proposalUndoEvent(entry: ProposalDecisionEntry): NewAuditEvent {
  const record: ProposalDecisionInput = {
    subject: entry.subject,
    operatingDate: entry.operatingDate,
    note: entry.note,
    decision: entry.decision,
  };
  const verb = VERB[entry.decision].toLowerCase();
  return eventFor(record, entry.eventId, `Undid ${verb} proposal ${proposalWhat(entry.subject)}`);
}

/** A stored event as a proposal decision, or null when it is not one or is malformed. */
export function parseProposalDecisionEvent(event: unknown): ProposalDecisionEntry | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as Record<string, unknown>;
  const decision = kindOfType(e.type, EVENT_TYPE);
  const p = readPayload(e.detail);
  if (!decision || !p || !isString(e.id) || !isString(e.at)) return null;
  if (p.v !== PAYLOAD_VERSION || !isString(p.operatingDate) || !isString(p.note)) return null;
  if (p.undoes !== null && !isString(p.undoes)) return null;
  const subject = readProposalSubject(p.subject);
  if (subject === null) return null;
  return {
    subject,
    operatingDate: p.operatingDate,
    note: p.note,
    decision,
    eventId: e.id,
    at: e.at,
    undoes: p.undoes,
  };
}

/** A stored event as a decision on either subject, or null when it is neither. */
export function parseAnyDecisionEvent(event: unknown): AnyDecisionEntry | null {
  return parseDecisionEvent(event) ?? parseProposalDecisionEvent(event);
}
