'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import {
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { formatClockTime } from '@/lib/depot/format';
import { LOAD_ERROR_TITLE, loadErrorBody } from '@/lib/depot/loadError';
import { OVERVIEW_HOW_PRODUCED } from '@/lib/depot/network/howProduced';
import { joinScores } from '@/lib/depot/network/overviewModel';
import { exceptionWindowNote } from '@/lib/depot/score/windowWords';
import type { DepotNetworkResponse } from '@/lib/depot/api';
import { BriefingCard } from '@/components/depot/copilot/BriefingCard';
import type { CopilotScope } from '@/lib/depot/copilot/wire';
import { DepotTable } from './DepotTable';
import { MapSection } from './MapSection';
import { ExceptionSummary } from './ExceptionSummary';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { KpiBand } from './KpiBand';
import { RankedStrip } from './RankedStrip';
import { SelectionBar } from './SelectionBar';

const SECTION = 'animate-rise';
const OPERATIONS_HREF = '/project/upsrtc';
/** Module-level so the card's request body keeps one identity across polls. */
const NETWORK_SCOPE: CopilotScope = { kind: 'network' };
const BRIEFING_ROW_SENTENCE =
  'A short written summary of these figures. Advisory: it describes, it does not instruct.';

function OverviewLoading() {
  return (
    <div className="space-y-8" data-testid="depot-overview-loading">
      <LoadingBlock rows={2} rowHeight={72} label="Loading network figures" />
      <div className="depot-map-layout">
        <LoadingBlock rows={1} rowHeight={460} label="Loading the units map" />
        <LoadingBlock rows={1} rowHeight={220} label="Loading the depot summary" />
      </div>
      <LoadingBlock rows={6} label="Loading the ranked depots" />
      <LoadingBlock rows={4} label="Loading exceptions" />
      <LoadingBlock rows={8} label="Loading the units table" />
    </div>
  );
}

function OverviewBody({ data }: { readonly data: DepotNetworkResponse }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(() => joinScores(data.depots, data.scores), [data.depots, data.scores]);
  const [vanished, setVanished] = useState(false);
  const select = useCallback((depotId: string | null) => {
    setSelectedId(depotId);
    setVanished(false);
  }, []);
  const selected = rows.find((row) => row.depot.id === selectedId) ?? null;

  // A poll can drop the selected depot; say so instead of showing nothing.
  useEffect(() => {
    if (selectedId === null || selected) return;
    setSelectedId(null);
    setVanished(true);
  }, [selectedId, selected]);

  return (
    <div className="space-y-8">
      <div className={SECTION}>
        <KpiBand kpis={data.kpis} depots={data.depots} />
      </div>
      {rows.length === 0 ? (
        <StatePanel
          kind="no-data"
          rows={6}
          sentence="The feed returned no units on this snapshot, so there is nothing to map, rank or list."
          remedy="The page fills in on the next poll that carries units."
        />
      ) : (
        <MapSection
          rows={rows}
          selected={selected}
          onSelect={select}
          vanished={vanished}
        />
      )}
      <div className={SECTION}>
        <NetworkBriefingRow feedNow={data.feedNow} />
      </div>
      {rows.length === 0 ? null : (
        <>
          <div className={SECTION}>
            <RankedStrip
              rows={rows}
              selectedId={selectedId}
              onSelect={select}
              windowSamples={data.scoreWindow?.samples}
            />
          </div>
          <div className={SECTION}>
            <ExceptionSummary
              counts={data.exceptionCounts}
              severities={data.exceptionSeverityCounts}
              windowNote={exceptionWindowNote(data.scoreWindow, data.feedNow)}
            />
          </div>
          <div className={SECTION}>
            <DepotTable
              rows={rows}
              selectedId={selectedId}
              onSelect={select}
              selection={<SelectionBar row={selected} />}
            />
          </div>
        </>
      )}
      <HowProduced paragraphs={OVERVIEW_HOW_PRODUCED} className="mt-10" />
    </div>
  );
}

/**
 * The briefing as the cockpit's row: label, one sentence, "Open briefing" on the right.
 * Opening mounts the card in place; closing hides it without unmounting, so a written
 * text is kept. The card is given the page's feed time, so its footer says when the
 * page has moved on since the text was written.
 */
function NetworkBriefingRow({ feedNow }: { readonly feedNow: string | null }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const bodyId = useId();
  const toggle = (): void => {
    setMounted(true);
    setOpen((value) => !value);
  };
  return (
    <section aria-labelledby="network-briefing-row" data-testid="depot-briefing-row" className="min-w-0 border-y border-depot-line">
      <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
        <h2 id="network-briefing-row" className="depot-label">
          Network briefing
        </h2>
        <p className="depot-note min-w-0 flex-1 truncate">{BRIEFING_ROW_SENTENCE}</p>
        <button type="button" className="hud-button shrink-0" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          {open ? 'Close briefing' : 'Open briefing'}
        </button>
      </div>
      {/* Hidden by class, not the attribute: a closed card keeps its written text. */}
      <div id={bodyId} className={open ? 'pb-3' : 'hidden'}>
        {mounted ? (
          <BriefingCard scope={NETWORK_SCOPE} title="Network briefing" currentFeedTime={feedNow} />
        ) : null}
      </div>
    </section>
  );
}

/** The no-data error: what happened and when, Retry, and the way back to Operations. */
function OverviewError({ onRetry }: { readonly onRetry: () => void }) {
  // Seen once, when the failure first rendered; a re-render must not move the time.
  const [at] = useState(() => formatClockTime(new Date()));
  return (
    <ErrorPanel title={LOAD_ERROR_TITLE} message={loadErrorBody(at, null)} onRetry={onRetry}>
      <Link href={OPERATIONS_HREF} className="depot-link text-[13px]">
        Back to Operations
      </Link>
    </ErrorPanel>
  );
}

/**
 * The network overview: KPI band, depot map with its summary panel, ranked
 * depots, exceptions and the units table, all from the shell's single poll.
 * There is always something on screen: placeholders, an error with Retry, or
 * the last good data under a stale strip.
 */
export function NetworkOverview() {
  const { data, error, loading, refresh } = useDepotNetworkContext();

  if (!data) {
    if (loading || !error) return <OverviewLoading />;
    return <OverviewError onRetry={refresh} />;
  }

  return (
    <div data-testid="depot-overview">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <OverviewBody data={data} />
    </div>
  );
}
