import { FooterDisclaimer } from '@/components/shared/FooterDisclaimer';
import { DepotNetworkProvider } from '@/components/depot/data/DepotNetworkProvider';
import { DepotNav } from './DepotNav';
import { DepotTopBar } from './DepotTopBar';

/**
 * Frame for every depot page: top bar, the navigation (a left rail from 900px, one
 * strip under the bar below it), a scrolling main region, and the prototype
 * disclaimer. The disclaimer is in the page flow after the content (the last child of
 * a min-height column), never fixed or sticky, so the shell reserves no space for it.
 * What sticks where is defined once, as the `--depot-*` custom properties on
 * `.depot-shell` in globals.css.
 * `<main>` is focusable (tabIndex -1) so the skip link can move focus into it;
 * its focus ring is drawn inside the box so nothing clips it. The shell stays a
 * server component; the client provider polls the network feed once for the
 * top bar's feed chip and every page below it.
 */
export function DepotShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <DepotNetworkProvider>
      <div className="depot-shell flex min-h-dvh flex-col">
        <a
          href="#depot-main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-holo-glow focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-void"
        >
          Skip to depot content
        </a>
        <DepotTopBar />
        <div className="flex min-w-0 flex-1 flex-col min-[900px]:flex-row">
          <DepotNav />
          <main
            id="depot-main"
            tabIndex={-1}
            className="min-w-0 flex-1 scroll-mt-[var(--depot-sticky-top)] px-4 pb-10 pt-6 focus-visible:outline-offset-[-2px] sm:px-6"
          >
            {children}
          </main>
        </div>
        <FooterDisclaimer variant="dark" />
      </div>
    </DepotNetworkProvider>
  );
}
