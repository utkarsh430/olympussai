// @vitest-environment jsdom
//
// The basemap authentication failure, which used to be invisible to the app.
//
// FOUND IN A REAL BROWSER, reviewing the control room. A key that the current
// origin is not allowed to use does not fail the way every other basemap
// problem fails: the script loads, `importLibrary` resolves, `new Map()`
// succeeds, and Google then paints a full-bleed white "Oops! Something went
// wrong" panel inside the container while logging RefererNotAllowedMapError.
// Every existing failure path keys off a rejected import, so the app believed
// the map was fine and showed a large white rectangle in the middle of a dark
// operations console.
//
// It is reachable in production, not just in a harness: the key is
// referrer-restricted, so any new domain or port produces exactly this.
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshLoader() {
  vi.resetModules();
  delete (window as { gm_authFailure?: unknown }).gm_authFailure;
  return import('@/lib/maps/loader');
}

describe('basemap authentication failure', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registers Google’s documented hook when the loader is first used', async () => {
    const loader = await freshLoader();
    expect((window as { gm_authFailure?: unknown }).gm_authFailure).toBeUndefined();
    loader.getMapsLoader();
    expect(typeof (window as { gm_authFailure?: unknown }).gm_authFailure).toBe('function');
  });

  it('notifies a subscriber when Google reports the key as unusable', async () => {
    const loader = await freshLoader();
    const listener = vi.fn();
    loader.onMapsAuthFailure(listener);
    expect(loader.mapsAuthFailed()).toBe(false);

    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(loader.mapsAuthFailed()).toBe(true);
  });

  it('tells a map that mounts AFTER the failure, immediately', async () => {
    const loader = await freshLoader();
    loader.getMapsLoader();
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();

    // A second map mounting later would otherwise wait forever for an event
    // that has already been and gone, and render as if all were well.
    const late = vi.fn();
    loader.onMapsAuthFailure(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('stops notifying once unsubscribed', async () => {
    const loader = await freshLoader();
    const listener = vi.fn();
    loader.onMapsAuthFailure(listener)();
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not displace a hook something else already installed', async () => {
    vi.resetModules();
    const existing = vi.fn();
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure = existing;
    const loader = await import('@/lib/maps/loader');
    loader.getMapsLoader();

    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();
    expect(existing).toHaveBeenCalledTimes(1);
  });

  it('installs the hook only once across many loader calls', async () => {
    const loader = await freshLoader();
    loader.getMapsLoader();
    const first = (window as unknown as { gm_authFailure: () => void }).gm_authFailure;
    loader.getMapsLoader();
    loader.getMapsLoader();
    expect((window as unknown as { gm_authFailure: () => void }).gm_authFailure).toBe(first);
  });
});
