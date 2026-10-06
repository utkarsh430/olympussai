import type { ModelledService, ServiceGroup } from './serviceModel';

/*
 * How the preventive table is grouped and capped, decided here so it is tested: the
 * table prints each status once as a group row (the group row says
 * "modelled"), five rows a group and "Show all N".
 */

const GROUP_ORDER: readonly ServiceGroup[] = ['overdue', 'due_soon', 'not_due'];
export const GROUP_PREVIEW_ROWS = 5;

export interface PreventiveView {
  /** Most urgent group first, each group nearest-due first; a group is cut to five unless opened. */
  readonly rows: readonly ModelledService[];
  /** Every group's full count, so a group row never counts only the rows shown. */
  readonly totals: Readonly<Record<ServiceGroup, number>>;
  /** The groups holding more than five rows, in order, for their "Show all N". */
  readonly cappable: readonly ServiceGroup[];
}

export function preventiveView(
  buses: readonly ModelledService[],
  opened: ReadonlySet<ServiceGroup>,
): PreventiveView {
  const own = (group: ServiceGroup): readonly ModelledService[] =>
    buses
      .filter((bus) => bus.group === group)
      .sort((a, b) => a.kmToNextService - b.kmToNextService);
  const groups = GROUP_ORDER.map((group) => ({ group, rows: own(group) }));
  const totals = {
    overdue: groups[0]?.rows.length ?? 0,
    due_soon: groups[1]?.rows.length ?? 0,
    not_due: groups[2]?.rows.length ?? 0,
  };
  const rows = groups.flatMap(({ group, rows: all }) =>
    opened.has(group) ? all : all.slice(0, GROUP_PREVIEW_ROWS),
  );
  return {
    rows,
    totals,
    cappable: GROUP_ORDER.filter((group) => totals[group] > GROUP_PREVIEW_ROWS),
  };
}
