/**
 * What the admin console's overview says, as a pure function of what it was
 * able to read.
 *
 * ─── WHY THE MODEL IS SEPARATE FROM THE PAGE ─────────────────────────────
 *
 * Every number on this screen is a claim about a control this admin is
 * responsible for — how many people hold operational access, how many
 * corridors will accept a command, whether the two role stores agree. Those
 * are exactly the numbers where a confident zero during an outage is worse
 * than no number at all: "0 corridors permit commands" reads as a safe,
 * locked-down network, and it is what a dead control service produces.
 *
 * So this module never sees an upstream. It is handed FACTS THAT CARRY THEIR
 * OWN PROVENANCE (`ok: false` when the source did not answer), and it renders
 * every tile through `consoleReadings`, whose whole job is to keep "nothing to
 * report" and "I cannot see" from collapsing into the same dash. The control
 * room made this decision first (src/lib/ops/controlRoomOverviewModel.ts) and
 * the reasoning is identical; the admin console reuses the vocabulary rather
 * than inventing a second one.
 *
 * It is also, being pure, the part that can actually be tested — see
 * src/tests/unit/adminConsoleModel.test.ts, which is where the degraded
 * readings are pinned.
 */
import type { RolloutStage } from '@/models/control';
import { observed, unavailable, type ConsoleReading } from '@/lib/ops/consoleReadings';
import { ROLLOUT_STAGE_ORDER, permitsCommands } from '@/lib/ops/rolloutPosture';

/* ─────────────────────────────────────────────────────────────────────────
   THE FACTS
   ───────────────────────────────────────────────────────────────────────── */

/** People holding operational access. `ok: false` = the roster could not be read. */
export interface AdminRosterFacts {
  readonly ok: boolean;
  readonly total: number;
  readonly active: number;
  readonly disabled: number;
  readonly activeAdmins: number;
  /** Active `depot` operators with no `ops_users.depot_id`. They see no fleet at all — fail-closed, by design. */
  readonly depotOperatorsWithoutDepot: number;
  /** Active `driver`/`pilot_driver` accounts with no `ops_users.vehicle_id`. They receive no instruction stream. */
  readonly driversWithoutVehicle: number;
}

/** Invites not yet accepted or revoked. */
export interface AdminInviteFacts {
  readonly ok: boolean;
  readonly pending: number;
  readonly expired: number;
}

/** Per-route-direction rollout posture, as the control service reports it. */
export interface AdminRolloutFacts {
  readonly ok: boolean;
  readonly total: number;
  readonly permittingCommands: number;
  readonly byStage: Readonly<Record<RolloutStage, number>>;
  /**
   * Of `permittingCommands`, how many are staged route-directions that do NOT
   * appear in the mapped corridor list — no geometry, and therefore nothing any
   * operator can select, see or supervise.
   *
   * ─── WHY THIS IS A FIELD AND NOT A CURIOSITY ─────────────────────────────
   *
   * The two control-service reads are two different populations, and the gap is
   * not cosmetic. Measured against the live control database, 18 route-
   * directions were at `advisory` and 17 of them had no geometry — they were
   * leftovers named "QA E2E Route ..." from end-to-end runs. So the honest
   * count of REAL corridors the system may command was one, not eighteen.
   *
   * A console that reported "18 corridors accepting commands" would be
   * overstating the live pilot by a factor of eighteen, and it would be doing it
   * with a number it genuinely measured — which is the most convincing kind of
   * wrong. Null when the mapped list could not be read, because then the
   * comparison has no second side and any figure would be invented.
   */
  readonly permittingWithoutGeometry: number | null;
}

/** Corridor coverage, counted from the control service's own route-direction list. */
export interface AdminNetworkFacts {
  readonly ok: boolean;
  /** Corridors with mapped geometry — what the control database holds, NOT the size of the network. */
  readonly mapped: number;
  /** Of those, how many carry a measured target headway and can detect bunching. Null = this control service does not report it. */
  readonly detecting: number | null;
}

export interface AdminConsoleFacts {
  readonly roster: AdminRosterFacts;
  readonly invites: AdminInviteFacts;
  readonly rollout: AdminRolloutFacts;
  readonly network: AdminNetworkFacts;
}

/* ─────────────────────────────────────────────────────────────────────────
   THE MODEL
   ───────────────────────────────────────────────────────────────────────── */

export interface AdminTile {
  readonly label: string;
  readonly reading: ConsoleReading;
  readonly unit?: string;
  readonly tone?: 'default' | 'accent' | 'good' | 'warn' | 'critical';
}

export interface AdminTileGroup {
  readonly label: string;
  readonly tiles: readonly AdminTile[];
}

