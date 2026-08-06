// Tiny numeric helpers shared by the decision-engine control laws
// (terminalDispatch.ts, twoWayHold.ts, selfEqualizing.ts, occupancyMpc.ts).
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
