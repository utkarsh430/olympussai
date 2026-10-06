'use client';

import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { formatCount } from '@/lib/depot/format';
import {
  FEED_REGISTRY,
  FEED_STATUS_LABEL,
  type FeedEntry,
  type FeedStatus,
} from '@/lib/depot/sources/registry';
import { feedAnchor, recordsSentence } from '@/lib/depot/sources/sourcesModel';
import { CoverageBars } from './CoverageBars';
import { FeedSchema } from './FeedSchema';
import { HowProduced } from '@/components/depot/shell/HowProduced';

const STATUS_TONE: Readonly<Record<FeedStatus, string>> = {
  live: 'border-alert-green/50 text-alert-green',
  modelled: 'border-alert-amber/50 text-alert-amber',
  awaiting: 'border-depot-muted/50 text-depot-muted',
};

const FEED_IDS: readonly string[] = FEED_REGISTRY.map((feed) => feed.id);

const FEED_COLUMNS: readonly Column<FeedEntry>[] = [
  {
    key: 'name',
    header: 'Feed',
    render: (feed) => (
      <a href={`#${feedAnchor(feed.id)}`} className="depot-link">
        {feed.name}
      </a>
    ),
    title: (feed) => `${feed.name}: show its field list`,
  },
  {
    key: 'status',
    header: 'Status',
    render: (feed) => (
      <span className={`depot-tag ${STATUS_TONE[feed.status]}`}>{FEED_STATUS_LABEL[feed.status]}</span>
    ),
  },
  {
    key: 'fields',
    header: 'Fields',
    align: 'right',
    sortValue: (feed) => feed.fields.length,
    render: (feed) => formatCount(feed.fields.length),
  },
  {
    key: 'summary',
    header: 'What it provides',
    render: (feed) => feed.summary,
    title: (feed) => `${feed.summary} Unlocks: ${feed.unlocks}`,
  },
];

function CoverageSection() {
  const { data, error, loading, refresh } = useDepotNetworkContext();
  // Every bus row belongs to exactly one unit (the unassigned bucket included),
  // so the units' fleets sum to the buses the feed was reduced to.
  const busesCounted = data ? data.depots.reduce((sum, d) => sum + d.fleet, 0) : 0;
  return (
    <section aria-labelledby="coverage-title" className="mb-6">
      <SectionLabel
        id="coverage-title"
        label="Feed coverage"
        tag="derived"
        note="How well the GPS and device feed is populated"
      />
      {loading ? (
        <LoadingBlock rows={6} rowHeight={20} label="Loading feed coverage" />
      ) : !data ? (
        <ErrorPanel
          title="Could not load data sources"
          message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={refresh}
        />
      ) : (
        <>
          <p className="depot-prose mb-3" data-testid="depot-records-sentence">
            {`${recordsSentence(data.recordCount, busesCounted)}.`}
          </p>
          {data.stale || error ? (
            <div className="mb-3">
              <StaleStrip since={data.feedNow} />
            </div>
          ) : null}
          <CoverageBars coverage={data.coverage} />
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
      <SectionLabel label="Feeds" count={FEED_REGISTRY.length} note="Status of each feed behind this module" />
      <div data-testid="depot-feed-registry">
        <DataTable
          columns={FEED_COLUMNS}
          rows={FEED_REGISTRY}
          rowKey={(feed) => feed.id}
          caption="Feeds behind this module"
          fixedRows
          freezeFirstColumn
          overflowCue
        />
      </div>
      <div className="mt-6">
        <SectionLabel label="Field lists" note="One feed at a time" />
        <div className="flex flex-col divide-y divide-depot-line border-b border-depot-line">
          {FEED_REGISTRY.map((feed) => (
            <FeedSchema key={feed.id} feed={feed} allIds={FEED_IDS} />
          ))}
        </div>
      </div>
      <HowProduced testId="depot-produced" className="mt-8">
        <p>
          A coverage bar shows how many of the buses counted carry each field, most complete
          first; a field a bus lacks is not guessed. A field is Complete when every bus carries it,
          Partial from half the buses, and Sparse below that.
        </p>
        <p>
          LIVE feeds are read from the upstream service; MODELLED feeds are generated from
          planning assumptions; AWAITING FEED is not connected yet and its expected schema is
          listed so a real feed can replace the model.
        </p>
      </HowProduced>
    </>
  );
}
