import { describe, expect, it } from 'vitest';
import { YARD_RULE_SENTENCE } from '@/lib/depot/infer/yardRuleText';

describe('YARD_RULE_SENTENCE', () => {
  // Stated as a literal so a changed inference constant shows up here as a
  // changed sentence a person will read, not silently.
  it('states the rule the inference applies, in the units a person reads', () => {
    expect(YARD_RULE_SENTENCE).toBe(
      'A yard is claimed only when at least 6 parked buses stand together, each within 150 m of ' +
        "the next, in one place that holds at least 25% of the depot's parked buses, 1.5 times " +
        'as many as any other place, and is no more than 1.5 km across.',
    );
  });
});
