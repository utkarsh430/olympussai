/**
 * Plain code-unit ordering, the same on every server. `localeCompare` depends
 * on the runtime's locale data, which would make output order vary by host.
 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
