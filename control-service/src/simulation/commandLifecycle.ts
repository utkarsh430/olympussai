// The command path, as a gate the simulated loop has to get an instruction
// through before a driver ever sees it.
//
// ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
//
// Every number this simulator has ever produced is the control law's INTENT.
// The laws propose a hold, the engine applies it, and nothing in between ever
// says no. Production has a whole subsystem in between: `commands` rows with a
// lifecycle (`authorized` -> `delivered` -> `acknowledged`/`executing`), a
// unique index that permits one live command per vehicle, a per-corridor cap
// on how many instructions one decision cycle may emit, a cooldown per driver,
// and a TTL that takes the instruction off the driver's screen whether or not
// they were still serving it.
//
// So a trial result was an upper bound and said so only in prose
// (`fleetTrial/run.ts#NOT_EXERCISED`). This module makes it a measurement: the
// engine now reports what the laws INTENDED and what the command path would
// actually have DELIVERED, side by side. The gap is the finding. It is not
// collapsed into one number anywhere, deliberately - a single "delivered"
// figure would destroy exactly the comparison this exists to expose.
//
// ─── EVERY LIMIT HERE IS SOURCED, AND THREE OF THEM ARE DEAD ─────────────
//
// `route_policies` carries six columns that between them describe the command
// path. Read on 2026-09-06 against the seeded control database, all 759 policy
// rows carry identical values, and they do NOT all reach code:
//
//   cooldown_seconds          60   READ by mpc/safety.ts. Enforced here.
//   max_concurrent_actions     3   READ by mpc/solver.ts. Enforced here.
//   minimum_action_seconds     0   READ by mpc/safety.ts, but seeded at 0, so
//                                  it filters nothing. Enforced here and
//                                  reported as INERT AT ITS SEEDED VALUE - the
//                                  code is live, the setting is not.
//   command_ttl_seconds      120   READ BY NO CODE IN control-service/src.
//   ack_timeout_seconds       30   READ BY NO CODE IN control-service/src.
//   retry_count                0   READ BY NO CODE IN control-service/src.
//
// The last three are DEAD COLUMNS. Anyone tuning them today changes nothing,
// and that is itself a finding an operator needs, so this module models them
// as inert and publishes them in `CommandLifecycleLedger.inertLimits` rather
// than quietly implementing what their names imply. Verify with:
//
//   grep -rn 'command_ttl_seconds\|ack_timeout_seconds\|retry_count' src/
//
// ─── SO WHERE DOES THE MODELLED TTL COME FROM? ───────────────────────────
//
// Commands DO expire in production - `db/commands.ts#lockAndExpireIfDue` flips
// any non-terminal command past `expires_at` to `expired` on every touch, and
// `getActiveDeliveredCommandForVehicle` therefore stops returning it, so the
// instruction leaves the driver's screen. But `expires_at` is
// `now() + ttl_seconds` where `ttlSeconds` came in on the REQUEST BODY, and
// the two consoles that create commands
// (`src/components/ops/control-room/ControlRoomCommandForm.tsx`,
// `.../console/EngineRecommendationPanel.tsx`) each hardcode
// `DEFAULT_TTL_SECONDS = 120`. The policy column is not consulted on that path.
//
// So 120 s is the number a real driver's screen actually runs on, and it is
// NOT read from the corridor's policy. This models it at its true provenance
// (`ui_constant`) and reports the column as dead. Both facts are true and an
// operator needs both: the effect is real, and the dial labelled with it is
// not connected to anything.
//
// ─── WHAT IS ASSUMED, NAMED AS SUCH, AND DEFAULTED TO ZERO ───────────────
//
// Nothing in this system measures how long a command takes to travel from the
// solver, through a dispatcher's approval, to a driver's screen. Inventing a
// latency would put a made-up number underneath a headline this task exists to
// make honest, so `deliveryLatencySeconds` defaults to 0: at the default, the
// only things that bite are limits with a real seeded or shipped value behind
// them. It is a knob so the sensitivity can be swept and reported SEPARATELY,
// never folded into the headline.
import type { StopVisitRecord } from './types.js';

