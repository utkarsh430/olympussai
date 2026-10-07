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
  /** The route; null for a network kind that names none (a depot's reserve, a corridor). */
  readonly routeName: string | null;
  /** A corridor's routes, or the route's own name alone; empty when none is named. */
  readonly routes: readonly string[];
  /** The depot a network kind is about; null for a route's own proposal. */
  readonly depotName: string | null;
  /** What the proposal is, so a line can name a timetable finding that moves no bus. */
  readonly proposalKind: ProposalKind;
  readonly band: HourBand;
  /** Buses to add (positive) or hold (negative) when decided; zero for a timetable finding. */
  readonly change: number;
  /** A network kind's figure when decided (buses in reserve, trips movable); null otherwise. */
  readonly count: number | null;
}

export type DecisionSubject = TransferSubject | ProposalSubject;

/** What a decision on a proposal was made for: the change and, for a network kind, its figure. */
export interface ProposalFigures {
  readonly change: number;
  readonly count: number | null;
}

/** Whether a decision was made for the figures the proposal now shows. */
export function sameFigures(subject: ProposalSubject, figures: ProposalFigures): boolean {
  return subject.change === figures.change && subject.count === figures.count;
}

const PROPOSAL_KINDS: ReadonlySet<string> = new Set<ProposalKind>([
  'add_buses',
  'hold_buses',
  'trips_not_run',
  'service_span_gap',
  'headway_gap',
  'revise_running_time',
  'reserve_by_hour',
  'maintenance_window',
  'shift_departures',
  'corridor_over_served',
  'corridor_under_served',
]);

const LAST_HOUR = 23;
/** Ids are short hashes; anything longer is not one this module wrote. */
const MAX_ID_CHARS = 128;
/** A corridor's routes are a handful; a depot's name is a short place name. */
const MAX_ROUTES = 32;
const MAX_NAME_CHARS = 120;

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

/** A stored route list: absent is none; anything but a short list of route names is refused. */
function readRoutes(value: unknown): readonly string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ROUTES) return null;
  return value.every(isValidRouteName) ? [...value] : null;
}

/** An optional field stored as null, a value that passes `check`, or absent (null). */
function readOptional<T>(value: unknown, check: (v: unknown) => v is T): T | null | undefined {
  if (value === undefined || value === null) return null;
  return check(value) ? value : undefined;
}

const isName = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME_CHARS;
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * A stored proposal subject, checked field by field; null when any field is not one. The
 * route, routes, depot and count were added for the network kinds and read as none when
 * absent.
 */
export function readProposalSubject(value: unknown): ProposalSubject | null {
  if (!isRecord(value) || value.kind !== 'proposal') return null;
  const { proposalId, proposalKind, change } = value;
  if (typeof proposalId !== 'string' || proposalId.length === 0) return null;
  if (proposalId.length > MAX_ID_CHARS) return null;
  if (typeof proposalKind !== 'string' || !PROPOSAL_KINDS.has(proposalKind)) return null;
  if (!isWhole(change)) return null;
  const routeName = readOptional(value.routeName, isValidRouteName);
  const depotName = readOptional(value.depotName, isName);
  const count = readOptional(value.count, isWhole);
  const routes = readRoutes(value.routes);
  const band = readBand(value.band);
  if (routeName === undefined || depotName === undefined || count === undefined) return null;
  if (routes === null || band === null) return null;
  return {
    kind: 'proposal',
    proposalId,
    routeName,
    routes,
    depotName,
    proposalKind: proposalKind as ProposalKind,
    band,
    change,
    count,
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
