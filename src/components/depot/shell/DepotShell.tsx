import { Suspense } from 'react';
import { FooterDisclaimer } from '@/components/shared/FooterDisclaimer';
import { DepotNetworkProvider } from '@/components/depot/data/DepotNetworkProvider';
import { AiEngine } from '@/components/depot/os/ai/AiEngine';
import { AiRibbon } from '@/components/depot/os/ai/AiRibbon';
import { CapabilityExplorer } from '@/components/depot/os/CapabilityExplorer';
import { CommandPalette } from '@/components/depot/os/CommandPalette';
import { CopilotDock } from '@/components/depot/os/CopilotDock';
import { EntityDrawer } from '@/components/depot/os/EntityDrawer';
import { IntelProvider } from '@/components/depot/os/IntelProvider';
import { OsHydrator } from '@/components/depot/os/OsHydrator';
import { OsTopBar } from '@/components/depot/os/OsTopBar';
import { SectionScroller } from '@/components/depot/os/SectionScroller';
import { WorkspaceRail, WorkspaceStrip, WorkspaceTabs } from '@/components/depot/os/WorkspaceNav';
import { DEPOT_PORTAL_ROOT_ID } from '@/lib/depot/portalRoot';
import { PageRefreshNotice } from './PageRefreshNotice';

/**
 * Frame of Depot Intelligence OS: the bar (brand, context, search, AI and data status,
 * copilot), the six workspaces (a rail from 1280px, a strip below it), the workspace's
 * view tabs above each page, the copilot dock on the right while open, and the overlays
 * every workspace shares (command palette, entity profiles, the AI capability index).
 * What sticks where is defined once, as the `--depot-*` custom properties on
 * `.depot-shell` in globals.css. `<main>` is focusable so the skip link can move focus
 * into it. The network poll and the OS's shared intelligence run once here for every page.
 */
export function DepotShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <DepotNetworkProvider>
      <Suspense fallback={null}>
        <IntelProvider>
          <OsHydrator />
          <SectionScroller />
          <AiEngine />
          <div className="depot-shell flex min-h-dvh flex-col">
            <a
              href="#depot-main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-holo-glow focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-void"
            >
              Skip to depot content
            </a>
            <OsTopBar />
            <WorkspaceStrip />
            <div className="flex min-w-0 flex-1 flex-col xl:flex-row">
              <WorkspaceRail />
              <main
                id="depot-main"
                tabIndex={-1}
                className="min-w-0 flex-1 scroll-mt-[var(--depot-sticky-top)] px-4 pb-8 pt-4 focus-visible:outline-offset-[-2px] sm:px-6"
              >
                <WorkspaceTabs />
                <AiRibbon />
                <PageRefreshNotice />
                {children}
              </main>
              <CopilotDock />
            </div>
            <FooterDisclaimer variant="depot" />
            <CommandPalette />
            <EntityDrawer />
            <CapabilityExplorer />
            {/* Dialogs and drawers are portalled here, inside the shell's type and typeface. */}
            <div id={DEPOT_PORTAL_ROOT_ID} />
          </div>
        </IntelProvider>
      </Suspense>
    </DepotNetworkProvider>
  );
}