/** Where a modelled limit's value actually comes from. Published beside every one. */
export type LimitProvenance =
  /** A column on `route_policies`, read here at its seeded value. */
  | 'route_policies'
  /** A shipped default in `control-service/src` (a constant or `config/env.ts`). */
  | 'deployed_default'
  /** A hardcoded constant in the operator console that creates the command. */
  | 'ui_constant'
  /** Nothing in this system measures it. Declared, defaulted to inert, swept separately. */
  | 'assumed';

/**
 * A limit that is configured and does nothing, with the reason it does nothing.
 *
 * Two different kinds of nothing, and they are not interchangeable:
 * `dead_column` means no code in `control-service/src` reads it at all;
 * `inert_at_seeded_value` means the code is live and the seeded value happens
 * not to exclude anything. Only the first is a wiring defect. Collapsing them
 * would tell an operator that a working guardrail is broken.
 */
export interface InertLimit {
  column: string;
  seededValue: number;
  kind: 'dead_column' | 'inert_at_seeded_value';
  note: string;
}

/** Why an instruction the control law proposed never became hold seconds a driver served. */
export type CommandBlockReason =
  /** Shorter than `route_policies.minimum_action_seconds` (`mpc/safety.ts#below_minimum_action`). */
  | 'below_minimum_action'
  /**
   * The vehicle already had a live command (`commands_one_active_per_vehicle_idx`).
   *
   * Bites for the whole TTL after an accepted instruction, not for the length
   * of the hold: nothing in this service ever writes `completed`, so an
   * accepted command sits in `executing` - inside the unique index - until it
   * expires. See `CommandPath.submit`.
   */
  | 'conflicting_active_command'
  /** This driver was instructed within `route_policies.cooldown_seconds`. */
  | 'cooldown'
  /** The corridor had already used its decision cycle's `max_concurrent_actions` budget. */
  | 'max_concurrent_actions'
  /** The instruction reached the driver, who answered `unable`/`unsafe` (`db/commands.ts#acknowledgeCommand`). */
  | 'ack_refused'
  /** Delivery took longer than the bus stood at the stop, so the instruction arrived after it left. */
  | 'arrived_after_departure';

export const COMMAND_BLOCK_REASONS: readonly CommandBlockReason[] = [
  'below_minimum_action',
  'conflicting_active_command',
  'cooldown',
  'max_concurrent_actions',
  'ack_refused',
  'arrived_after_departure',
];

/**
 * The command path's own limits, every one carrying where its value came from.
 *
 * Built by `commandLifecyclePolicyFrom` from a corridor's policy rather than
 * written out by a caller, so a trial cannot quietly run on invented limits.
 */
export interface CommandLifecyclePolicy {
  /** `route_policies.cooldown_seconds` (seeded 60). Enforced by `mpc/safety.ts` in production. */
  cooldownSeconds: number;
  /** `route_policies.minimum_action_seconds` (seeded 0). Enforced by `mpc/safety.ts` in production. */
  minimumActionSeconds: number;
  /** `route_policies.max_concurrent_actions` (seeded 3). Enforced by `mpc/solver.ts` in production. */
  maxConcurrentActions: number;
  /**
   * The window `maxConcurrentActions` is a budget for: one decision cycle.
   *
   * `config/env.ts#DECISION_CYCLE_INTERVAL_MS` ships at 90 000 ms, so 90 s.
   * The cap is per corridor per cycle (`mpc/solver.ts#selectActions`, and the
   * column's own comment), NOT a count of holds physically in progress.
   */
  decisionCycleSeconds: number;
  /**
   * How long a command survives before `lockAndExpireIfDue` takes it off the
   * driver's screen. 120 s, from the console constant - see the module header.
   * A hold longer than this is TRUNCATED, not refused.
   */
  effectiveTtlSeconds: number;
  /**
   * Seconds between the law deciding and the instruction reaching the driver.
   * ASSUMED and defaulted to 0 - nothing in this system measures it. Sweep it,
   * report it separately, never fold it into a headline.
   */
  deliveryLatencySeconds: number;
  /**
   * Whether an ACCEPTED command's slot on `commands_one_active_per_vehicle_idx`
   * is released when its ACTION finishes, rather than being held for the whole
   * TTL. Models `COMMAND_COMPLETION_SWEEP_ENABLED` (config/env.ts).
   *
   * FALSE is the default and is what the deployed service does today - in fact
   * today is WORSE than false models: nothing ever writes `completed` and
   * `control_service_expire_commands()` excludes `executing`, so a real
   * accepted command's slot is never released at all. Measured on the live
   * control database 2026-09-06: four `executing` rows, all `accept`, aged
   * 24-26 days, past their own `expires_at` by the same margin. Modelling that
   * faithfully would mean an infinite hold, which would say nothing useful
   * about a 90-minute trial, so `false` keeps the TTL bound this module has
   * always used and the honest reading of an off-trial is "at least this bad".
   *
   * TRUE releases at `min(hold length, TTL)`. The TTL still caps it: expiry
   * takes the instruction off the driver's screen mid-action, so it can only
   * ever shorten the occupancy, never extend it.
   */
  releaseSlotOnCompletion: boolean;
}

