/**
 * The words this console uses for the values it receives.
 *
 * ─── WHY THIS IS A MODULE AND NOT A CONVENTION ───────────────────────────
 *
 * Before this file the product had three separate places that turned an enum
 * into words (`ACTION_LABEL` in recommendationView, `ACTION_LABELS` in
 * commandCopy, `STOP_STATE_LABEL` inside a table component) and about a dozen
 * places that rendered an enum RAW — `endogenous`, `mitigable`,
 * `rollout_stage_violation`, `dwelling_at_stop` — straight onto a screen read
 * by UPSRTC operations staff for whom English is often a second language. It
 * also had two names for one object: `corridor` and `route-direction`, both on
 * screen at once, which is exactly what happens when naming is a per-component
 * decision.
 *
 * So naming is decided here, once, and asserted in
 * src/tests/unit/opsVocabulary.test.ts.
 *
 * ─── THE RULE THIS FILE EXISTS TO KEEP ───────────────────────────────────
 *
 * SIMPLIFY THE VOCABULARY, NEVER THE MEANING.
 *
 * Some labels below are longer than the enum they replace. That is not an
 * oversight. "mitigable" is one word and means nothing to a reader; "the
 * control room can reduce it, not fix it" is seven and is the actual claim.
 * Where a term is genuinely load-bearing and has no plain synonym — CV,
 * excess wait — the term is KEPT and a gloss is attached, because renaming it
 * to something friendlier ("regularity %") would name a different statistic.
 *
 * Anything not in a map here falls through `humaniseEnum`, which is a
 * last-resort readability pass and NOT a translation. It exists so a value
 * this file has never seen degrades to `rollout stage violation` rather than
 * to a crash or a blank, and callers that can say something better should.
 */
import type {
  CauseClass,
  Compliance,
  Controllability,
  IncidentSeverity,
  IncidentStatus,
  StopState,
} from '@/models/control';

/* ─────────────────────────────────────────────────────────────────────────
   THE FALLBACK
   ───────────────────────────────────────────────────────────────────────── */

/**
 * A snake_case value, made readable, for a value no map here covers.
 *
 * The `g` flag is load-bearing and is the reason this is a function rather
 * than an inline `.replace('_', ' ')` at each call site. Without it only the
 * FIRST underscore is replaced, so `od_timetable` renders as `od timetable`
 * and `rollout_stage_violation` as `rollout stage violation` — a bug that
 * shipped on the simulator and read as deliberate wording rather than as a
 * defect. See §4.4 of the language audit.
 */
