'use client';

import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { formatCount } from '@/lib/depot/format';
import {
  FEED_REGISTRY,
  FEED_STATUS_LABEL,
  type FeedEntry,
  type FeedStatus,
} from '@/lib/depot/sources/registry';
import { CoverageBars } from './CoverageBars';
import { FeedSchema } from './FeedSchema';

const STATUS_TONE: Readonly<Record<FeedStatus, string>> = {
  live: 'border-alert-green/50 text-alert-green',
  modelled: 'border-alert-amber/50 text-alert-amber',
  awaiting: 'border-depot-muted/50 text-depot-muted',
};

function FeedCard({ feed }: { readonly feed: FeedEntry }) {
  return (
    <li>
      <article className="depot-panel p-4" data-testid={`depot-feed-${feed.id}`}>
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-mono text-sm text-depot-ink">{feed.name}</h3>
          <span className={`depot-tag ${STATUS_TONE[feed.status]}`}>
            {FEED_STATUS_LABEL[feed.status]}
          </span>
        </header>
        <p className="depot-prose mt-1">{feed.summary}</p>
        <p className="depot-prose mt-1">
          <span className="depot-label mr-2">Unlocks</span>
          {feed.unlocks}
        </p>
        <FeedSchema feed={feed} />
      </article>
    </li>
  );
}

function CoverageSection() {
  const { data, error, loading, refresh } = useDepotNetworkContext();
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
          <p className="depot-prose mt-1">
            {`Measured on the latest snapshot of ${formatCount(data.recordCount)} bus records. A bar shows how many records carry each field; a field a bus lacks is not guessed.`}
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

/** Every feed, whether it is live, how well it is populated, and the schema a real feed provides. */
export function SourcesRegistry() {
  return (
    <>
      <CoverageSection />
      <h2 className="depot-label mb-2">Feeds</h2>
      <ul className="flex flex-col gap-3" data-testid="depot-feed-registry">
        {FEED_REGISTRY.map((feed) => (
          <FeedCard key={feed.id} feed={feed} />
        ))}
      </ul>
    </>
  );
}