/** What the command path did with one proposal. */
export interface CommandDecision {
  /** Hold seconds that reached the driver. 0 when the path refused the instruction. */
  deliveredHoldSeconds: number;
  /** Null when the instruction was served; otherwise why it was not. */
  blockedBy: CommandBlockReason | null;
  /** True when the TTL cut the hold short of what the law asked for. */
  truncatedByExpiry: boolean;
}

/**
 * Intent and delivery, counted separately at every step.
 *
 * Read `intendedHoldSeconds` against `deliveredHoldSeconds` against
 * `servedHoldSeconds`: what the law asked for, what the command path let
 * through, and what a driver actually stood for. Three numbers, because the
 * three losses have three different owners - the control law, the command
 * path, and the driver - and an operator can only act on the one that is
 * theirs.
 */
export interface CommandLifecycleLedger {
  policy: CommandLifecyclePolicy;
  /** Hold instructions the control laws proposed (non-zero, at a control point). */
  proposals: number;
  /** Sum of what they proposed, seconds. THE INTENT. */
  intendedHoldSeconds: number;
  /** Proposals that became an instruction on a driver's screen. */
  issued: number;
  /** Sum of hold seconds that reached a driver, after every command-path limit. */
  deliveredHoldSeconds: number;
  /** Sum of hold seconds a driver actually stood for. Driver behaviour on top of delivery. */
  servedHoldSeconds: number;
  /** Instructions a driver accepted (`ack_outcome = 'accept'`). */
  acknowledged: number;
  /** Instructions the TTL cut short of the delivered length. */
  truncatedByExpiry: number;
  /** How many proposals each limit refused. */
  blockedBy: Record<CommandBlockReason, number>;
  /** Intended hold seconds each limit refused. The same losses, priced. */
  holdSecondsLostTo: Record<CommandBlockReason, number>;
  /** Configured limits that do nothing, and why. See `InertLimit`. */
  inertLimits: InertLimit[];
}

/**
 * `route_policies.max_concurrent_actions`, seeded 3 on all 759 rows and
 * matching `mpc/solver.ts#DEFAULT_MAX_CONCURRENT_ACTIONS`.
 *
 * Not carried on the corridor spec the fleet trial builds, so it is named here
 * rather than invented at a call site. Verified by direct read of the seeded
 * control database on 2026-09-06.
 */
export const SEEDED_MAX_CONCURRENT_ACTIONS = 3;

/**
 * One decision cycle, seconds. `config/env.ts#DECISION_CYCLE_INTERVAL_MS`
 * ships at 90 000 ms, and that is the window `max_concurrent_actions` is a
 * budget for (`mpc/solver.ts#selectActions`).
 */
export const DEPLOYED_DECISION_CYCLE_SECONDS = 90;