export function humaniseEnum(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim();
  if (spaced.length === 0) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** `humaniseEnum` for a value that sits mid-sentence, so it is not capitalised. */
export function humaniseEnumInline(value: string): string {
  return value.replace(/_/g, ' ').trim() || value;
}

/* ─────────────────────────────────────────────────────────────────────────
   THE OBJECT THE WHOLE CONSOLE IS ABOUT
   ───────────────────────────────────────────────────────────────────────── */

/**
 * "Corridor", and deliberately never "route".
 *
 * A corridor is ONE route in ONE direction. The network has 759 mapped
 * corridors drawn from roughly 380 routes, so calling a corridor a route
 * halves every count the product prints and breaks the "198 of 759" sentence
 * the console is built around. The word is kept and glossed instead.
 */
export const CORRIDOR_GLOSS = 'one route, one direction';

/**
 * Direction codes as the seeded network actually uses them.
 *
 * Measured against the live control database rather than assumed: OUT (666),
 * SINGLE (85), UP (17), IN (8). An unknown code is returned VERBATIM — this
 * console would rather show an operator a code it cannot expand than invent a
 * direction for it.
 */
const DIRECTION_LABEL: Record<string, string> = {
  OUT: 'outbound',
  IN: 'inbound',
  UP: 'up',
  DOWN: 'down',
  SINGLE: 'single direction',
};

export function directionLabel(code: string): string {
  return DIRECTION_LABEL[code.toUpperCase()] ?? code;
}

/**
 * How a corridor is named everywhere on this console: "1002 outbound".
 *
 * One function so the picker, the page subtitle, the kill-switch list and the
 * engine panel cannot drift into three spellings of the same corridor.
 */
export function corridorName(meta: {
  routeId: string;
  directionCode: string;
  isLoop?: boolean;
}): string {
  const base = `${meta.routeId} ${directionLabel(meta.directionCode)}`;
  return meta.isLoop ? `${base} (loop)` : base;
}

/* ─────────────────────────────────────────────────────────────────────────
   MEASUREMENTS
   ───────────────────────────────────────────────────────────────────────── */

/**
 * The four spacing figures, named and glossed identically on the console band
 * and on the observability page.
 *
 * Two of these keep a technical term on purpose:
 *
 *   CV — kept, because "regularity %" is a DIFFERENT statistic and would be a
 *        false rename. The label carries the plain reading and the hint gives
 *        the two anchors an operator needs, without implying the 0.50 mark
 *        gates anything (it colours a tile; the real thresholds live in
 *        route_policies and are applied by the detector).
 *   Extra wait — kept as "extra", because dropping the word turns it into
 *        total passenger wait, which is not what the number is.
 */
export const METRIC = {
  targetHeadway: {
    label: 'Planned gap',
    hint: 'the spacing this corridor is meant to run at',
  },
  meanHeadway: {
    label: 'Average gap',
    hint: 'measured between buses in front of and behind each other',
  },
  cv: {
    label: 'Gap consistency (CV)',
    hint: '0.00 = perfectly even spacing. 0.50 or more counts as irregular.',
    /**
     * The same anchor, short enough for a console tile.
     *
     * A tile hint sets that tile's column width and is truncated, so the full
     * sentence above cannot go there. Two strings rather than one wrapped
     * string, because a silently clipped explanation is worse than a brief one.
     */
    tileHint: '0.50 or more is irregular',
  },
  excessWait: {
    label: 'Extra wait for passengers',
    hint: 'average extra time a passenger waits beyond the planned gap',
  },
} as const;

/* ─────────────────────────────────────────────────────────────────────────
   WHAT A BUS IS DOING
   ───────────────────────────────────────────────────────────────────────── */

export const STOP_STATE_LABEL: Record<StopState, string> = {
  approaching_stop: 'Approaching a stop',
  dwelling_at_stop: 'Waiting at stop',
  held_by_controller: 'Held on instruction',
  stopped_in_traffic: 'Stopped in traffic',
  departed_stop: 'Just left a stop',
  off_route: 'Not on its route',
};

export function stopStateLabel(value: string): string {
  return STOP_STATE_LABEL[value as StopState] ?? humaniseEnum(value);
}

/* ─────────────────────────────────────────────────────────────────────────
   BUNCHING INCIDENTS
   ───────────────────────────────────────────────────────────────────────── */

/**
 * The academic cause taxonomy, glossed.
 *
 * These four words reached an operator's screen with no explanation anywhere
 * in the product. They are kept as data and never shown raw again.
 */
export const CAUSE_CLASS_LABEL: Record<CauseClass, string> = {
  endogenous: 'Caused by the service itself (bunching feeds itself)',
  exogenous: 'Caused by something outside the service, such as traffic',
  structural: 'Built into the timetable or the road',
  unknown: 'Cause not established',
};

export function causeClassLabel(value: string): string {
  return CAUSE_CLASS_LABEL[value as CauseClass] ?? humaniseEnum(value);
}

/**
 * What the control room can actually do about it.
 *
 * `none` is worded as a fact about this room's levers, not as "nothing can be
 * done": another team may well be able to act on it.
 */
export const CONTROLLABILITY_LABEL: Record<Controllability, string> = {
  controllable: 'The control room can fix this',
  mitigable: 'The control room can reduce it, not fix it',
  structural: 'Cannot be fixed from the control room',
  none: 'Nothing the control room can do',
};

export function controllabilityLabel(value: string): string {
  return CONTROLLABILITY_LABEL[value as Controllability] ?? humaniseEnum(value);
}

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  open: 'Open',
  mitigating: 'Being worked on',
  recovering: 'Recovering',
  closed: 'Closed',
  escalated: 'Escalated',
};

