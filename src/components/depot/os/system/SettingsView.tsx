'use client';

import { useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen, Pin, RotateCcw, Trash2, X } from 'lucide-react';
import { formatCount } from '@/lib/depot/format';
import { viewByKey } from '@/lib/depot/os/workspaces';
import { CYCLE_CHOICES, useAiStore } from '../ai/aiStore';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { useSchedStore } from '../sched/schedStore';
import { Panel } from '../ui';

function Row({ title, detail, children }: { readonly title: string; readonly detail: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-holo-glow/[0.07] px-4 py-3 last:border-b-0">
      <div className="min-w-0 max-w-xl">
        <div className="font-sans text-[13px] font-semibold text-depot-ink">{title}</div>
        <p className="depot-note">{detail}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Settings of Depot Intelligence OS, all kept in this browser: the sidebar's shape and
 * quick access, the AI engine's analysis cycle, and the reviews, saved scenarios and cases
 * this browser holds.
 */
export function SettingsView() {
  const navCollapsed = useOsStore((s) => s.navCollapsed);
  const setNavCollapsed = useOsStore((s) => s.setNavCollapsed);
  const pinnedViews = useOsStore((s) => s.pinnedViews);
  const togglePinned = useOsStore((s) => s.togglePinned);
  const resetPinned = useOsStore((s) => s.resetPinned);
  const recentViews = useOsStore((s) => s.recentViews);
  const clearRecent = useOsStore((s) => s.clearRecent);
  const reviews = useOsStore((s) => s.reviews);
  const clearReviews = useOsStore((s) => s.clearReviews);
  const fuelCases = useOsStore((s) => s.fuelCases);
  const clearFuelCases = useOsStore((s) => s.clearFuelCases);
  const savedScenarios = useSchedStore((s) => s.saved.length);
  const clearScenarios = useSchedStore((s) => s.clear);
  const hydrateSched = useSchedStore((s) => s.hydrate);
  useEffect(() => hydrateSched(), [hydrateSched]);
  const intervalSec = useAiStore((s) => s.intervalSec);
  const setIntervalSec = useAiStore((s) => s.setIntervalSec);
  const caseCount = Object.keys(fuelCases).length;

  return (
    <div className="space-y-4" data-testid="os-settings">
      <OsHeader title="Settings" description="How the OS looks and runs in this browser. Nothing here changes data for anyone else." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel kicker="Navigation" title="Sidebar and quick access" bodyClassName="p-0">
          <Row title="Sidebar" detail="Full tree with every feature, or an icon rail whose workspaces open beside it.">
            <button type="button" onClick={() => setNavCollapsed(!navCollapsed)} className="os-button os-button-quiet" aria-pressed={navCollapsed}>
              {navCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden /> : <PanelLeftClose className="h-3.5 w-3.5" aria-hidden />}
              {navCollapsed ? 'Show the full tree' : 'Collapse to icons'}
            </button>
          </Row>
          <Row title="Quick access" detail="Pinned features sit at the top of the sidebar. Pin or unpin any feature from its row in the tree.">
            <button type="button" onClick={resetPinned} className="os-button os-button-quiet">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reset to the flagships
            </button>
          </Row>
          <ul className="flex flex-wrap gap-1.5 px-4 pb-3">
            {pinnedViews.length === 0 ? <li className="depot-note">Nothing pinned.</li> : null}
            {pinnedViews.map((key) => {
              const found = viewByKey(key);
              if (!found) return null;
              return (
                <li key={key} className="os-chip border-holo-glow/30 text-holo-glow">
                  <Pin className="h-2.5 w-2.5" aria-hidden />
                  {found.view.label}
                  <button type="button" onClick={() => togglePinned(key)} aria-label={`Unpin ${found.view.label}`} className="ml-0.5 text-depot-muted hover:text-depot-ink">
                    <X className="h-2.5 w-2.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <Row title="Recent" detail={`${formatCount(recentViews.length)} recently opened features shown under quick access.`}>
            <button type="button" onClick={clearRecent} disabled={recentViews.length === 0} className="os-button os-button-quiet">
              Clear recent
            </button>
          </Row>
        </Panel>

        <Panel kicker="AI engine" title="Analysis cycle" bodyClassName="p-0">
          <Row
            title="Scheduled analysis"
            detail="How often the engine re-runs its analyses on the current snapshot and writes what changed to Network Activity. Paused, it runs only on a new context or when asked."
          >
            <div role="radiogroup" aria-label="Analysis cycle" className="flex overflow-hidden rounded-[4px] border border-depot-line">
              {CYCLE_CHOICES.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  role="radio"
                  aria-checked={intervalSec === sec}
                  onClick={() => setIntervalSec(sec)}
                  className={`px-3 py-1.5 font-mono text-[11.5px] ${intervalSec === sec ? 'bg-holo-glow/15 text-holo-glow' : 'text-depot-prose hover:bg-depot-raised'}`}
                >
                  {sec === 0 ? 'Paused' : `${sec} s`}
                </button>
              ))}
            </div>
          </Row>
        </Panel>

        <Panel kicker="Records in this browser" title="Reviews, scenarios and cases" bodyClassName="p-0" className="xl:col-span-2">
          <Row title="Decision reviews" detail={`${formatCount(reviews.length)} approvals, deferrals and rejections recorded against AI decisions and proposals.`}>
            <button
              type="button"
              disabled={reviews.length === 0}
              onClick={() => {
                if (window.confirm('Clear every decision review recorded in this browser?')) clearReviews();
              }}
              className="os-button os-button-quiet"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Clear
            </button>
          </Row>
          <Row title="Saved scheduling scenarios" detail={`${formatCount(savedScenarios)} bus, crew and joint plans saved from the schedulers.`}>
            <button
              type="button"
              disabled={savedScenarios === 0}
              onClick={() => {
                if (window.confirm('Delete every saved scheduling scenario in this browser?')) clearScenarios();
              }}
              className="os-button os-button-quiet"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Clear
            </button>
          </Row>
          <Row title="Fuel audit cases" detail={`${formatCount(caseCount)} flagged journeys with a case status or an assignee.`}>
            <button
              type="button"
              disabled={caseCount === 0}
              onClick={() => {
                if (window.confirm('Clear every fuel audit case recorded in this browser?')) clearFuelCases();
              }}
              className="os-button os-button-quiet"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Clear
            </button>
          </Row>
        </Panel>
      </div>
    </div>
  );
}