/**
 * The TTL a real command actually runs on: 120 s.
 *
 * NOT `route_policies.command_ttl_seconds`, which is a dead column - see the
 * module header. This is `DEFAULT_TTL_SECONDS` from the two operator consoles
 * that create commands, which is what lands in `commands.ttl_seconds` and
 * therefore what `db/commands.ts#lockAndExpireIfDue` expires against.
 */
export const CONSOLE_DEFAULT_TTL_SECONDS = 120;

/**
 * Build the command path's limits from a corridor's own policy.
 *
 * Exists so a caller cannot quietly run a trial on invented limits: the two
 * values that vary per corridor come from the corridor, and the three that do
 * not are the named constants above, each carrying where its value came from.
 * `deliveryLatencySeconds` is the one thing nothing measures, and it defaults
 * to 0 - see the module header for why that is the honest default rather than
 * a timid one.
 */
export function commandLifecyclePolicyFrom(
  policy: { cooldownSeconds: number; minimumActionSeconds: number },
  overrides: Partial<CommandLifecyclePolicy> = {},
): CommandLifecyclePolicy {
  return {
    cooldownSeconds: policy.cooldownSeconds,
    minimumActionSeconds: policy.minimumActionSeconds,
    maxConcurrentActions: SEEDED_MAX_CONCURRENT_ACTIONS,
    decisionCycleSeconds: DEPLOYED_DECISION_CYCLE_SECONDS,
    effectiveTtlSeconds: CONSOLE_DEFAULT_TTL_SECONDS,
    deliveryLatencySeconds: 0,
    releaseSlotOnCompletion: false,
    ...overrides,
  };
}

/** Where each of this policy's limits got its value. Published with the ledger so no figure rests on an unsourced number. */
export function limitProvenance(): Record<keyof CommandLifecyclePolicy, LimitProvenance> {
  return {
    cooldownSeconds: 'route_policies',
    minimumActionSeconds: 'route_policies',
    maxConcurrentActions: 'route_policies',
    decisionCycleSeconds: 'deployed_default',
    effectiveTtlSeconds: 'ui_constant',
    deliveryLatencySeconds: 'assumed',
    releaseSlotOnCompletion: 'deployed_default',
  };
}