export function incidentStatusLabel(value: string): string {
  return INCIDENT_STATUS_LABEL[value as IncidentStatus] ?? humaniseEnum(value);
}

export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  warning: 'Closing up',
  bunched: 'Bunched',
  severe: 'Severe',
};

export function incidentSeverityLabel(value: string): string {
  return INCIDENT_SEVERITY_LABEL[value as IncidentSeverity] ?? humaniseEnum(value);
}

/**
 * Which bus is which, in the words a driver or operator would use.
 *
 * "leader" and "follower" are correct and are also the two words most likely
 * to be read backwards at speed. "in front" and "behind" cannot be.
 */
export const INCIDENT_ROLE_LABEL: Record<string, string> = {
  leader: 'in front',
  follower: 'behind',
  platoon_member: 'in the group',
};

export function incidentRoleLabel(value: string): string {
  return INCIDENT_ROLE_LABEL[value] ?? humaniseEnumInline(value);
}

/* ─────────────────────────────────────────────────────────────────────────
   SAFETY RULES
   ───────────────────────────────────────────────────────────────────────── */

/**
 * "Blocked by a safety rule", never "guardrail breach".
 *
 * A breach reads as something that got through. These rows are the opposite:
 * each one is an action the system REFUSED. Wording them as damage would have
 * an operator hunting for a consequence that does not exist.
 */
export const SAFETY_BLOCK_LABEL = 'Blocked by a safety rule';
export const SAFETY_BLOCK_HINT = 'times the system refused an action because a safety rule said no';

/**
 * `breach_type` is a free-text column in control-service, so this map is a
 * best-effort and the fallback is the contract. Only
 * `rollout_stage_violation` is written today (control-service/src/pilot/
 * gate.ts); anything else degrades through `humaniseEnum` rather than being
 * described as something this console has not seen.
 */
export const SAFETY_BLOCK_TYPE_LABEL: Record<string, string> = {
  rollout_stage_violation:
    'An instruction was tried on a corridor that is not allowed to send instructions',
  max_hold_cap_breach: 'A hold longer than this corridor allows was tried',
  ttl_exceeded: 'An instruction was acted on after it had expired',
  conflicting_active_command: 'A second instruction was tried on a bus that already had one',
};

export function safetyBlockTypeLabel(value: string): string {
  return SAFETY_BLOCK_TYPE_LABEL[value] ?? humaniseEnum(value);
}

export const SAFETY_BLOCK_SEVERITY_LABEL: Record<string, string> = {
  info: 'For information',
  warning: 'Warning',
  critical: 'Serious',
};

export function safetyBlockSeverityLabel(value: string): string {
  return SAFETY_BLOCK_SEVERITY_LABEL[value] ?? humaniseEnum(value);
}

/* ─────────────────────────────────────────────────────────────────────────
   INSTRUCTIONS AND THEIR LIFECYCLE
   ───────────────────────────────────────────────────────────────────────── */

/**
 * "Instruction", not "command".
 *
 * The whole product's noun for the thing a control room sends a driver. It is
 * kept singular and consistent here because the previous copy used "command",
 * "action" and "dispatch" for the same object on three adjacent panels.
 */
export const COMMAND_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting to be sent',
  authorized: 'Approved, not sent yet',
  delivered: "On the driver's screen",
  acknowledged: 'The driver has answered',
  expired: 'Expired before it was answered',
  cancelled: 'Cancelled',
  superseded: 'Replaced by a later instruction',
  failed: 'Could not be sent',
};

