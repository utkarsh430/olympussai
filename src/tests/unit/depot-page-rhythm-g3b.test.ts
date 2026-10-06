import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The round-5 rhythm causes that sat in these pages (shell report S3, section E): each
 * page now spaces its sections with the shared depot-stack only, so a band's bottom rule
 * sits 40 px above the next section's rule.
 */
const PAGES = [
  'src/components/depot/fuel/FuelPage.tsx',
  'src/components/depot/revenue/RevenuePage.tsx',
  'src/components/depot/economics/EconomicsPage.tsx',
  'src/components/depot/maintenance/MaintenancePage.tsx',
  'src/components/depot/trends/DepotTrends.tsx',
] as const;

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('page rhythm on the shared stack', () => {
  it.each(PAGES)('%s uses depot-stack and no hand-picked section gap', (path) => {
    const text = source(path);
    expect(text).toContain('depot-stack');
    expect(text).not.toMatch(/flex flex-col gap-(6|8)\b/);
    expect(text).not.toMatch(/className="mt-8"/);
  });

  it('keeps the depot trends availability figures out of a gapped caption column', () => {
    expect(source('src/components/depot/trends/AvailabilityPanel.tsx')).not.toMatch(
      /flex flex-col gap-2" data-testid="trends-availability"/,
    );
  });
});
