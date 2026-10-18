'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity,
  Bot,
  Database,
  IndianRupee,
  Network,
  Plug,
  Radar,
  ShieldCheck,
  Sparkles,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { depotIdFromPath } from '@/lib/depot/depotNav';
import {
  activeView,
  OPERATIONAL_WORKSPACES,
  viewLink,
  WORKSPACES,
  type Workspace,
  type WorkspaceId,
} from '@/lib/depot/os/workspaces';
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

const SYSTEM_ICON: Readonly<Record<string, LucideIcon>> = {
  sources: Database,
  'data-health': Plug,
  ask: Bot,
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

/**
 * The left rail from 1280px: the six workspaces, numbered, then System. The workspace
 * holding the current view is lit; its views are the tabs above the page, so the rail
 * stays six lines long. A button at the foot opens the AI capability index.
 */
export function WorkspaceRail() {
  const { depotId, active } = useActive();
  const setCapabilitiesOpen = useOsStore((s) => s.setCapabilitiesOpen);
  const system = WORKSPACES.find((w) => w.id === 'system');

  return (
    <nav
      aria-label="Depot Intelligence OS workspaces"
      data-testid="depot-nav"
      className="hidden shrink-0 border-r border-depot-line bg-depot-bar/80 xl:block xl:w-[224px]"
    >
      <div className="os-scroll sticky top-[var(--depot-bar-h)] flex max-h-[calc(100dvh-var(--depot-bar-h))] flex-col overflow-y-auto px-3 py-4">
        <div className="os-kicker px-3 pb-2">Workspaces</div>
        <ul className="space-y-0.5">
          {OPERATIONAL_WORKSPACES.map((workspace) => {
            const Icon = WORKSPACE_ICON[workspace.id];
            const current = active?.workspace.id === workspace.id;
            return (
              <li key={workspace.id}>
                <Link
                  href={workspaceEntry(workspace, depotId)}
                  aria-current={current ? 'true' : undefined}
                  title={workspace.summary}
                  data-testid="os-workspace-link"
                  className={`os-rail-link ${current ? 'os-rail-link-active' : ''}`}
                >
                  <span className="os-rail-ordinal">{workspace.ordinal}</span>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{workspace.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => setCapabilitiesOpen(true)}
          data-testid="os-capabilities-open"
          className="os-ai-glow mt-5 flex items-center gap-2 rounded-[4px] border border-holo-glow/25 px-3 py-2 text-left transition-colors hover:border-holo-glow/50"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-holo-glow" aria-hidden />
          <span className="min-w-0">
            <span className="block font-sans text-[12.5px] font-semibold text-depot-ink">AI capabilities</span>
            <span className="block font-sans text-[11px] text-depot-prose">Where each one runs</span>
          </span>
        </button>

        {system ? (
          <div className="mt-6 border-t border-depot-line pt-4">
            <div className="os-kicker px-3 pb-2">System</div>
            <ul className="space-y-0.5">
              {system.views.map((view) => {
                const Icon = SYSTEM_ICON[view.key] ?? Database;
                const current = active?.view?.key === view.key;
                return (
                  <li key={view.key}>
                    <Link
                      href={viewLink(view, depotId)}
                      aria-current={current ? 'page' : undefined}
                      className={`os-rail-link py-1.5 text-[12.5px] ${current ? 'os-rail-link-active' : ''}`}
                    >
                      <Icon className="ml-8 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{view.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

/** Below 1280px: the six workspaces in one scrolling strip under the bar. */
export function WorkspaceStrip() {
  const { depotId, active } = useActive();
  return (
    <nav
      aria-label="Depot Intelligence OS workspaces"
      data-testid="depot-nav-strip"
      className="os-scroll relative z-30 flex h-[var(--depot-nav-h)] min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-depot-line bg-depot-page px-3 sm:sticky sm:top-[var(--depot-bar-h)] xl:hidden"
    >
      {WORKSPACES.map((workspace) => {
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
  );
}

/**
 * The workspace's views as tabs above the page. A view that runs only at Headquarters is
 * marked HQ from a depot; one that runs per depot is marked DEPOT at Headquarters and
 * leads to the depot chooser.
 */
export function WorkspaceTabs() {
  const { depotId, active } = useActive();
  const setCopilotOpen = useOsStore((s) => s.setCopilotOpen);
  if (!active) return null;
  const { workspace, view: current } = active;
  const Icon = WORKSPACE_ICON[workspace.id];

  return (
    <div data-testid="os-workspace-tabs" className="mb-5 border-b border-holo-glow/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-holo-glow" aria-hidden />
          <span className="os-kicker text-holo-glow">
            {workspace.ordinal ? `${workspace.ordinal} · ` : ''}
            {workspace.title}
          </span>
          <span className="hidden truncate font-sans text-[12px] text-depot-prose lg:inline">
            {workspace.summary}
          </span>
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
      <div className="os-scroll -mb-px mt-1 flex min-w-0 items-center overflow-x-auto">
        {workspace.views.map((view) => {
          const selected = current?.key === view.key;
          const own = depotId === null ? view.network !== null : view.depot !== null;
          const marker = own ? null : depotId === null ? 'Depot' : 'HQ';
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