export function commandStatusLabel(value: string): string {
  return COMMAND_STATUS_LABEL[value] ?? humaniseEnum(value);
}

/**
 * The driver's three answers.
 *
 * None of them is a failure and the wording must not imply one — the driver
 * console tells drivers in as many words that "can't do it" and "not safe"
 * carry no penalty, and the control room's vocabulary has to agree with the
 * promise made at the wheel.
 */
export const ACK_OUTCOME_LABEL: Record<string, string> = {
  accept: 'Doing it',
  unable: 'Cannot do it',
  unsafe: 'Not safe to do',
};

export function ackOutcomeLabel(value: string): string {
  return ACK_OUTCOME_LABEL[value] ?? humaniseEnum(value);
}

export const COMPLIANCE_LABEL: Record<Compliance, string> = {
  complied: 'Followed in full',
  partial: 'Followed in part',
  unable: 'Driver could not',
  unsafe: 'Driver judged it unsafe',
  no_response: 'No answer from the driver',
};

export function complianceLabel(value: string): string {
  return COMPLIANCE_LABEL[value as Compliance] ?? humaniseEnum(value);
}

/**
 * What an audit-log event type says it is.
 *
 * The lookup panel used to print `command_delivery_failed` at an operator.
 * Free-text upstream, so the fallback is again the contract.
 */
export const COMMAND_AUDIT_EVENT_LABEL: Record<string, string> = {
  command_created: 'Instruction created',
  command_authorized: 'Approved',
  command_delivered: "Reached the driver's screen",
  command_acknowledged: 'Driver answered',
  command_expired: 'Expired',
  command_cancelled: 'Cancelled',
  command_superseded: 'Replaced by a later instruction',
  command_delivery_failed: 'Could not be delivered',
  command_delivery_retried: 'Delivery tried again',
};

export function commandAuditEventLabel(value: string): string {
  return COMMAND_AUDIT_EVENT_LABEL[value] ?? humaniseEnum(value);
}

/* ─────────────────────────────────────────────────────────────────────────
   STOPPING INSTRUCTIONS ("kill switch")
   ───────────────────────────────────────────────────────────────────────── */

/**
 * "Kill switch" retired from every operator-facing string.
 *
 * Two reasons, and the second is the one that matters. It is jargon; and it
 * OVERSTATES what the control does. Engaging it halts NEW instructions —
 * instructions already issued still stand and a driver may still be acting on
 * one. "Stop all instructions" would be a stronger claim than the system can
 * make, so the wording is "stop new instructions" throughout.
 *
 * Kept as one exported vocabulary so the banner, the panel, the tab and the
 * status band cannot drift.
 */
export const STOP_INSTRUCTIONS = {
  /** The control, as a heading. */
  title: 'Stop new instructions',
  /** What it does, in one sentence, with the limit stated. */
  gloss:
    'Stops any new instruction being sent, across the whole state or on one corridor. Instructions already sent still stand.',
  engageAction: 'Stop instructions',
  engagePending: 'Stopping…',
  releaseAction: 'Allow instructions again',
  releasePending: 'Turning off…',
  scopeNetwork: 'Whole state',
  scopeRoute: 'One corridor',
} as const;

/* ─────────────────────────────────────────────────────────────────────────
   COMMAND PERMISSION ("rollout stage")
   ───────────────────────────────────────────────────────────────────────── */

/**
 * What a corridor is allowed to do. Read-only on this console — the setting
 * is an admin action; the control room only reports it.
 */
export const COMMAND_PERMISSION_LABEL: Record<string, string> = {
  observation: 'Watch only',
  shadow: 'Watch and suggest (nothing sent)',
  advisory: 'Instructions allowed, each needs approval',
  limited_auto: 'Instructions allowed, narrower automatic band',
  expanded: 'Instructions allowed, full band',
};

export function commandPermissionLabel(value: string): string {
  return COMMAND_PERMISSION_LABEL[value] ?? humaniseEnum(value);
}
