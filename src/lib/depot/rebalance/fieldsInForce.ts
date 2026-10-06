/*
 * The what-if fields show the value in force, never an empty box (capture report item 23):
 * the server plan's own parameters, or what the what-if already set for a depot. A field
 * left at, or put back to, that value changes nothing.
 */

const PERCENT = 100;
const HUNDREDTHS = 100;

export interface ServerParams {
  readonly requirementParams: { readonly spareRatio: number };
  readonly rebalanceParams: { readonly maxTransferKm: number };
}

export interface PlanInForce {
  /** The server plan's spare ratio, as the percentage the field takes. */
  readonly sparePercent: number;
  readonly maxTransferKm: number;
}

/** The server plan's own parameters, in the units the sandbox's fields take. */
export function serverInForce(data: ServerParams): PlanInForce {
  const ratio = data.requirementParams.spareRatio;
  return {
    sparePercent: Math.round(ratio * PERCENT * HUNDREDTHS) / HUNDREDTHS,
    maxTransferKm: data.rebalanceParams.maxTransferKm,
  };
}

/** The field's starting text: the value in force, without trailing zeros. */
export function inForceText(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

/** What a committed field means: null (the value in force, so no change) or a new value. */
export function changeFrom(value: number | null, inForce: number): number | null {
  return value === null || value === inForce ? null : value;
}
