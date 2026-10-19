'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  ChevronRight,
  Command,
  Database,
  History,
  IndianRupee,
  LayoutList,
  ListFilter,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Radar,
  ShieldCheck,
  Sparkles,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';
import { depotIdFromPath } from '@/lib/depot/depotNav';
import type { DecisionCategory } from '@/lib/depot/os/intel/types';
import {
  activeView,
  OPERATIONAL_WORKSPACES,
  viewByKey,
  viewLink,
  WORKSPACES,
  type Workspace,
  type WorkspaceId,
  type WorkspaceView,
} from '@/lib/depot/os/workspaces';
import { AI_KIND, AiGlyph, AiKindChip } from './aiKinds';
import { useIntel } from './IntelProvider';
import { OsOverlay } from './OsOverlay';
import { useOsStore } from './osStore';

export const WORKSPACE_ICON: Readonly<Record<WorkspaceId, LucideIcon>> = {
  mission: Radar,
  network: Network,
  operations: Warehouse,
  reliability: ShieldCheck,
  finance: IndianRupee,
  performance: Activity,
  system: Database,
};

/** The workspace each decision category is worked in, for the sidebar's counts. */
const CATEGORY_WORKSPACE: Readonly<Record<DecisionCategory, WorkspaceId>> = {
  shortage: 'network',
  redistribution: 'network',
  maintenance: 'reliability',
  incident: 'reliability',
  fuel: 'finance',
  crew: 'operations',
  telemetry: 'system',
  efficiency: 'finance',
  schedule: 'operations',
};

/** Where a workspace's entry goes from the current scope: its first view there. */
export function workspaceEntry(workspace: Workspace, depotId: string | null): string {
  const first = workspace.views.find((view) => (depotId === null ? view.network : view.depot) !== null);
  return viewLink(first ?? workspace.views[0]!, depotId);
}

function useActive() {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  return { pathname, search, depotId: depotIdFromPath(pathname), active: activeView(pathname, search) };
}

/** Urgent decisions (critical or high) in the context, by the workspace that works them. */
function useUrgentByWorkspace(): ReadonlyMap<WorkspaceId, { count: number; critical: boolean }> {
  const intel = useIntel();
  return useMemo(() => {
    const out = new Map<WorkspaceId, { count: number; critical: boolean }>();
    for (const d of intel.decisions) {
      if (d.severity !== 'critical' && d.severity !== 'high') continue;
      for (const id of ['mission', CATEGORY_WORKSPACE[d.category]] as const) {
        const prev = out.get(id) ?? { count: 0, critical: false };
        out.set(id, { count: prev.count + 1, critical: prev.critical || d.severity === 'critical' });
      }
    }
    return out;
  }, [intel.decisions]);
}

