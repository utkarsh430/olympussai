'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import {
  FEED_REGISTRY,
  FEED_STATUS_LABEL,
  type FeedEntry,
  type FeedStatus,
} from '@/lib/depot/sources/registry';
import {
  GPS_FEED_ID,
  clockAheadSentence,
  exclusionNote,
  feedAnchor,
  feedIdFromHash,
  fieldsExpandLabel,
  recordsSentence,
} from '@/lib/depot/sources/sourcesModel';
import { CoverageBars } from './CoverageBars';
import { FeedSchema } from './FeedSchema';
import { HowProduced } from '@/components/depot/shell/HowProduced';

const STATUS_TONE: Readonly<Record<FeedStatus, string>> = {
  live: 'border-alert-green/50 text-alert-green',
  modelled: 'border-alert-amber/50 text-alert-amber',
  awaiting: 'border-depot-muted/50 text-depot-muted',
};

const FEED_IDS: readonly string[] = FEED_REGISTRY.map((feed) => feed.id);

/**
 * The feeds table's columns. Each row is the expander for its own field list (the count is
 * in the expander's label, so there is no FIELDS column). The table does not use
 * `fixedRows`: "What it provides" may wrap to two lines, the one exception to the no-wrap
 * rule, because this is a reference table read for its descriptions.
 */
function feedColumns(clockAhead: string | null): readonly Column<FeedEntry>[] {
  return [
    {
      key: 'name',
      header: 'Feed',
      render: (feed) => (
        <span
          id={feedAnchor(feed.id)}
          className="scroll-mt-[var(--depot-anchor-mt)] whitespace-nowrap text-depot-ink"
        >
          {feed.name}
        </span>
      ),
      title: (feed) => feed.name,
    },
    {
      key: 'status',
      header: 'Status',
      render: (feed) => (
        <span className={`depot-tag whitespace-nowrap ${STATUS_TONE[feed.status]}`}>
          {FEED_STATUS_LABEL[feed.status]}
        </span>
      ),
    },
    {
      key: 'summary',
      header: 'What it provides',
      render: (feed) => (
        <span className="block min-w-[16rem] whitespace-normal font-sans text-[13px]">
          <span className="line-clamp-2" title={feed.summary}>
            {feed.summary}
          </span>
          {feed.id === GPS_FEED_ID && clockAhead !== null ? (
            <span className="depot-note block" data-testid="depot-clock-ahead">
              {clockAhead}
            </span>
          ) : null}
        </span>
      ),
      title: (feed) => feed.summary,
    },
  ];
}

/**
 * The feed a `#feed-<id>` link names (other pages link here), read after mount and on every
 * hash change. The table opens that row on its first render (`initialExpandedKey`, remounted
 * per hash), so no toggle is clicked.
 */
function useFeedFromHash(): string | null {
  const [feedId, setFeedId] = useState<string | null>(null);
  useEffect(() => {
    const read = (): void => setFeedId(feedIdFromHash(window.location.hash, FEED_IDS));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return feedId;
}

/**
 * Brings the named row into view once the coverage block above it has its final height
 * (scrolling while it still loads leaves the row below the fold). The anchor carries the
 * shell's `--depot-anchor-mt` scroll margin, so it lands below the sticky layers.
 */
function useScrollToFeed(feedId: string | null, settled: boolean): void {
  useEffect(() => {
    if (feedId === null || !settled) return;
    document.getElementById(feedAnchor(feedId))?.scrollIntoView?.({ block: 'start' });
  }, [feedId, settled]);
}

const HOW_PRODUCED: readonly string[] = [
  'A coverage bar shows how many of the buses counted carry each field, most complete first; a field a bus lacks is not guessed. A field is Complete when every bus carries it, Partial from half the buses, and Sparse below that.',
  'LIVE feeds are read from the upstream service; MODELLED feeds are generated from planning assumptions; AWAITING FEED is not connected yet and its expected schema is listed so a real feed can replace the model.',
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
          <div className="mb-3">
          <p className="depot-prose" data-testid="depot-records-sentence">
            {`${recordsSentence(data.recordCount, busesCounted)}.`}
          </p>
          {exclusionNote(data.recordCount, busesCounted) ? (
            <p className="depot-note" data-testid="depot-exclusion-note">
              {exclusionNote(data.recordCount, busesCounted)}
            </p>
          ) : null}
          </div>
          {data.stale || error ? (
            <div className="mb-3">
              <StaleNotice since={data.feedNow} />
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
  const { data, loading } = useDepotNetworkContext();
  const clockAhead = clockAheadSentence(data?.feedClockAheadRows);
  const columns = useMemo(() => feedColumns(clockAhead), [clockAhead]);
  const hashFeed = useFeedFromHash();
  useScrollToFeed(hashFeed, !loading);
  return (
    <>
      <CoverageSection />
      <SectionLabel label="Feeds" count={FEED_REGISTRY.length} note="Open a feed for its field list" />
      <div data-testid="depot-feed-registry">
        <DataTable
          key={hashFeed ?? 'none'}
          initialExpandedKey={hashFeed ?? undefined}
          columns={columns}
          rows={FEED_REGISTRY}
          rowKey={(feed) => feed.id}
          caption="Feeds behind this module"
          renderExpanded={(feed) => <FeedSchema feed={feed} />}
          expandLabel={fieldsExpandLabel}
          multipleExpanded
          freezeFirstColumn
          overflowCue
        />
      </div>
      <HowProduced testId="depot-produced" className="mt-10" paragraphs={HOW_PRODUCED} />
    </>
  );
}
