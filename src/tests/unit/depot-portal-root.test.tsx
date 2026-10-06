// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useRouteProfile', () => ({
  useRouteProfile: () => ({ data: null, error: null, loading: true }),
}));

import { BusDrawer } from '@/components/depot/roster/BusDrawer';
import { RouteDrawer } from '@/components/depot/routes/RouteDrawer';
import { DEPOT_PORTAL_ROOT_ID, depotPortalRoot } from '@/lib/depot/portalRoot';

/**
 * The module's sans typeface is a CSS variable set on a wrapper inside the page, not on
 * <html>. A dialog portalled to <body> sits outside that wrapper, its `font-family` cannot
 * resolve, and the browser falls back to a serif face. So dialogs are portalled to a root
 * inside the shell when there is one.
 */
describe('depot portal root', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.getElementById(DEPOT_PORTAL_ROOT_ID)?.remove();
  });

  function addShellRoot(): HTMLElement {
    const el = document.createElement('div');
    el.id = DEPOT_PORTAL_ROOT_ID;
    document.body.append(el);
    return el;
  }

  it('is the element inside the shell when there is one, otherwise the body', () => {
    expect(depotPortalRoot()).toBe(document.body);
    const el = addShellRoot();
    expect(depotPortalRoot()).toBe(el);
  });

  it('holds the bus drawer', () => {
    const el = addShellRoot();
    act(() =>
      root.render(
        <BusDrawer
          registration="MH12AB1000"
          row={null}
          feedNow={null}
          onClose={() => undefined}
          restoreFocusTo={() => null}
        />,
      ),
    );
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('holds the route drawer', () => {
    const el = addShellRoot();
    act(() =>
      root.render(
        <RouteDrawer
          route={{ routeName: 'RKD_1_ORD_OUT', buses: 2, operators: [], deadKm: null }}
          move={null}
          onClose={() => undefined}
          onProfiled={() => undefined}
          restoreFocusTo={() => null}
        />,
      ),
    );
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