export interface AdminConsoleModel {
  readonly groups: readonly AdminTileGroup[];
  /**
   * Things an admin should act on, most consequential first. Empty is a real
   * and good answer — it is not padded with reassurance.
   */
  readonly attention: readonly AdminAttentionItem[];
  /** The standing sentence that stops the corridor pair reading as a network total. */
  readonly coverageNotice: string | null;
  /** Sources that did not answer, named so the page can say which readings are missing. */
  readonly unreadable: readonly string[];
}

export interface AdminAttentionItem {
  readonly id: string;
  readonly tone: 'warning' | 'error' | 'info';
  readonly title: string;
  readonly detail: string;
  readonly href?: string;
}

export function buildAdminConsoleModel(facts: AdminConsoleFacts): AdminConsoleModel {
  const { roster, invites, rollout, network } = facts;

  const groups: AdminTileGroup[] = [
    {
      label: 'People',
      tiles: [
        {
          label: 'Active accounts',
          reading: roster.ok
            ? observed(roster.active, `${roster.disabled} disabled`)
            : unavailable('the operator roster did not answer'),
        },
        {
          label: 'Administrators',
          reading: roster.ok
            ? observed(roster.activeAdmins, roster.activeAdmins === 1 ? 'the only one' : 'active')
            : unavailable('the operator roster did not answer'),
          // One active admin is not an error — it is how the system is seeded —
          // but it is the state in which disabling the wrong account locks the
          // tenant out, and the last-admin guard is the only thing standing in
          // the way. Worth seeing before it matters.
          tone: roster.ok && roster.activeAdmins === 1 ? 'warn' : 'default',
        },
        {
          label: 'Outstanding invites',
          reading: invites.ok
            ? observed(invites.pending + invites.expired, `${invites.expired} expired`)
            : unavailable('the invite list did not answer'),
          tone: invites.ok && invites.expired > 0 ? 'warn' : 'default',
        },
      ],
    },
    {
      label: 'Command permissions',
      tiles: [
        {
          label: 'Corridors that allow instructions',
          unit: rollout.ok ? `of ${rollout.total} set` : undefined,
          reading: rollout.ok
            ? observed(
                rollout.permittingCommands,
                // The hint carries the caveat rather than the tile carrying a
                // second number: a corridor with no shape in the database is
                // still one the command gate will permit, so it belongs in the
                // count — but an admin reading "18" must not take all eighteen
                // for corridors anybody can see.
                rollout.permittingWithoutGeometry
                  ? `${rollout.permittingWithoutGeometry} of them are not on the map`
                  : 'each instruction still needs approval',
              )
            : unavailable('the control service did not answer'),
          tone: 'accent',
        },
        {
          label: 'Corridors set to watch only',
          reading: rollout.ok
            ? observed(rollout.byStage.observation + rollout.byStage.shadow, 'instructions refused')
            : unavailable('the control service did not answer'),
        },
      ],
    },
    {
      label: 'Network coverage',
      tiles: [
        {
          label: 'Corridors surveyed',
          reading: network.ok
            ? observed(network.mapped, 'have a shape in the database')
            : unavailable('the control service did not answer'),
        },
        {
          label: 'Can report buses closing up',
          unit: network.ok && network.detecting !== null ? `of ${network.mapped}` : undefined,
          reading: !network.ok
            ? unavailable('the control service did not answer')
            : network.detecting === null
              ? unavailable('this control service does not say which corridors have a planned gap')
              : observed(network.detecting, 'have a planned gap set'),
        },
      ],
    },
  ];

  return {
    groups,
    attention: attentionFrom(facts),
    coverageNotice: coverageNoticeFor(network),
    unreadable: [
      ...(roster.ok ? [] : ['the list of people']),
      ...(invites.ok ? [] : ['outstanding invites']),
      ...(rollout.ok ? [] : ['command permissions']),
      ...(network.ok ? [] : ['corridor coverage']),
    ],
  };
}

/**
 * The list an admin works from.
 *
 * Ordered by consequence rather than by section, and each item names the
 * concrete effect rather than the condition: "sees no vehicles at all" is
 * actionable, "depot_id is null" is a schema fact. Nothing is added here just
 * to fill the panel — an empty list means there is nothing to do, and saying
 * so is the point.
 */
