import type { Provenance } from '@/lib/depot/types';
import type { TrendTableRow } from '@/lib/depot/forecast/trendsTableModel';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';
import { DEFAULT_HISTORY_DAYS } from '@/lib/depot/sim/config';
import type { DeiComponentKey } from '@/lib/depot/score/types';
import type { SortValue } from '@/lib/depot/tableSort';
import {
  LEAGUE_SCROLLING_COLUMNS,
  TIER_CLASS,
  type FrozenKey,
  type ScrollingColumn,
} from './leagueColumns';
import type { LeagueRow } from './leagueModel';

/*
 * The league grid's columns, in order: the frozen block, then the tiered columns from
 * `leagueColumns.ts`. Pure, so the headers, their screen-reader names, the one MODELLED
 * tag and the display classes are tested without rendering.
 */

export type LeagueColumnKey = FrozenKey | ScrollingColumn['key'];

export interface LeagueColumn {
  readonly key: LeagueColumnKey;
  /** The visible header: one short line. */
  readonly header: string;
  /** Screen-reader text after the header: the full name and how to read it. */
  readonly title?: string;
  readonly frozen?: FrozenKey;
  readonly className: string;
  readonly right?: boolean;
  /** The pill in the header cell, only where the column differs from the page (DERIVED). */
  readonly tag?: Provenance;
  /** Absent for a column that cannot be sorted (the chevron). */
  readonly sortValue?: (row: LeagueRow, trends: ReadonlyMap<string, TrendTableRow>) => SortValue;
}

export const INDEX_TITLE =
  'Efficiency index, 0 to 100. A typical peer scores 50; the tick on the bar marks 50. ' +
  'Select a depot’s index to see how its score is made up.';
export const TREND_TITLE =
  `Efficiency index over the last ${DEFAULT_HISTORY_DAYS} days: a MODELLED history ending on today's feed value, and ` +
  'its direction over 4 weeks. Sorts by the change over 4 weeks.';

const COMPONENT_BY_KEY = new Map(DEI_COMPONENTS.map((c) => [c.key, c]));

function scrolling(column: ScrollingColumn): LeagueColumn {
  const className = TIER_CLASS[column.tier];
  switch (column.key) {
    case 'trend':
      return { key: 'trend', header: column.header, title: TREND_TITLE, className, tag: 'modelled',
        sortValue: (r, trends) => trends.get(r.depotId)?.fourWeeks ?? null };
    case 'fleet':
      return { key: 'fleet', header: column.header, title: 'Fleet, in buses.', className, right: true,
        sortValue: (r) => r.fleet };
    case 'open':
      return { key: 'open', header: '', title: 'Opens the score breakdown', className: `${className} w-6 !px-1.5` };
    default: {
      const key: DeiComponentKey = column.key;
      const c = COMPONENT_BY_KEY.get(key);
      const label = c?.label ?? key;
      return {
        key,
        header: column.header,
        title: `${label}: the depot's rate. ${c?.higherIsBetter ? 'Higher' : 'Lower'} is better. ` +
          'Its difference from the peer median is in the breakdown.',
        className,
        right: true,
        sortValue: (r) => r.components.find((x) => x.key === key)?.value ?? null,
      };
    }
  }
}

export const LEAGUE_COLUMNS: readonly LeagueColumn[] = [
  { key: 'rank', header: 'Rank', frozen: 'rank', className: 'z-[5]', right: true, sortValue: (r) => r.rank },
  { key: 'depot', header: 'Depot', frozen: 'depot', className: 'z-[5]', sortValue: (r) => r.name },
  { key: 'index', header: 'Index', title: INDEX_TITLE, frozen: 'index',
    className: 'z-[5] border-r border-r-depot-line', sortValue: (r) => r.index },
  ...LEAGUE_SCROLLING_COLUMNS.map(scrolling),
];
