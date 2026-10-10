import { describe, expect, it } from 'vitest';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import { depotScopeState } from '@/lib/depot/scopeState';

const DEPOTS = [{ id: '49', name: 'KAUSHAMBI', kind: 'depot', fleet: 200 }] as const;

describe('depotScopeState', () => {
  it('names a depot the feed lists and keeps the tabs', () => {
    expect(depotScopeState({ depotId: '49', depots: DEPOTS, detailError: null })).toEqual({
      known: true,
      label: 'UPSRTC / KAUSHAMBI',
    });
  });

  it('says Unknown depot and hides the tabs when the network is loaded without the depot', () => {
    expect(depotScopeState({ depotId: '999999', depots: DEPOTS, detailError: null })).toEqual({
      known: false,
      label: 'UPSRTC / Unknown depot',
    });
  });

  it('treats a 404 from the depot detail as unknown even before the network answers', () => {
    expect(
      depotScopeState({ depotId: '999999', depots: null, detailError: DEPOT_NOT_FOUND_MESSAGE }),
    ).toMatchObject({ known: false, label: 'UPSRTC / Unknown depot' });
  });

  it('keeps the tabs and the name while the detail failed with a 503', () => {
    const failed = depotScopeState({ depotId: '49', depots: DEPOTS, detailError: 'HTTP 503' });
    expect(failed).toEqual({ known: true, label: 'UPSRTC / KAUSHAMBI' });
  });

  it('falls back to Depot <id> and keeps the tabs when the network list is not available', () => {
    expect(depotScopeState({ depotId: '49', depots: null, detailError: 'HTTP 503' })).toEqual({
      known: true,
      label: 'UPSRTC / Depot 49',
    });
    expect(depotScopeState({ depotId: '49', depots: null, detailError: null })).toEqual({
      known: true,
      label: 'UPSRTC / Depot 49',
    });
  });

  it('is the network scope when there is no depot id', () => {
    expect(depotScopeState({ depotId: null, depots: DEPOTS, detailError: null })).toEqual({
      known: true,
      label: 'UPSRTC / Headquarters',
    });
  });
});
