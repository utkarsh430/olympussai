'use client';

import { useMemo } from 'react';
import { BUS_STATE_SQUARE } from '@/components/depot/shell/BusStateMark';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import { AWAY_LIST_CAP, type YardModel } from '@/lib/depot/yard/yardModel';
import {
  awayRows,
  ROLL_NOTE,
  ROLL_PREVIEW_ROWS,
  rollGroupHeading,
  unknownRows,
  yardRoll,
  type RollGroup,
} from '@/lib/depot/yard/yardRollModel';
import { awayColumns, CappedTable, rollColumns, unknownColumns } from './YardTables';
import { YardVisitors } from './YardVisitors';

export interface YardRollProps {
  readonly model: YardModel;
  /** Depot names by id, to say which yard an at-another-depot bus stands in. */
  readonly depotNames: ReadonlyMap<string, string>;
  readonly depotId: string;
}

/** The roll's heading id; the no-yard panel's "See every bus by state" link targets it. */
export const ROLL_SECTION_ID = 'yard-roll-in';

/** One state: its square and word, every bus counted, then the ones needing action. */
function StateGroupBlock({
  group,
  depotId,
}: {
  readonly group: RollGroup;
  readonly depotId: string;
}) {
  const columns = useMemo(
    () => rollColumns(depotId, group.showReason),
    [depotId, group.showReason],
  );
  return (
    <div className="min-w-0" data-testid="yard-roll-group" data-state={group.state}>
      <h3 className="flex h-8 items-center gap-2 font-mono text-[11px] tracking-[0.12em] tabular-nums text-depot-ink">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 ${BUS_STATE_SQUARE[group.state]}`} />
        {rollGroupHeading(group)}
      </h3>
      {group.rows.length > 0 ? (
        <CappedTable
          columns={columns}
          rows={group.rows}
          rowKey={(r) => r.registration}
          caption={`${group.label}: buses needing action`}
          cap={ROLL_PREVIEW_ROWS}
        />
      ) : null}
    </div>
  );
}

/** Every bus counted by state; in each state only the buses with a live reason listed. */
function Roll({ model, depotId }: Omit<YardRollProps, 'depotNames'>) {
  const roll = yardRoll(model);
  const empty = model.established
    ? "None of this depot's buses is inside the yard"
    : 'This depot has no buses in the latest feed';
  const nothingListed = roll.groups.every((g) => g.rows.length === 0);
  return (
    <section aria-labelledby={ROLL_SECTION_ID} data-testid="yard-roll">
      <SectionLabel id={ROLL_SECTION_ID} label={roll.title} count={roll.total} note={ROLL_NOTE} />
      {roll.total === 0 ? (
        <StatePanel kind="empty" compact sentence={empty} />
      ) : (
        // Side by side from 1280px: four state groups stacked made this the tallest part of
        // the page. Each group's table still fits its column (it is at most 760px wide).
        <div
          data-testid="yard-roll-groups"
          className="grid min-w-0 grid-cols-1 items-start gap-x-8 gap-y-3 xl:grid-cols-2"
        >
          {roll.groups.map((group) => (
            <StateGroupBlock key={group.state} group={group} depotId={depotId} />
          ))}
          {nothingListed ? (
            <StatePanel kind="empty" compact tone="ok" sentence="No bus here needs action" />
          ) : null}
        </div>
      )}
    </section>
  );
}

function Away({ model, depotId, depotNames }: YardRollProps) {
  const rows = awayRows(model.away.buses, depotNames);
  const showAtYard = rows.some((r) => r.atYard !== '');
  const columns = useMemo(() => awayColumns(depotId, showAtYard), [depotId, showAtYard]);
  return (
    <section aria-labelledby="yard-roll-away">
      <SectionLabel
        id="yard-roll-away"
        label="Away from the yard"
        count={model.away.total}
        note={`The nearest ${formatCount(Math.min(AWAY_LIST_CAP, rows.length))} listed`}
      />
      <CappedTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.registration}
        caption="Nearest buses away from the yard"
        cap={ROLL_PREVIEW_ROWS}
      />
    </section>
  );
}

function Unknown({ model, depotId }: Omit<YardRollProps, 'depotNames'>) {
  const columns = useMemo(() => unknownColumns(depotId), [depotId]);
  return (
    <section aria-labelledby="yard-roll-unknown">
      <SectionLabel id="yard-roll-unknown" label="Location unknown" count={model.unknown.length} />
      <CappedTable
        columns={columns}
        rows={unknownRows(model.unknown)}
        rowKey={(r) => r.registration}
        caption="Buses with no known location"
        cap={ROLL_PREVIEW_ROWS}
      />
    </section>
  );
}

/**
 * Text twin of the map: every bus in the yard counted by state with the buses needing
 * action listed, visitors, the nearest away buses and buses with no known location, each
 * a table at most 760px wide. Each is one section of the page's stack.
 */
export function YardRoll({ model, depotId, depotNames }: YardRollProps) {
  return (
    <>
      <Roll model={model} depotId={depotId} />
      {model.established ? <YardVisitors model={model} /> : null}
      {model.established && model.away.total > 0 ? (
        <Away model={model} depotId={depotId} depotNames={depotNames} />
      ) : null}
      {model.unknown.length > 0 ? <Unknown model={model} depotId={depotId} /> : null}
    </>
  );
}