/** The three columns no code in `control-service/src` reads, and the one seeded to filter nothing. */
export function inertLimitsFor(policy: CommandLifecyclePolicy): InertLimit[] {
  const inert: InertLimit[] = [
    {
      column: 'route_policies.command_ttl_seconds',
      seededValue: 120,
      kind: 'dead_column',
      note:
        'Seeded 120 on all 759 policies and read by no code in control-service/src. A command\'s expiry is now() + the ttlSeconds on the CREATE REQUEST, and both consoles that create commands hardcode DEFAULT_TTL_SECONDS = 120. Commands do expire; this column is not what expires them, so changing it changes nothing.',
    },
    {
      column: 'route_policies.ack_timeout_seconds',
      seededValue: 30,
      kind: 'dead_column',
      note:
        'Seeded 30 on all 759 policies and read by no code in control-service/src. There is no acknowledgement timeout anywhere: a delivered command with no ack simply sits until its TTL expires it, so the effective ack deadline is the TTL and not this. Modelled as inert.',
    },
    {
      column: 'route_policies.retry_count',
      seededValue: 0,
      kind: 'dead_column',
      note:
        'Seeded 0 on all 759 policies and read by no code in control-service/src. Redelivery is done by commandDeliverySweep, which re-attempts every command resting in `authorized` and is not keyed to this column. Modelled as inert.',
    },
  ];
  // ─── AND A FOURTH, WHICH ONLY SHOWS UP ONCE BOTH ARE IN THE LOOP ───────
  //
  // `cooldown_seconds` is 60 and the effective TTL is 120. An ACCEPTED command
  // holds its vehicle's slot on `commands_one_active_per_vehicle_idx` for the
  // whole TTL (nothing ever writes `completed`), so by the time the unique
  // index lets a second instruction through, twice the cooldown has already
  // passed and the cooldown cannot refuse anything the index did not refuse
  // first. It is reachable only after a REFUSED command, whose `failed` status
  // is terminal and frees the slot at once.
  //
  // Neither column is wrong on its own; the two together mean the dial an
  // operator would reach for to space instructions out is dominated by an
  // unrelated one. Raising `cooldown_seconds` above the TTL is what would give
  // it effect, and nothing today says so.
  //
  // ONCE THE SLOT IS RELEASED ON COMPLETION, THIS NOTE STOPS BEING TRUE, so
  // the entry has to go. The note's whole content is "the unique index
  // dominates the cooldown, raise it above the TTL to give it effect" - and
  // with the slot released for the length of the action instead of the TTL,
  // that domination argument no longer holds. Publishing it anyway would tell
  // an operator to tune a dial on reasoning that had stopped applying.
  //
  // Dropping it is NOT a claim that the cooldown now bites. MEASURED, it does
  // not: zero cooldown refusals on every preset with this flag either way, and
  // still zero at 1 000 buses/phase on urban where the index itself only
  // refuses 4 of 9 072 proposals. See docs/COMMAND_COMPLETION.md section 3.
  if (!policy.releaseSlotOnCompletion && policy.cooldownSeconds <= policy.effectiveTtlSeconds) {
    inert.push({
      column: 'route_policies.cooldown_seconds',
      seededValue: policy.cooldownSeconds,
      kind: 'inert_at_seeded_value',
      note:
        'mpc/safety.ts reads this and it is enforced here, but at the seeded 60 s it is DOMINATED by the one-active-command constraint: an accepted command holds the vehicle`s slot on commands_one_active_per_vehicle_idx for the full 120 s TTL, because no code in control-service/src ever writes `completed`. The cooldown can therefore only refuse an instruction that follows a driver REFUSAL, whose terminal `failed` status frees the slot early. Raise it above the effective TTL to give it effect.',
    });
  }

  if (policy.minimumActionSeconds <= 0) {
    inert.push({
      column: 'route_policies.minimum_action_seconds',
      seededValue: policy.minimumActionSeconds,
      kind: 'inert_at_seeded_value',
      note:
        'mpc/safety.ts DOES read this and rejects a hold below it as `below_minimum_action`. It is seeded at 0 on all 759 policies, so it excludes nothing. The code is live; the setting is not. This is a tuning gap, not a wiring defect - the distinction the `kind` field carries.',
    });
  }
  return inert;
}

function zeroed(): Record<CommandBlockReason, number> {
  return {
    below_minimum_action: 0,
    conflicting_active_command: 0,
    cooldown: 0,
    max_concurrent_actions: 0,
    ack_refused: 0,
    arrived_after_departure: 0,
  };
}

/**
 * The command path for one corridor, one run.
 *
 * Stateful and single-clock: the engine advances every vehicle on ONE clock
 * (`engine.ts`), so `atSeconds` here is monotone enough for a cooldown and a
 * per-cycle budget to mean what they mean in production. Never share one of
 * these between two arms of a trial - the uncontrolled arm issues nothing, and
 * a shared gate would let the controlled arm's cooldowns leak into it.
 */
export class CommandPath {
  private readonly lastCommandedAt = new Map<string, number>();
  /** Vehicle -> the second its current command stops being non-terminal. */
  private readonly activeUntil = new Map<string, number>();
  /** Decision-cycle bucket -> commands already issued into it corridor-wide. */
  private readonly issuedInCycle = new Map<number, number>();
  private readonly ledger: CommandLifecycleLedger;

  constructor(policy: CommandLifecyclePolicy) {
    this.ledger = {
      policy,
      proposals: 0,
      intendedHoldSeconds: 0,
      issued: 0,
      deliveredHoldSeconds: 0,
      servedHoldSeconds: 0,
      acknowledged: 0,
      truncatedByExpiry: 0,
      blockedBy: zeroed(),
      holdSecondsLostTo: zeroed(),
      inertLimits: inertLimitsFor(policy),
    };
  }