function attentionFrom({ roster, invites, rollout }: AdminConsoleFacts): AdminAttentionItem[] {
  const items: AdminAttentionItem[] = [];

  if (roster.ok && roster.depotOperatorsWithoutDepot > 0) {
    const n = roster.depotOperatorsWithoutDepot;
    items.push({
      id: 'depot-unassigned',
      tone: 'warning',
      title: `${n} depot ${n === 1 ? 'person has' : 'people have'} no depot set`,
      detail:
        'Their screen refuses to show any buses at all rather than falling back to the whole ' +
        "state's, so they see nothing until somebody sets one. That refusal is deliberate; the " +
        'missing setting is not.',
      href: '/ops/admin/invites',
    });
  }

  if (roster.ok && roster.driversWithoutVehicle > 0) {
    const n = roster.driversWithoutVehicle;
    items.push({
      id: 'vehicle-unassigned',
      tone: 'warning',
      title: `${n} ${n === 1 ? 'driver has' : 'drivers have'} no bus set`,
      detail:
        'A driver with no bus has nothing to receive instructions on — nothing sent from the ' +
        'control room will reach them. Only an administrator can set this.',
      href: '/ops/admin/invites',
    });
  }

  if (invites.ok && invites.expired > 0) {
    const n = invites.expired;
    items.push({
      id: 'invites-expired',
      tone: 'info',
      title: `${n} invite ${n === 1 ? 'link has' : 'links have'} run out of time`,
      detail:
        'The person cannot use the link they were sent. Sending it again creates a fresh link ' +
        'with a new expiry; the old one stops working.',
      href: '/ops/admin/invites',
    });
  }

  if (roster.ok && roster.activeAdmins === 1) {
    items.push({
      id: 'single-admin',
      tone: 'info',
      title: 'One active administrator',
      detail:
        'Disabling that account, or changing its role, is refused so this system cannot lock ' +
        'itself out — but nobody else can manage people or command permissions either.',
      href: '/ops/admin/invites',
    });
  }

  if (
    rollout.ok &&
    rollout.permittingWithoutGeometry !== null &&
    rollout.permittingWithoutGeometry > 0
  ) {
    const n = rollout.permittingWithoutGeometry;
    const real = rollout.permittingCommands - n;
    items.push({
      id: 'staged-without-geometry',
      tone: 'warning',
      title: `${n} of the ${rollout.permittingCommands} corridors that allow instructions are not on the map`,
      detail:
        `Only ${real} ${real === 1 ? 'is' : 'are'} a real corridor anybody can open or watch. ` +
        'The rest have no shape in the control database at all — usually left behind by test ' +
        'runs. They are not harmless: the system reads their permission like any other, so each ' +
        'one is a corridor instructions are allowed on and nobody is watching. Set them back to ' +
        'watch only, or have them removed from the control database.',
      href: '/ops/admin/rollout-stages',
    });
  }

  if (rollout.ok && rollout.total > 0 && rollout.permittingCommands === 0) {
    items.push({
      id: 'no-command-authority',
      tone: 'warning',
      title: 'No corridor allows instructions right now',
      detail:
        'Every corridor is set to watch only or watch and suggest, so the control service will ' +
        'refuse every instruction and record each attempt as blocked by a safety rule. This is ' +
        'the correct setting before a trial starts and the wrong one during it.',
      href: '/ops/admin/rollout-stages',
    });
  }

  return items;
}

/**
 * The standing caption under the coverage pair.
 *
 * Lifted verbatim in substance from the control room's own
 * `coverageNoticeFor`, and deliberately so: the claim "we do not know the size
 * of the full network" has to read identically on every surface that shows
 * these two numbers, or one of them is quietly implying total coverage.
 */
function coverageNoticeFor(network: AdminNetworkFacts): string | null {
  if (!network.ok) return null;

  const NETWORK_UNKNOWN =
    'The control database holds only the corridors surveyed so far, so the size of the full network is not known here — this is not a view of the whole network.';

  if (network.mapped === 0) {
    return `The control service reports no surveyed corridors. ${NETWORK_UNKNOWN}`;
  }
  if (network.detecting === null) {
    return `${network.mapped} ${word(network.mapped)} have been surveyed. This control service does not say which of them have a planned gap set, so how many can report buses closing up is unknown. ${NETWORK_UNKNOWN}`;
  }
  if (network.detecting === network.mapped) {
    return `All ${network.mapped} surveyed ${word(network.mapped)} have a planned gap set, so buses closing up can be reported on every one of them. ${NETWORK_UNKNOWN}`;
  }
  return `${network.detecting} of ${network.mapped} surveyed ${word(network.mapped)} have a planned gap set, so buses closing up can be reported there. The other ${network.mapped - network.detecting} have a placeholder target instead of a measured one — they can be opened, and they will show nothing. ${NETWORK_UNKNOWN}`;
}

function word(count: number): string {
  return count === 1 ? 'corridor' : 'corridors';
}

/** Zeroed stage tally, so a caller can count into it without pre-seeding five keys. */
export function emptyStageTally(): Record<RolloutStage, number> {
  return Object.fromEntries(ROLLOUT_STAGE_ORDER.map((stage) => [stage, 0])) as Record<
    RolloutStage,
    number
  >;
}

/** Tally a list of staged corridors, and count how many accept commands. */
export function tallyStages(stages: readonly RolloutStage[]): {
  byStage: Record<RolloutStage, number>;
  permittingCommands: number;
} {
  const byStage = emptyStageTally();
  let permittingCommands = 0;
  for (const stage of stages) {
    byStage[stage] += 1;
    if (permitsCommands(stage)) permittingCommands += 1;
  }
  return { byStage, permittingCommands };
}
