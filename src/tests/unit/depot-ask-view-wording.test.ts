import { describe, expect, it } from 'vitest';
import { limitSentence, sessionNote } from '@/lib/depot/copilot/ui/copilotView';

describe('ask wording', () => {
  it('always shows the limit', () => {
    expect(limitSentence(212, 300)).toBe('212 of 300 characters left');
    expect(limitSentence(-12, 300)).toBe('12 over the 300 character limit');
  });
  it('says nothing is stored', () => {
    expect(sessionNote(5)).toContain('Nothing is stored');
  });
});
