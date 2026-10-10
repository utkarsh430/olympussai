'use client';

import { Select, FilterRow } from '@/components/depot/shell/Controls';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { StaleNotice } from '@/components/depot/shell/StaleNotice';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import { isValidDepotId } from '@/lib/depot/ids';
import { SERVICE_BANDS } from '@/lib/depot/service/networkHours';
import { networkFigures } from '@/lib/depot/service/networkPageModel';
import { NETWORK_HOW_PRODUCED, NETWORK_SERVICE_TEXT as TEXT } from '@/lib/depot/service/networkWording';
import type { NetworkHourlyResponse, ServiceBandKey } from '@/lib/depot/service/types';
import { DailyBriefCard } from './DailyBriefCard';
import { NetworkHeatMap } from './NetworkHeatMap';
import { NetworkProposalsTable } from './NetworkProposalsTable';
import { NetworkReallocation } from './NetworkReallocation';

export interface NetworkServicePageProps {
  readonly response: NetworkHourlyResponse | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly onRetry?: () => void;
  readonly onBand?: (band: ServiceBandKey) => void;
  readonly onDepot?: (depotId: string | null) => void;
  readonly onPage?: (page: number) => void;
}

const LOADING_ROWS = 4;
const LOADING_ROW_PX = 96;
const NO_OP = (): void => undefined;

/** One row of controls above the hero: the band (its short routes in words) and the depot. */
function Filters({ response, onBand, onDepot }: Pick<NetworkServicePageProps, 'onBand' | 'onDepot'> & { readonly response: NetworkHourlyResponse }) {
  return (
    <FilterRow label={TEXT.filters}>
      <div role="group" aria-label={TEXT.band} className="flex flex-wrap gap-2">
        {SERVICE_BANDS.map((b) => {
          const tally = response.bands.find((x) => x.band === b.key);
          return (
            <button
              key={b.key}
              type="button"
              className="depot-filter-button"
              aria-pressed={response.band === b.key}
              onClick={() => (onBand ?? NO_OP)(b.key)}
            >
              {`${b.label} · ${formatCount(tally?.shortRoutes ?? 0)} short`}
            </button>
          );
        })}
      </div>
      <Select
        label={TEXT.depot}
        value={response.depotId ?? ''}
        onChange={(e) => (onDepot ?? NO_OP)(isValidDepotId(e.target.value) ? e.target.value : null)}
      >
        <option value="">{TEXT.allDepots}</option>
        {response.depots.map((d) => (
          <option key={d.depotId} value={d.depotId}>
            {d.depotName}
          </option>
        ))}
      </Select>
    </FilterRow>
  );
}

/**
 * The network's day hour by hour, under the page's header: the daily brief, the filters, the
 * heat map as the hero, the band's figures, the proposals with the decisions on them, the
 * reallocation and the closing disclosure.
 */
export function NetworkServicePage(props: NetworkServicePageProps) {
  const { response, error, loading, onRetry } = props;
  if (response === null) {
    if (loading) {
      return <StatePanel kind="loading" sentence={TEXT.loading} rows={LOADING_ROWS} rowHeight={LOADING_ROW_PX} />;
    }
    if (error !== null) {
      const retry = onRetry ? (
        <button type="button" className="depot-filter-button" onClick={onRetry}>
          Retry
        </button>
      ) : undefined;
      return <StatePanel kind="error" title={TEXT.errorTitle} sentence={error} action={retry} />;
    }
    return <StatePanel kind="empty" sentence={TEXT.empty} />;
  }
  if (response.routes.total === 0 && response.depotId === null) {
    return <StatePanel kind="empty" sentence={TEXT.empty} />;
  }
  return (
    <>
      {response.stale ? <StaleNotice since={response.feedNow} fetchedAt={response.fetchedAt} /> : null}
      <div className="depot-stack" data-testid="network-service-page">
        <DailyBriefCard
          operatingDate={response.operatingDate}
          proposals={response.proposals}
          currentFeedTime={response.feedNow}
        />
        <Filters response={response} onBand={props.onBand} onDepot={props.onDepot} />
        <NetworkHeatMap response={response} onPage={props.onPage ?? NO_OP} />
        <div data-testid="network-figure-band">
          <FigureBand label="The band across all depots">
            {networkFigures(response).map((f) => (
              <Figure key={f.label} label={f.label} value={f.value} caption={f.caption} tag={f.tag} tone={f.tone} lead={f.lead} />
            ))}
          </FigureBand>
        </div>
        <NetworkProposalsTable
          proposals={response.proposals}
          totals={response.proposalTotals}
          operatingDate={response.operatingDate}
        />
        <NetworkReallocation reallocation={response.reallocation} />
        <HowProduced id="how-produced" paragraphs={NETWORK_HOW_PRODUCED}>
          <p className="depot-prose">{`The modelled demand: ${response.demandBasis}`}</p>
          <p className="depot-prose">
            {`Only buses that report a route name are counted: ${formatCount(response.routeCoverage.n)} of the ${formatCount(response.routeCoverage.of)} buses in the feed report one.`}
          </p>
        </HowProduced>
      </div>
    </>
  );
}
