import { describe, expect, it } from 'vitest';
import { FEED_REGISTRY } from '@/lib/depot/sources/registry';
import { feedAnchor, feedIdFromHash } from '@/lib/depot/sources/sourcesModel';

describe('feed anchors', () => {
  const ids = FEED_REGISTRY.map((f) => f.id);
  it('are unique and prefixed', () => {
    const anchors = ids.map(feedAnchor);
    expect(new Set(anchors).size).toBe(ids.length);
    expect(anchors[0]).toBe('feed-gps-device');
  });
  it('map a hash back to its feed', () => {
    expect(feedIdFromHash('#feed-fuel', ids)).toBe('fuel');
    expect(feedIdFromHash('#nope', ids)).toBeNull();
    expect(feedIdFromHash('', ids)).toBeNull();
  });
});
