import { isValidRouteName } from '../ids';
import type { HourBand, ProposalKind } from '../service/types';

/*
 * What a recorded decision is about. One trail holds decisions on both subjects: a
 * recommended transfer between depots, and a route's proposal for a band of hours. Each
 * page reads the subject it shows; neither is ever dispatched.
 */

export interface TransferSubject {
  readonly kind: 'transfer';
  readonly transferId: string;
}

export interface ProposalSubject {
  readonly kind: 'proposal';
  /** The proposal's deterministic id: operating date, kind, route and band. */
  readonly proposalId: string;
  readonly routeName: string;
  /** What the proposal is, so a line can name a timetable finding that moves no bus. */
  readonly proposalKind: ProposalKind;
  readonly band: HourBand;
  /** Buses to add (positive) or hold (negative) when decided; zero for a timetable finding. */
  readonly change: number;
}

export type DecisionSubject = TransferSubject | ProposalSubject;

const PROPOSAL_KINDS: ReadonlySet<string> = new Set<ProposalKind>([
  'add_buses',
  'hold_buses',
  'trips_not_run',
  'service_span_gap',
  'headway_gap',
  'revise_running_time',
]);

const LAST_HOUR = 23;
/** Ids are short hashes; anything longer is not one this module wrote. */
const MAX_ID_CHARS = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LAST_HOUR;
}

function readBand(value: unknown): HourBand | null {
  if (!isRecord(value) || !isHour(value.fromHour) || !isHour(value.toHour)) return null;
  return value.fromHour <= value.toHour ? { fromHour: value.fromHour, toHour: value.toHour } : null;
}

/** A stored proposal subject, checked field by field; null when any field is not one. */
export function readProposalSubject(value: unknown): ProposalSubject | null {
  if (!isRecord(value) || value.kind !== 'proposal') return null;
  const { proposalId, routeName, proposalKind, change } = value;
  if (typeof proposalId !== 'string' || proposalId.length === 0) return null;
  if (proposalId.length > MAX_ID_CHARS || !isValidRouteName(routeName)) return null;
  if (typeof proposalKind !== 'string' || !PROPOSAL_KINDS.has(proposalKind)) return null;
  if (typeof change !== 'number' || !Number.isInteger(change)) return null;
  const band = readBand(value.band);
  if (band === null) return null;
  return {
    kind: 'proposal',
    proposalId,
    routeName,
    proposalKind: proposalKind as ProposalKind,
    band,
    change,
  };
}

/**
 * A stored transfer payload's subject. A payload without one was written before subjects
 * existed and is a transfer; one that names a subject must name this transfer.
 */
export function readTransferSubject(value: unknown, transferId: string): TransferSubject | null {
  const subject: TransferSubject = { kind: 'transfer', transferId };
  if (value === undefined) return subject;
  if (!isRecord(value) || value.kind !== 'transfer' || value.transferId !== transferId) return null;
  return subject;
}
