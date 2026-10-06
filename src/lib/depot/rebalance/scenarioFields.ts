import {
  MAX_FLEET_ADJUSTMENT,
  MAX_SPARE_RATIO,
  MAX_SURGE_PERCENT,
  MAX_TRANSFER_KM,
  MIN_SPARE_RATIO,
  MIN_SURGE_PERCENT,
  MIN_TRANSFER_KM,
} from '../optimise/config';

/*
 * What the sandbox says about its fields: each label carries the range the
 * optimiser accepts (taken from its config, so the two cannot drift), and the
 * optimiser's clamp notes are restated in the units and names a person typed.
 */

const PERCENT = 100;

function asPercent(fraction: number): number {
  return Math.round(fraction * PERCENT * 100) / 100;
}

export const FIELD_LABELS = {
  spare: `Spare ratio, %, ${asPercent(MIN_SPARE_RATIO)} to ${asPercent(MAX_SPARE_RATIO)}`,
  distance: `Maximum transfer distance, km, ${MIN_TRANSFER_KM} to ${MAX_TRANSFER_KM}`,
  fleet: `Change in buses, -${MAX_FLEET_ADJUSTMENT} to +${MAX_FLEET_ADJUSTMENT}`,
  surge: `Demand change, %, ${MIN_SURGE_PERCENT} to +${MAX_SURGE_PERCENT}`,
} as const;

type NameOf = (depotId: string) => string;

interface ClampRule {
  readonly pattern: RegExp;
  readonly render: (m: RegExpMatchArray, nameOf: NameOf) => string;
}

function percentText(raw: string): string {
  const value = Number(raw);
  return Number.isFinite(value) ? `${asPercent(value)}%` : raw;
}

const RULES: readonly ClampRule[] = [
  {
    pattern: /^Spare ratio (\S+) was outside (\S+) to (\S+); using (\S+)$/,
    render: (m) =>
      `Spare ratio ${percentText(m[1])} was outside ${percentText(m[2])} to ` +
      `${percentText(m[3])}; using ${percentText(m[4])}`,
  },
  {
    pattern: /^Spare ratio (\S+) is not a number; using (\S+)$/,
    render: (m) => `Spare ratio is not a number; using ${percentText(m[2])}`,
  },
  {
    pattern: /^Maximum transfer distance (\S+) was outside (\S+) to (\S+); using (\S+)$/,
    render: (m) =>
      `Maximum transfer distance ${m[1]} km was outside ${m[2]} to ${m[3]} km; using ${m[4]} km`,
  },
  {
    pattern: /^Fleet adjustment for (\S+) (.*) was outside (\S+) to (\S+); using (\S+)$/,
    render: (m, nameOf) =>
      `Change in buses at ${nameOf(m[1])} ${m[2]} was outside ${m[3]} to ${m[4]} buses; ` +
      `using ${m[5]}`,
  },
  {
    pattern: /^Fleet adjustment for (\S+) limited to (\S+): available cannot go below 0$/,
    render: (m, nameOf) =>
      `Change in buses at ${nameOf(m[1])} limited to ${m[2]}: available buses cannot go below 0`,
  },
  {
    pattern: /^Demand surge for (\S+) totals (\S+), outside (\S+) to (\S+); using (\S+)$/,
    render: (m, nameOf) =>
      `Demand change at ${nameOf(m[1])} totals ${m[2]}, outside ${m[3]}% to ${m[4]}%; ` +
      `using ${m[5]}%`,
  },
];

const DEPOT_PREFIX = /^(Fleet adjustment|Demand surge) for (\S+)/;
const PREFIX_WORDS: Readonly<Record<string, string>> = {
  'Fleet adjustment': 'Change in buses',
  'Demand surge': 'Demand change',
};

/** An optimiser clamp note restated with percentages, units and depot names. */
export function describeClamp(note: string, nameOf: NameOf): string {
  for (const rule of RULES) {
    const match = note.match(rule.pattern);
    if (match) return rule.render(match, nameOf);
  }
  // Any other note keeps its wording but never shows a raw depot id.
  return note.replace(
    DEPOT_PREFIX,
    (_all, what: string, id: string) => `${PREFIX_WORDS[what] ?? what} at ${nameOf(id)}`,
  );
}
