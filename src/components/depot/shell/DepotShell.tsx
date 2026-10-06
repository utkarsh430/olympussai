import { FooterDisclaimer } from '@/components/shared/FooterDisclaimer';
import { NETWORK_NAV } from '@/lib/depot/nav';
import { DepotNav } from './DepotNav';
import { DepotTopBar } from './DepotTopBar';

/**
 * Frame for every depot page: sticky top bar, sticky left rail, a scrolling
 * main region, and the prototype disclaimer at the foot of the column.
 * `<main>` is focusable (tabIndex -1) so the skip link can move focus into it;
 * its focus ring is drawn inside the box so nothing clips it.
 */
export function DepotShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="depot-shell flex min-h-dvh flex-col">
      <a
        href="#depot-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-holo-glow focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-void"
      >
        Skip to depot content
      </a>
      <DepotTopBar />
      <div className="flex min-w-0 flex-1 flex-col min-[900px]:flex-row">
        <DepotNav groups={NETWORK_NAV} />
        <main
          id="depot-main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-6 py-6 focus-visible:outline-offset-[-2px]"
        >
          {children}
        </main>
      </div>
      <FooterDisclaimer variant="dark" />
    </div>
  );
}
