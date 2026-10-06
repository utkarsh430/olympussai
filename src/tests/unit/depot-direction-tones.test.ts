import { describe, expect, it } from 'vitest';
import { differenceClass } from '@/components/depot/economics/EconomicsCells';
import { trendFigureClass } from '@/components/depot/league/LeagueCells';

describe('better and worse where the page states the direction', () => {
  it('colours earnings and fuel cost changes by direction, and leaves level and load muted', () => {
    expect(differenceClass({ key: 'earningsPerKm', direction: 'better' })).toBe('text-alert-green');
    expect(differenceClass({ key: 'costPerKm', direction: 'worse' })).toBe('text-alert-crimson');
    expect(differenceClass({ key: 'costPerKm', direction: 'level' })).toBe('text-depot-muted');
    expect(differenceClass({ key: 'loadFactor', direction: 'better' })).toBe('text-depot-muted');
  });

  it('colours the league trend UP green and DOWN crimson, STEADY muted', () => {
    expect(trendFigureClass('UP')).toBe('text-alert-green');
    expect(trendFigureClass('DOWN')).toBe('text-alert-crimson');
    expect(trendFigureClass('STEADY')).toBe('text-depot-muted');
    expect(trendFigureClass('—')).toBe('text-depot-muted');
  });
});