  /**
   * Put one proposed hold through the command path, in the order production
   * applies its limits: the hard safety filter (`mpc/safety.ts`) first, then
   * the solver's per-cycle cap (`mpc/solver.ts`), then delivery, then the
   * driver's acknowledgement, then the TTL.
   *
   * `acceptsInstruction` is drawn by the ENGINE, from the same
   * `non_compliance` disturbance and the same RNG stream it always used, and
   * passed in rather than drawn here. Two reasons: the draw is keyed per
   * (seed, purpose, vehicle, stop) so skipping it on a refused command cannot
   * shift anybody else's stream, and driver behaviour is not a command-path
   * limit - keeping it out of this class is what lets the report separate what
   * the control room refused from what the driver did.
   */
  submit(args: {
    vehicleId: string;
    atSeconds: number;
    intendedHoldSeconds: number;
    /** When the bus would leave absent any hold. An instruction arriving after this missed it. */
    readyToDepartSeconds: number;
    acceptsInstruction: boolean;
  }): CommandDecision {
    const { vehicleId, atSeconds, intendedHoldSeconds, readyToDepartSeconds, acceptsInstruction } = args;
    const p = this.ledger.policy;

    this.ledger.proposals += 1;
    this.ledger.intendedHoldSeconds += intendedHoldSeconds;

    const refuse = (reason: CommandBlockReason): CommandDecision => {
      this.ledger.blockedBy[reason] += 1;
      this.ledger.holdSecondsLostTo[reason] += intendedHoldSeconds;
      return { deliveredHoldSeconds: 0, blockedBy: reason, truncatedByExpiry: false };
    };

    // ── mpc/safety.ts, in its own order ──
    if (intendedHoldSeconds < p.minimumActionSeconds) return refuse('below_minimum_action');

    // `commands_one_active_per_vehicle_idx`: a UNIQUE index on vehicle_id over
    // every non-terminal status. The insert does not lose a race, it fails.
    const activeUntil = this.activeUntil.get(vehicleId);
    if (activeUntil !== undefined && activeUntil > atSeconds) {
      return refuse('conflicting_active_command');
    }

    const lastAt = this.lastCommandedAt.get(vehicleId);
    if (lastAt !== undefined && atSeconds - lastAt < p.cooldownSeconds) return refuse('cooldown');

    // ── mpc/solver.ts: at most `max_concurrent_actions` per corridor per cycle ──
    const cycle = Math.floor(atSeconds / p.decisionCycleSeconds);
    const usedThisCycle = this.issuedInCycle.get(cycle) ?? 0;
    if (usedThisCycle >= p.maxConcurrentActions) return refuse('max_concurrent_actions');

    // ── Delivery. An instruction that arrives after the bus has pulled out
    // cannot be served, however willing the driver. Inert at the default
    // latency of 0; see the module header for why that default is 0.
    const arrivesAtSeconds = atSeconds + p.deliveryLatencySeconds;
    if (arrivesAtSeconds > readyToDepartSeconds) return refuse('arrived_after_departure');

    // The command is now live for this vehicle whatever the driver says: the
    // row exists, it holds the unique index, and it starts the cooldown. A
    // refusal ends it at `failed` (db/commands.ts#acknowledgeCommand) rather
    // than never having happened.
    this.issuedInCycle.set(cycle, usedThisCycle + 1);
    this.lastCommandedAt.set(vehicleId, atSeconds);

    if (!acceptsInstruction) {
      // `unable`/`unsafe` ends the command at `failed`, which is terminal and
      // outside the unique index - so unlike an accepted one, a refused
      // instruction frees the vehicle's slot immediately. Only the cooldown,
      // set above, still applies.
      this.activeUntil.set(vehicleId, atSeconds);
      return refuse('ack_refused');
    }

    this.ledger.acknowledged += 1;

    // ── TTL. `lockAndExpireIfDue` expires a command that is still `executing`
    // just as readily as one that is merely `delivered`, and
    // `getActiveDeliveredCommandForVehicle` then returns null - the
    // instruction leaves the driver's screen mid-hold. So the TTL TRUNCATES a
    // long hold rather than refusing it. It bites wherever a corridor's
    // maxHoldSeconds exceeds the TTL: 600 s inter-city and 240 s suburban
    // against 120 s, and not at all on urban, whose cap is exactly 120.
    const ttlRemaining = Math.max(0, p.effectiveTtlSeconds - p.deliveryLatencySeconds);
    const deliveredHoldSeconds = Math.min(intendedHoldSeconds, ttlRemaining);
    const truncatedByExpiry = deliveredHoldSeconds < intendedHoldSeconds;
    if (truncatedByExpiry) this.ledger.truncatedByExpiry += 1;

    this.ledger.issued += 1;
    this.ledger.deliveredHoldSeconds += deliveredHoldSeconds;
    // ─── HOW LONG THE SLOT IS HELD ─────────────────────────────────────────
    //
    // OFF (default, and what the deployed service does): for the whole TTL.
    // `executing` is in `commands_one_active_per_vehicle_idx` and nothing in
    // control-service/src ever writes `completed`, so an accepted command has
    // no terminal success state to leave `executing` by. A bus that took a
    // twenty-second hold still holds its slot for the full 120 s.
    //
    // That understates the real defect and does so deliberately. In production
    // `control_service_expire_commands()` EXCLUDES `executing`, so the TTL
    // sweep cannot free it either and the slot is held indefinitely - measured
    // on the live control database 2026-09-06, four `executing` rows aged
    // 24-26 days, every one `ack_outcome = 'accept'`, all long past their own
    // `expires_at`. An unbounded hold would make a 90-minute trial say nothing,
    // so this keeps the TTL bound and an off-trial reads as a LOWER bound on
    // the harm.
    //
    // ON (COMMAND_COMPLETION_SWEEP_ENABLED): for the length of the ACTION,
    // capped at the TTL, matching control_service_complete_finished_commands().
    // The cap is not a detail - expiry takes the instruction off the driver's
    // screen mid-action, so it can only shorten the occupancy.
    const slotHeldSeconds = p.releaseSlotOnCompletion
      ? Math.min(deliveredHoldSeconds, p.effectiveTtlSeconds)
      : p.effectiveTtlSeconds;
    this.activeUntil.set(vehicleId, atSeconds + slotHeldSeconds);

    return { deliveredHoldSeconds, blockedBy: null, truncatedByExpiry };
  }

