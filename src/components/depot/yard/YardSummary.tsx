import { FigureBand } from '@/components/depot/shell/FigureBand';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import type { CapacityView } from '@/lib/depot/yard/parkingModel';
import { capacityFigure } from '@/lib/depot/yard/yardPageModel';
import { noYardPanel } from '@/lib/depot/yard/yardRollModel';
import { ROLL_SECTION_ID } from './YardRoll';
import type { YardModel } from '@/lib/depot/yard/yardModel';

interface YardFigureProps {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  readonly tag?: 'modelled';
  /** A share from 0 to 1: a 120px bar at the head of the caption line. */
  readonly share?: number;
  readonly title?: string;
}

const PERCENT = 100;

/**
 * The band's figure, laid out for this band: a tag sits inside the 16px label line (so a
 * tagged figure's value stays level with its siblings'), a share bar leads the caption
 * line instead of adding a row (narrower at 1024, where a figure is 200px, so "79 free" is
 * never cut), and on a phone the caption wraps instead of cutting.
 */
function YardFigure({ label, value, caption, tag, share, title }: YardFigureProps) {
  const width = share === undefined ? 0 : Math.round(Math.min(1, Math.max(0, share)) * PERCENT);
  return (
    <li
      title={title}
      data-testid="yard-figure"
      className="min-w-0 list-none border-l border-depot-line px-4 lg:w-[200px] lg:flex-none xl:w-[232px]"
    >
      <div className="flex h-4 min-w-0 items-center gap-2 [&_.depot-tag]:!py-0 [&_.depot-tag]:!leading-[14px]">
        <div className="depot-label truncate leading-4" title={label}>
          {label}
        </div>
        {tag ? <ProvenanceBadge provenance={tag} /> : null}
      </div>
      <div className="mt-1.5 truncate font-mono text-2xl leading-7 tabular-nums text-depot-ink">{value}</div>
      <p className="depot-caption mt-1.5 flex min-w-0 items-center gap-2">
        {share !== undefined ? (
          <span aria-hidden className="depot-bar-track block w-[120px] shrink-0 lg:w-[80px] xl:w-[120px]">
            <span className="depot-bar-fill block" data-testid="depot-figure-share" style={{ width: `${width}%` }} />
          </span>
        ) : null}
        <span className="min-w-0 sm:truncate" title={caption}>
          {caption}
        </span>
      </p>
      {title ? <p className="sr-only">{title}</p> : null}
    </li>
  );
}

export interface YardFiguresProps {
  readonly model: YardModel;
  readonly capacity: CapacityView;
  /** True while the modelled bay count is still being fetched. */
  readonly baysPending: boolean;
}

/**
 * The one strip above the map: in the yard (every bus of the depot inside the circle,
 * whatever its state), visiting, away and capacity. The page is MIXED; capacity, set
 * against modelled bays, is the band's one generated figure and carries its own tag
 * (none while it is only a dash). With no yard, the in/away split does not exist.
 */
export function YardFigures({ model, capacity, baysPending }: YardFiguresProps) {
  const cap = capacityFigure(capacity, baysPending);
  return (
    // The stack spaces the band from the map (40px): the band's own bottom margin is dropped.
    <div data-testid="yard-summary" className="[&>div]:!mb-0">
      <FigureBand label="Yard figures">
        {model.established ? (
          <>
            <YardFigure
              label="In the yard"
              value={formatCount(model.counts.inYard)}
              caption="ours, inside the circle"
              title="This depot's buses inside the yard circle, in any state. Buses from other depots inside it are counted under Visiting."
            />
            <YardFigure
              label="Visiting"
              value={formatCount(model.counts.visitors)}
              caption="from other depots"
            />
            <YardFigure
              label="Away"
              value={formatCount(model.counts.away)}
              caption="outside the yard"
            />
          </>
        ) : (
          <YardFigure
            label="Parked with a position"
            value={formatCount(model.parkedWithPosition)}
            caption="no yard established"
          />
        )}
        <YardFigure
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

export interface YardNotEstablishedProps {
  readonly model: YardModel;
  /** Snapshots the server has decided this yard on; at 0 or 1 it has only just started. */
  readonly snapshotsSeen: number | undefined;
}

/**
 * Takes the map's place when no yard can be placed: under the same "Yard map" label, a
 * boxed panel sized to its text (one sentence, one muted line, one action), and the state
 * lists follow. The claiming rule is in the closing disclosure.
 */
export function YardNotEstablished({ model, snapshotsSeen }: YardNotEstablishedProps) {
  const panel = noYardPanel(model, snapshotsSeen);
  return (
    <section aria-labelledby="yard-not-established-heading" data-testid="yard-not-established">
      <SectionLabel id="yard-not-established-heading" label="Yard map" />
      <StatePanel
        kind="not-established"
        sentence={panel.sentence}
        remedy={panel.remedy}
        howLink={{ label: 'How a yard is found', targetId: HOW_ID }}
        action={
          <a className="depot-link" href={`#${ROLL_SECTION_ID}`}>
            See the buses by state ↓
          </a>
        }
      />
    </section>
  );
}
