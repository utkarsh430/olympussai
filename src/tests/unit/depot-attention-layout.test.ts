import { describe, expect, it } from 'vitest';
import {
  attentionColumns,
  attentionLayoutClasses,
  attentionRows,
  attentionTier,
  type AttentionTier,
} from '@/lib/depot/cockpit/attentionLayout';

const TIERS: readonly AttentionTier[] = ['phone', 'tablet', 'desktop', 'wide'];

describe('the attention strip layout', () => {
  it('picks the tier from the viewport width', () => {
    expect(attentionTier(360)).toBe('phone');
    expect(attentionTier(640)).toBe('tablet');
    expect(attentionTier(1023)).toBe('tablet');
    expect(attentionTier(1024)).toBe('desktop');
    expect(attentionTier(1279)).toBe('desktop');
    expect(attentionTier(1280)).toBe('wide');
  });

  it.each<[number, AttentionTier, readonly number[]]>([
    [5, 'phone', [1, 1, 1, 1, 1]],
    [5, 'tablet', [3, 2]],
    [5, 'desktop', [3, 2]],
    [5, 'wide', [5]],
    [6, 'phone', [1, 1, 1, 1, 1, 1]],
    [6, 'tablet', [3, 3]],
    [6, 'desktop', [3, 3]],
    [6, 'wide', [3, 3]],
    [4, 'desktop', [2, 2]],
    [3, 'desktop', [3]],
    [2, 'wide', [2]],
  ])('%i lines on a %s sit %j', (count, tier, rows) => {
    expect(attentionRows(count, attentionColumns(count, tier))).toEqual(rows);
  });

  it('is a single-column list on a phone', () => {
    for (let count = 1; count <= 6; count += 1) expect(attentionColumns(count, 'phone')).toBe(1);
  });

  it('never leaves one line alone on the last row of a strip of several columns', () => {
    for (let count = 2; count <= 6; count += 1) {
      for (const tier of TIERS) {
        const columns = attentionColumns(count, tier);
        if (columns > 1) expect(attentionRows(count, columns).at(-1), `${count} ${tier}`).not.toBe(1);
      }
    }
  });

  it('writes the classes for the columns it decides', () => {
    const five = attentionLayoutClasses(5);
    expect(five.list.split(' ')).toEqual(['sm:grid-cols-3', 'xl:grid-cols-5']);
    expect(five.filler).toContain('sm:block');
    expect(five.filler).toContain('xl:hidden');
    const six = attentionLayoutClasses(6);
    expect(six.list.split(' ')).toEqual(['sm:grid-cols-3']);
    expect(six.filler).toBeNull();
    expect(attentionLayoutClasses(4).list).toContain('lg:grid-cols-2');
    expect(attentionLayoutClasses(1).list).toBe('');
  });

  it('stacks each cell (count, words, destination) wherever three or more sit across', () => {
    for (const count of [3, 5, 6]) {
      const classes = attentionLayoutClasses(count);
      expect(classes.link).toContain('sm:flex-col');
      expect(classes.words).not.toContain('truncate');
    }
    expect(attentionLayoutClasses(4).link).toBe('');
    expect(attentionLayoutClasses(4).words).toBe('sm:truncate');
  });
});
