'use client';

import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { formatCount } from '@/lib/depot/format';
import {
  FEED_REGISTRY,
  FEED_STATUS_LABEL,
  type FeedStatus,
} from '@/lib/depot/sources/registry';
import { recordsSentence } from '@/lib/depot/sources/sourcesModel';
import { CoverageBars } from './CoverageBars';
import { FeedSchema } from './FeedSchema';

const STATUS_TONE: Readonly<Record<FeedStatus, string>> = {
  live: 'border-alert-green/50 text-alert-green',
  modelled: 'border-alert-amber/50 text-alert-amber',
  awaiting: 'border-depot-muted/50 text-depot-muted',
};

function CoverageSection() {
  const { data, error, loading, refresh } = useDepotNetworkContext();
  // Every bus row belongs to exactly one unit (the unassigned bucket included),
  // so the units' fleets sum to the buses the feed was reduced to.
  const busesCounted = data ? data.depots.reduce((sum, d) => sum + d.fleet, 0) : 0;
  return (
    <section aria-labelledby="coverage-title" className="depot-panel mb-6 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="coverage-title" className="font-mono text-sm text-depot-ink">
          How well the GPS and device feed is populated
        </h2>
        <ProvenanceBadge provenance="derived" />
      </div>
      {loading ? (
        <div className="mt-3">
          <LoadingBlock rows={6} rowHeight={20} label="Loading feed coverage" />
        </div>
      ) : !data ? (
        <div className="mt-3">
          <ErrorPanel message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />
        </div>
      ) : (
        <>
          <p className="depot-prose mt-1" data-testid="depot-records-sentence">
            {`${recordsSentence(data.recordCount, busesCounted)}.`}
          </p>
          <p className="depot-prose mt-1">
            {`A bar shows how many of the ${formatCount(busesCounted)} buses carry each field, most complete first; a field a bus lacks is not guessed.`}
          </p>
          {data.stale || error ? <div className="mt-3"><StaleStrip since={data.feedNow} /></div> : null}
          <div className="mt-4">
            <CoverageBars coverage={data.coverage} />
          </div>
        </>
      )}
    </section>
  );
}

function FeedTable() {
  return (
    <div role="region" aria-label="Feeds" tabIndex={0} className="depot-table-frame !max-h-none" data-testid="depot-feed-registry">
      <table className="depot-table">
        <caption className="sr-only">Feeds behind this module</caption>
        <thead>
          <tr>
            <th scope="col">Feed</th>
            <th scope="col">Status</th>
            <th scope="col">What it provides</th>
            <th scope="col">Unlocks</th>
          </tr>
        </thead>
        <tbody>
          {FEED_REGISTRY.map((feed) => (
            <tr key={feed.id} data-testid={`depot-feed-${feed.id}`} className="align-top">
              <th scope="row" className="!static !bg-transparent !text-left !normal-case !tracking-normal !text-depot-ink">
                {feed.name}
              </th>
              <td>
                <span className={`depot-tag ${STATUS_TONE[feed.status]}`}>
                  {FEED_STATUS_LABEL[feed.status]}
                </span>
              </td>
              <td className="depot-prose min-w-[14rem]">{feed.summary}</td>
              <td className="depot-prose min-w-[14rem]">{feed.unlocks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every feed, whether it is live, how well it is populated, and the schema a real feed provides. */
export function SourcesRegistry() {
  return (
    <>
      <CoverageSection />
      <h2 className="depot-label mb-2">Feeds</h2>
      <FeedTable />
      <h2 className="depot-label mb-2 mt-6">Field lists</h2>
      <div className="flex flex-col divide-y divide-depot-line border-y border-depot-line">
        {FEED_REGISTRY.map((feed) => (
          <FeedSchema key={feed.id} feed={feed} />
        ))}
      </div>
    </>
  );
}
