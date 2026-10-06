import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ZOOM_CONTROL_CORNER,
  refitOnResize,
  zoomControlOptions,
} from '@/lib/depot/map/overviewMapView';
import { useDepotMap } from '@/components/depot/network/useDepotMap';

const created = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock('@/lib/maps/authFailure', () => ({ onMapsAuthFailure: () => () => undefined }));
vi.mock('@/lib/maps/loader', () => ({
  isMapsConfigured: () => true,
  getMapsLoader: () => ({
    importLibrary: async (name: string): Promise<unknown> => {
      if (name === 'maps') {
        return {
          Map: class {
            constructor(_el: unknown, options: unknown) {
              created.options.push(options);
            }
          },
        };
      }
      if (name === 'core') return { ControlPosition: { RIGHT_TOP: 3, RIGHT_BOTTOM: 9 } };
      return {};
    },
  }),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  created.options = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  useDepotMap(ref);
  return <div ref={ref} />;
}

describe('overview map framing', () => {
  it('puts the zoom control in the top right corner, above the fold of a 900 px window', () => {
    expect(ZOOM_CONTROL_CORNER).toBe('RIGHT_TOP');
    expect(zoomControlOptions({ RIGHT_TOP: 3 })).toEqual({ position: 3 });
  });

  it('builds the map with the zoom control at that corner', async () => {
    await act(async () => root.render(<Probe />));
    await act(async () => Promise.resolve());
    expect(created.options).toHaveLength(1);
    expect(created.options[0]).toMatchObject({
      zoomControl: true,
      zoomControlOptions: { position: 3 },
    });
  });

  it('fits the units again when the frame changes size, until a person moves the map', () => {
    expect(refitOnResize({ fitted: false, userMoved: false })).toBe(false);
    expect(refitOnResize({ fitted: true, userMoved: false })).toBe(true);
    expect(refitOnResize({ fitted: true, userMoved: true })).toBe(false);
  });
});