  /** What the driver actually stood for, once the engine has applied their compliance fraction. */
  recordServed(seconds: number): void {
    this.ledger.servedHoldSeconds += seconds;
  }

  /** The run's ledger. Read-only by convention; the engine hands it straight to the caller. */
  result(): CommandLifecycleLedger {
    return this.ledger;
  }
}

/**
 * Every hold second the laws intended, what the command path delivered, and
 * what the drivers served - summed over a set of visits.
 *
 * Separate from `CommandLifecycleLedger` because it is derivable from the
 * VISITS alone, so it works on a run with no command path modelled at all. On
 * such a run `deliveredHoldSeconds` equals `intendedHoldSeconds` by
 * construction, which is the honest statement of "the command path was not in
 * this loop" rather than a claim that it delivered everything.
 */
export interface HoldSecondsRollup {
  intendedHoldSeconds: number;
  deliveredHoldSeconds: number;
  servedHoldSeconds: number;
}

export function rollUpHoldSeconds(visits: readonly StopVisitRecord[]): HoldSecondsRollup {
  let intendedHoldSeconds = 0;
  let deliveredHoldSeconds = 0;
  let servedHoldSeconds = 0;
  for (const visit of visits) {
    if (visit.intendedHoldSeconds <= 0) continue;
    intendedHoldSeconds += visit.intendedHoldSeconds;
    deliveredHoldSeconds += visit.deliveredHoldSeconds ?? visit.intendedHoldSeconds;
    servedHoldSeconds += visit.appliedHoldSeconds;
  }
  return { intendedHoldSeconds, deliveredHoldSeconds, servedHoldSeconds };
}
