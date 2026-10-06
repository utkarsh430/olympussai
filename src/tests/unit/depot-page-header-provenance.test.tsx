import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import type { Provenance } from '@/lib/depot/types';

// Only the feed state is read; the real provider would start a poll.
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({
    data: { source: 'live', stale: false, feedNow: '2026-10-06T12:36:10Z', fetchedAt: 'x' },
    error: null,
    loading: false,
    refresh: () => {},
  }),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;
let container: HTMLElement;

async function noteFor(provenance: Provenance): Promise<string> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(<PageHeader title="Page" description="A sentence." provenance={provenance} />),
  );
  const note = container.querySelector('[data-testid="depot-header-provenance"] span:last-child');
  return note?.textContent ?? '';
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

describe('PageHeader provenance note', () => {
  it('reads the modelled wording on a modelled page, never "from the live feed"', async () => {
    const note = await noteFor('modelled');
    expect(note).toBe('Modelled: generated figures, anchored on the live feed at 12:36');
    expect(note).not.toMatch(/^from the live feed/i);
  });

  it('reads the reference wording on a reference page', async () => {
    expect(await noteFor('reference')).toBe('Reference data, curated');
  });
});
