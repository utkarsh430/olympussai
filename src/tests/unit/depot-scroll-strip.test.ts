import { describe, expect, it } from 'vitest';
import { centredScrollLeft, pageScrollDelta, stripCue } from '@/lib/depot/scrollStrip';

describe('stripCue', () => {
  it('shows nothing when everything fits', () => {
    expect(stripCue({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toEqual({
      before: false,
      after: false,
    });
  });

  it('shows only the trailing cue at the start of an overflowing strip', () => {
    expect(stripCue({ scrollLeft: 0, clientWidth: 400, scrollWidth: 700 })).toEqual({
      before: false,
      after: true,
    });
  });

  it('shows both in the middle and only the leading cue at the end', () => {
    expect(stripCue({ scrollLeft: 150, clientWidth: 400, scrollWidth: 700 })).toEqual({
      before: true,
      after: true,
    });
    expect(stripCue({ scrollLeft: 299.5, clientWidth: 400, scrollWidth: 700 })).toEqual({
      before: true,
      after: false,
    });
  });
});

describe('centredScrollLeft', () => {
  const view = { clientWidth: 400, scrollWidth: 900 };

  it('centres a link in the middle', () => {
    expect(centredScrollLeft({ ...view, itemLeft: 400, itemWidth: 100 })).toBe(250);
  });

  it('never scrolls before the start or past the end', () => {
    expect(centredScrollLeft({ ...view, itemLeft: 0, itemWidth: 100 })).toBe(0);
    expect(centredScrollLeft({ ...view, itemLeft: 800, itemWidth: 100 })).toBe(500);
  });

  it('stays at 0 when the strip does not overflow', () => {
    expect(
      centredScrollLeft({ clientWidth: 400, scrollWidth: 380, itemLeft: 300, itemWidth: 80 }),
    ).toBe(0);
  });
});

describe('pageScrollDelta', () => {
  it('moves most of a screenful in the direction asked', () => {
    expect(pageScrollDelta(400, 'after')).toBe(280);
    expect(pageScrollDelta(400, 'before')).toBe(-280);
  });
});
