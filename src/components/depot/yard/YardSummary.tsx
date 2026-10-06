import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import type { CapacityView } from '@/lib/depot/yard/parkingModel';
import { capacityFigure } from '@/lib/depot/yard/yardPageModel';
import { noYardPanel } from '@/lib/depot/yard/yardRollModel';
import { ROLL_SECTION_ID } from './YardRoll';
import type { YardModel } from '@/lib/depot/yard/yardModel';

export interface YardFiguresProps {
  readonly model: YardModel;
  readonly capacity: CapacityView;
  /** True while the modelled bay count is still being fetched. */
  readonly baysPending: boolean;
}

/**
 * The one strip above the map: in the yard, visiting, away and capacity. The page
 * default is DERIVED (the yard is inferred); only capacity, set against modelled
 * bays, carries its own tag. With no yard, the in/away split does not exist.
 */
export function YardFigures({ model, capacity, baysPending }: YardFiguresProps) {
  const cap = capacityFigure(capacity, baysPending);
  return (
    <div data-testid="yard-summary">
      <FigureBand label="Yard figures">
        {model.established ? (
          <>
            <Figure
              label="In the yard"
              value={formatCount(model.counts.inYard)}
              caption="inside the yard circle, any state"
            />
            <Figure
              label="Visiting"
              value={formatCount(model.counts.visitors)}
              caption="from other depots"
            />
            <Figure
              label="Away"
              value={formatCount(model.counts.away)}
              caption="outside the yard"
            />
          </>
        ) : (
          <Figure
            label="Parked with a position"
            value={formatCount(model.parkedWithPosition)}
            caption="no yard established"
          />
        )}
        <Figure
          label="Capacity"
          value={cap.value}
          caption={cap.caption}
          share={cap.share}
          tag={cap.share === undefined && cap.value === '—' ? undefined : 'modelled'}
          title={cap.title}
        />
      </FigureBand>
    </div>
  );
}

/** The closing disclosure's id: the no-yard panel's "How a yard is found" link opens it. */
export const HOW_ID = 'yard-how';
/** The map frame's height (`depot-map-frame`) plus its caption row: the panel's footprint. */
const MAP_FOOTPRINT_PX = 488;

export interface YardNotEstablishedProps {
  readonly model: YardModel;
  /** Snapshots the server has decided this yard on; at 0 or 1 it has only just started. */
  readonly snapshotsSeen: number | undefined;
}

/**
 * Takes the map's place when no yard can be placed: one sentence, one muted line, one
 * action, centred in the map's footprint. The claiming rule is in the closing disclosure.
 */
export function YardNotEstablished({ model, snapshotsSeen }: YardNotEstablishedProps) {
  const panel = noYardPanel(model, snapshotsSeen);
  return (
    <section aria-labelledby="yard-not-established-heading" data-testid="yard-not-established">
      <h2 id="yard-not-established-heading" className="sr-only">
        Yard not established
      </h2>
      <StatePanel
        kind="not-established"
        minHeight={MAP_FOOTPRINT_PX}
        sentence={panel.sentence}
        remedy={panel.remedy}
        howLink={{ label: 'How a yard is found', targetId: HOW_ID }}
        action={
          <a className="depot-link" href={`#${ROLL_SECTION_ID}`}>
            See every bus by state ↓
          </a>
        }
      />
    </section>
  );
}