function matchesFilter(view: WorkspaceView, workspace: Workspace, words: readonly string[]): boolean {
  const hay = `${view.label} ${view.keywords ?? ''} ${workspace.title} ${view.ai ? AI_KIND[view.ai].label : ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Whether the view has its own address in the scope; else the link leads to the other scope. */
function scopeMarker(view: WorkspaceView, depotId: string | null): 'HQ' | 'Depot' | null {
  const own = depotId === null ? view.network !== null : view.depot !== null;
  if (own) return null;
  return depotId === null ? 'Depot' : 'HQ';
}

interface ViewLinkProps {
  readonly view: WorkspaceView;
  readonly depotId: string | null;
  readonly current: boolean;
  readonly onNavigate?: () => void;
  /** Shown before the label in quick access (the workspace's icon). */
  readonly leading?: React.ReactNode;
}

/** One feature row: the link, its AI glyph and scope marker, and a pin toggle on hover. */
function FeatureRow({ view, depotId, current, onNavigate, leading }: ViewLinkProps) {
  const pinned = useOsStore((s) => s.pinnedViews.includes(view.key));
  const togglePinned = useOsStore((s) => s.togglePinned);
  const marker = scopeMarker(view, depotId);
  return (
    <li className="group/row relative flex items-center">
      <Link
        href={viewLink(view, depotId)}
        aria-current={current ? 'page' : undefined}
        onClick={onNavigate}
        data-testid="os-feature-link"
        title={marker === 'Depot' ? `${view.label}: runs per depot; choose one` : marker === 'HQ' ? `${view.label}: runs at Headquarters` : view.label}
        className={`os-tree-link ${current ? 'os-tree-link-active' : ''} ${view.flagship ? 'os-tree-link-flagship' : ''}`}
      >
        {leading}
        <span className="min-w-0 flex-1 truncate">{view.label}</span>
        {marker ? <span className="os-tree-marker">{marker}</span> : null}
        {view.ai ? <AiGlyph kind={view.ai} className="h-3 w-3 opacity-80" /> : null}
      </Link>
      <button
        type="button"
        onClick={() => togglePinned(view.key)}
        aria-label={pinned ? `Unpin ${view.label} from quick access` : `Pin ${view.label} to quick access`}
        className="os-tree-pin"
      >
        {pinned ? <PinOff className="h-3 w-3" aria-hidden /> : <Pin className="h-3 w-3" aria-hidden />}
      </button>
    </li>
  );
}

interface TreeProps {
  /** Closes the drawer after a choice (below 1280px). */
  readonly onNavigate?: () => void;
}

/**
 * The navigation tree: a filter, quick access (pinned and recent), the six workspaces
 * with every feature as its own entry, then System. The current workspace opens by
 * itself; others open on demand and stay open across visits.
 */
function NavTree({ onNavigate }: TreeProps) {
  const { depotId, active } = useActive();
  const navExpanded = useOsStore((s) => s.navExpanded);
  const toggleNavGroup = useOsStore((s) => s.toggleNavGroup);
  const pinnedViews = useOsStore((s) => s.pinnedViews);
  const recentViews = useOsStore((s) => s.recentViews);
  const setPaletteOpen = useOsStore((s) => s.setPaletteOpen);
  const setCapabilitiesOpen = useOsStore((s) => s.setCapabilitiesOpen);
  const urgent = useUrgentByWorkspace();
  const [filter, setFilter] = useState('');
  // The current workspace opens by itself; closing it is remembered until it changes.
  const [shut, setShut] = useState<WorkspaceId | null>(null);
  const currentId = active?.workspace.id ?? null;
  useEffect(() => setShut(null), [currentId]);

  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = words.length > 0;
  const isOpen = (id: WorkspaceId): boolean => filtering || navExpanded.includes(id) || (id === currentId && shut !== id);
  const toggle = (id: WorkspaceId): void => {
    if (isOpen(id)) {
      if (id === currentId) setShut(id);
      toggleNavGroup(id, false);
    } else {
      if (id === currentId) setShut(null);
      toggleNavGroup(id, true);
    }
  };
  const currentKey = active?.view?.key ?? null;
  const quick = pinnedViews.flatMap((key) => {
    const found = viewByKey(key);
    return found ? [found] : [];
  });
  const recent = recentViews
    .filter((key) => key !== currentKey && !pinnedViews.includes(key))
    .slice(0, 3)
    .flatMap((key) => {
      const found = viewByKey(key);
      return found ? [found] : [];
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-3">
        <label className="os-tree-filter">
          <ListFilter className="h-3.5 w-3.5 shrink-0 text-depot-muted" aria-hidden />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFilter('');
            }}
            placeholder="Find a feature"
            aria-label="Find a feature in the navigation"
            data-testid="os-nav-filter"
            className="min-w-0 flex-1 bg-transparent font-sans text-[12.5px] text-depot-ink outline-none placeholder:text-depot-muted"
          />
          {filtering ? (
            <button type="button" onClick={() => setFilter('')} aria-label="Clear the filter" className="text-depot-muted hover:text-depot-ink">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              title="Search vehicles, depots, routes and views"
              className="inline-flex items-center gap-0.5 rounded-[3px] border border-depot-line px-1 font-mono text-[10px] text-depot-muted hover:text-holo-glow"
            >
              <Command className="h-2.5 w-2.5" aria-hidden />K
            </button>
          )}
        </label>
      </div>

      <div className="os-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!filtering && quick.length > 0 ? (
          <section aria-label="Quick access" className="mb-2">
            <div className="os-tree-heading">
              <Pin className="h-3 w-3" aria-hidden />
              Quick access
            </div>
            <ul className="space-y-px">
              {quick.map(({ view, workspace }) => {
                const Icon = WORKSPACE_ICON[workspace.id];
                return (
                  <FeatureRow
                    key={view.key}
                    view={view}
                    depotId={depotId}
                    current={view.key === currentKey}
                    onNavigate={onNavigate}
                    leading={<Icon className="h-3.5 w-3.5 shrink-0 text-depot-faint" aria-hidden />}
                  />
                );
              })}
            </ul>
            {recent.length > 0 ? (
              <>
                <div className="os-tree-heading mt-2">
                  <History className="h-3 w-3" aria-hidden />
                  Recent
                </div>
                <ul className="space-y-px">
                  {recent.map(({ view, workspace }) => {
                    const Icon = WORKSPACE_ICON[workspace.id];
                    return (
                      <FeatureRow
                        key={view.key}
                        view={view}
                        depotId={depotId}
                        current={false}
                        onNavigate={onNavigate}
                        leading={<Icon className="h-3.5 w-3.5 shrink-0 text-depot-faint" aria-hidden />}
                      />
                    );
                  })}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        <div className="os-tree-heading">
          <LayoutList className="h-3 w-3" aria-hidden />
          Workspaces
        </div>
        <ul className="space-y-px" data-testid="os-nav-tree">
          {WORKSPACES.map((workspace) => {
            const views = filtering ? workspace.views.filter((v) => matchesFilter(v, workspace, words)) : workspace.views;
            if (filtering && views.length === 0) return null;
            const Icon = WORKSPACE_ICON[workspace.id];
            const open = isOpen(workspace.id);
            const current = currentId === workspace.id;
            const flag = urgent.get(workspace.id);
            const groupId = `os-nav-group-${workspace.id}`;
            return (
              <li key={workspace.id} className={workspace.id === 'system' ? 'mt-2 border-t border-depot-line pt-2' : ''}>
                <button
                  type="button"
                  onClick={() => toggle(workspace.id)}
                  aria-expanded={open}
                  aria-controls={groupId}
                  data-current={current ? 'true' : undefined}
                  data-testid="os-workspace-link"
                  title={workspace.summary}
                  className={`os-tree-group ${current ? 'os-tree-group-current' : ''}`}
                >
                  <ChevronRight className={`h-3 w-3 shrink-0 text-depot-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`} aria-hidden />
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-left">{workspace.title}</span>
                  {flag ? (
                    <span
                      className={`os-tree-count ${flag.critical ? 'os-tree-count-critical' : ''}`}
                      title={`${flag.count} urgent decision${flag.count === 1 ? '' : 's'} in this context`}
                    >
                      {flag.count}
                    </span>
                  ) : workspace.ordinal ? (
                    <span className="font-mono text-[10px] text-depot-faint">{workspace.ordinal}</span>
                  ) : null}
                </button>
                <div id={groupId} className={`os-tree-collapse ${open ? 'os-tree-collapse-open' : ''}`} inert={!open}>
                  <div className="min-h-0 overflow-hidden">
                    <ul className="os-tree-branch">
                      {views.map((view) => (
                        <FeatureRow key={view.key} view={view} depotId={depotId} current={view.key === currentKey} onNavigate={onNavigate} />
                      ))}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {filtering && WORKSPACES.every((w) => !w.views.some((v) => matchesFilter(v, w, words))) ? (
          <p className="px-3 py-2 font-sans text-[12px] text-depot-prose">No feature matches. Press ⌘K to search vehicles, depots and routes.</p>
        ) : null}
      </div>

      <div className="border-t border-depot-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => setCapabilitiesOpen(true)}
          data-testid="os-capabilities-open"
          className="os-ai-glow flex w-full items-center gap-2 rounded-[4px] border border-holo-glow/25 px-2.5 py-1.5 text-left transition-colors hover:border-holo-glow/50"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-holo-glow" aria-hidden />
          <span className="min-w-0 flex-1 font-sans text-[12px] font-semibold text-depot-ink">AI capabilities</span>
          <span className="flex items-center gap-1">
            <AiGlyph kind="predict" />
            <AiGlyph kind="optimize" />
          </span>
        </button>
        <div className="mt-2 flex items-center justify-between gap-2 font-sans text-[10.5px] text-depot-muted">
          <span className="flex items-center gap-1">
            <AiGlyph kind="monitor" className="h-2.5 w-2.5" /> AI intelligence
          </span>
          <span className="flex items-center gap-1">
            <AiGlyph kind="optimize" className="h-2.5 w-2.5" /> AI optimization
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The collapsed sidebar: one icon per workspace. Hovering or focusing one opens its
 * features beside it, so every feature stays one move away.
 */
function IconRail() {
  const { depotId, active } = useActive();
  const urgent = useUrgentByWorkspace();
  const setCapabilitiesOpen = useOsStore((s) => s.setCapabilitiesOpen);
  const [flyout, setFlyout] = useState<WorkspaceId | null>(null);
  const closeTimer = useRef<number | null>(null);
  const hold = (id: WorkspaceId | null): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setFlyout(id);
  };
  const release = (): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlyout(null), 160);
  };
  const currentKey = active?.view?.key ?? null;

  return (
    <ul className="flex flex-1 flex-col items-center gap-1 py-3" onMouseLeave={release}>
      {WORKSPACES.map((workspace) => {
        const Icon = WORKSPACE_ICON[workspace.id];
        const current = active?.workspace.id === workspace.id;
        const flag = urgent.get(workspace.id);
        return (
          <li
            key={workspace.id}
            className={`relative ${workspace.id === 'system' ? 'mt-2 border-t border-depot-line pt-2' : ''}`}
            onMouseEnter={() => hold(workspace.id)}
            onFocus={() => hold(workspace.id)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) release();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFlyout(null);
            }}
          >
            <Link
              href={workspaceEntry(workspace, depotId)}
              aria-label={workspace.title}
              data-current={current ? 'true' : undefined}
              data-testid="os-workspace-link"
              className={`os-rail-icon ${current ? 'os-rail-icon-active' : ''}`}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
              {flag ? <span className={`os-rail-dot ${flag.critical ? 'bg-alert-crimson' : 'bg-alert-amber'}`} aria-hidden /> : null}
            </Link>
            {flyout === workspace.id ? (
              <div className="os-flyout" role="group" aria-label={workspace.title} onMouseEnter={() => hold(workspace.id)}>
                <div className="flex items-center justify-between gap-2 border-b border-depot-line px-3 py-2">
                  <span className="os-kicker text-holo-glow">
                    {workspace.ordinal ? `${workspace.ordinal} · ` : ''}
                    {workspace.title}
                  </span>
                </div>
                <ul className="space-y-px p-1.5">
                  {workspace.views.map((view) => (
                    <FeatureRow key={view.key} view={view} depotId={depotId} current={view.key === currentKey} onNavigate={() => setFlyout(null)} />
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        );
      })}
      <li className="mt-auto">
        <button type="button" onClick={() => setCapabilitiesOpen(true)} aria-label="AI capabilities" className="os-rail-icon">
          <Sparkles className="h-[18px] w-[18px] text-holo-glow" aria-hidden />
        </button>
      </li>
    </ul>
  );
}

/** Notes each view opened, for the sidebar's Recent list. */
function useNoteRecent(): void {
  const { active } = useActive();
  const noteRecent = useOsStore((s) => s.noteRecent);
  const key = active?.view?.key ?? null;
  useEffect(() => {
    if (key) noteRecent(key);
  }, [key, noteRecent]);
}

/**
 * The sidebar from 1280px: the navigation tree, or an icon rail when collapsed (the
 * choice is kept in this browser). It scrolls on its own, under the bar.
 */
export function WorkspaceRail() {
  const collapsed = useOsStore((s) => s.navCollapsed);
  const setNavCollapsed = useOsStore((s) => s.setNavCollapsed);
  useNoteRecent();

  return (
    <nav
      aria-label="Depot Intelligence OS navigation"
      data-testid="depot-nav"
      data-collapsed={collapsed ? 'true' : undefined}
      className={`os-sidebar hidden shrink-0 xl:block ${collapsed ? 'xl:w-[60px]' : 'xl:w-[264px]'}`}
    >
      <div className="sticky top-[var(--depot-bar-h)] flex h-[calc(100dvh-var(--depot-bar-h))] flex-col">
        <div className={`flex items-center border-b border-depot-line ${collapsed ? 'justify-center py-2' : 'justify-between px-3 py-2'}`}>
          {collapsed ? null : <span className="os-kicker">Navigation</span>}
          <button
            type="button"
            onClick={() => setNavCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar to icons'}
            aria-expanded={!collapsed}
            data-testid="os-nav-collapse"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-depot-prose hover:bg-depot-raised hover:text-holo-glow"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        {collapsed ? <IconRail /> : <NavTree />}
      </div>
    </nav>
  );
}

/** Below 1280px: the workspaces in one scrolling strip, and the full tree behind All features. */
export function WorkspaceStrip() {
  const { depotId, active } = useActive();
  const drawerOpen = useOsStore((s) => s.navDrawerOpen);
  const setNavDrawerOpen = useOsStore((s) => s.setNavDrawerOpen);
  const pathname = usePathname();
  useEffect(() => setNavDrawerOpen(false), [pathname, setNavDrawerOpen]);
  return (
    <>
      <nav
        aria-label="Depot Intelligence OS workspaces"
        data-testid="depot-nav-strip"
        className="os-scroll relative z-30 flex h-[var(--depot-nav-h)] min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-depot-line bg-depot-page px-3 sm:sticky sm:top-[var(--depot-bar-h)] xl:hidden"
      >
        <button
          type="button"
          onClick={() => setNavDrawerOpen(true)}
          aria-expanded={drawerOpen}
          data-testid="os-nav-drawer-open"
          className="mr-1 flex shrink-0 items-center gap-1.5 rounded-[4px] border border-holo-glow/30 bg-holo-glow/[0.06] px-2.5 py-1 font-sans text-[12.5px] font-semibold text-holo-glow"
        >
          <LayoutList className="h-3.5 w-3.5" aria-hidden />
          All features
        </button>
        {OPERATIONAL_WORKSPACES.map((workspace) => {
          const Icon = WORKSPACE_ICON[workspace.id];
          const current = active?.workspace.id === workspace.id;
          return (
            <Link
              key={workspace.id}
              href={workspaceEntry(workspace, depotId)}
              aria-current={current ? 'true' : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-[4px] px-2.5 py-1 font-sans text-[12.5px] font-medium ${
                current ? 'bg-depot-selected text-holo-glow' : 'text-depot-prose hover:text-depot-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {workspace.title}
            </Link>
          );
        })}
      </nav>
      <OsOverlay open={drawerOpen} onClose={() => setNavDrawerOpen(false)} label="All features" variant="nav" testId="os-nav-drawer">
        <div className="flex items-center justify-between border-b border-depot-line px-3 py-2">
          <span className="os-kicker">All features</span>
          <button type="button" onClick={() => setNavDrawerOpen(false)} aria-label="Close" className="os-button os-button-quiet h-7 w-7 px-0">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <NavTree onNavigate={() => setNavDrawerOpen(false)} />
      </OsOverlay>
    </>
  );
}

/**
 * Above each page: where it sits (workspace, then view, with its AI kind), and below
 * 1280px, where the sidebar is not drawn, the workspace's views as tabs.
 */
export function WorkspaceTabs() {
  const { depotId, active } = useActive();
  const setCopilotOpen = useOsStore((s) => s.setCopilotOpen);
  if (!active) return null;
  const { workspace, view: current } = active;
  const Icon = WORKSPACE_ICON[workspace.id];

  return (
    <div data-testid="os-workspace-tabs" className="mb-3 border-b border-holo-glow/10 xl:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-center gap-2" data-testid="os-breadcrumb">
          <Icon className="h-3.5 w-3.5 shrink-0 text-holo-glow" aria-hidden />
          <span className="os-kicker text-holo-glow">
            {workspace.ordinal ? `${workspace.ordinal} · ` : ''}
            {workspace.title}
          </span>
          {current ? (
            <>
              <ChevronRight className="h-3 w-3 shrink-0 text-depot-faint" aria-hidden />
              <span className="truncate font-sans text-[12px] font-medium text-depot-ink">{current.label}</span>
              {current.ai ? <AiKindChip kind={current.ai} /> : null}
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setCopilotOpen(true)}
          className="hidden items-center gap-1.5 font-sans text-[12px] text-depot-prose hover:text-holo-glow sm:inline-flex"
        >
          <Bot className="h-3.5 w-3.5" aria-hidden />
          Ask the copilot about this view
        </button>
      </div>
      <div className="os-scroll -mb-px mt-1 flex min-w-0 items-center overflow-x-auto xl:hidden">
        {workspace.views.map((view) => {
          const selected = current?.key === view.key;
          const marker = scopeMarker(view, depotId);
          return (
            <Link
              key={view.key}
              href={viewLink(view, depotId)}
              aria-current={selected ? 'page' : undefined}
              data-testid="os-view-tab"
              className={`os-tab ${selected ? 'os-tab-active' : ''}`}
            >
              {view.label}
              {marker ? (
                <span className="os-chip border-depot-line text-depot-muted" title={marker === 'HQ' ? 'Runs at Headquarters scope' : 'Runs per depot; choose one'}>
                  {marker}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
