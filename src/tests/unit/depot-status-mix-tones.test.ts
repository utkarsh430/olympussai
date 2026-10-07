import { describe, expect, it } from 'vitest';
import { stateSegments } from '@/components/depot/network/StatusMixBar';
import { BUS_STATE_SQUARE } from '@/components/depot/shell/BusStateMark';

describe('the status mix bar', () => {
  it('colours each bus state as its square does everywhere else', () => {
    const tones = Object.fromEntries(
      stateSegments({ inService: 1, onRoad: 2, standing: 3, dark: 4, offRoad: 5 }).map((s) => [
        s.key,
        s.tone,
      ]),
    );
    expect(tones).toEqual({
      inService: BUS_STATE_SQUARE.in_service,
      onRoad: BUS_STATE_SQUARE.on_road,
      standing: BUS_STATE_SQUARE.standing,
      dark: BUS_STATE_SQUARE.dark,
      offRoad: BUS_STATE_SQUARE.off_road,
    });
    expect(tones.dark).toBe('bg-slate-400');
    expect(tones.offRoad).toBe('bg-alert-crimson');
  });
});
