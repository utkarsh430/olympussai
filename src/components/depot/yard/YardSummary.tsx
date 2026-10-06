import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import type { CapacityView } from '@/lib/depot/yard/parkingModel';
import { capacityFigure } from '@/lib/depot/yard/yardPageModel';
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
              caption="this depot's buses"
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
          tag="modelled"
          title={cap.title}
        />
      </FigureBand>
    </div>
  );
}

/** Takes the map's place when no yard can be placed; the page below still shows what it can. */
export function YardNotEstablished({ model }: { readonly model: YardModel }) {
  return (
    <section aria-labelledby="yard-not-established-heading" data-testid="yard-not-established">
      <h2 id="yard-not-established-heading" className="sr-only">
        Yard not established
      </h2>
      <StatePanel
        kind="not-established"
        minHeight={240}
        sentence={`${model.basis} ${model.rule ?? ''}`.trim()}
        remedy={`A yard appears once more of the depot's buses are parked together and reporting their position; ${formatCount(model.parkedWithPosition)} ${model.parkedWithPosition === 1 ? 'is' : 'are'} now. Until then every bus is listed below by state.`}
      />
    </section>
  );
}
