import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YardMapLegend } from '@/components/depot/yard/YardMapLegend';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;
let container: HTMLDivElement;
let root: Root;

async function legendText(drawn: number, withoutPosition: number): Promise<string> {
  await act(async () => {
    root.render(<YardMapLegend visitorsDrawn={drawn} visitorsWithoutPosition={withoutPosition} />);
  });
  return container.textContent ?? '';
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('YardMapLegend visitor ring sentence', () => {
  it('is absent when no visitor is drawn, with no "0 drawn"', async () => {
    const text = await legendText(0, 0);
    expect(text).toContain('A filled dot is one of this depot');
    expect(text).not.toContain('A ring with no fill');
    expect(text).not.toContain('0 drawn');
  });

  it('still tells the reader about visitors with no position when none is drawn', async () => {
    const text = await legendText(0, 2);
    expect(text).not.toContain('A ring with no fill');
    expect(text).not.toContain('0 drawn');
    expect(text).toContain('2 buses from other depots have no position in the feed');
  });

  it('explains the ring and counts the drawn visitors when some are drawn', async () => {
    const text = await legendText(3, 0);
    expect(text).toContain('A ring with no fill is a bus from another depot standing here: 3 drawn.');
  });

  it('adds the visitors with no position beside the drawn count', async () => {
    const text = await legendText(1, 2);
    expect(text).toContain('1 drawn, 2 with no position in the feed, listed below only.');
  });
});
