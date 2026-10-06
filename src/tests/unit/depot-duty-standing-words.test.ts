import { describe, expect, it } from 'vitest';
import {
  CLASS_WORD,
  DUTIES_DESCRIPTION,
  STANDING_WORD,
  busClassWord,
  dutyProvenance,
  matchedCaption,
  recencySentence,
  spareCaption,
} from '@/lib/depot/duties/dutyStanding';
import type { BoardDuty } from '@/lib/depot/duties/api';

const duty = (over: Partial<BoardDuty> = {}): BoardDuty => ({
  id: 'D-0',
  routeName: 'ORD_1',
  startMin: 420,
  endMin: 900,
  serviceClass: 'ordinary',
  registrationNumber: 'UP32A0001',
  busStanding: 'in_yard',
  busClass: 'ordinary',
  state: 'assigned',
  blockers: null,
  ...over,
});

describe('how a matched bus stands, in words', () => {
  it('words each value of the closed set once, never claiming a place it cannot know', () => {
    expect(STANDING_WORD).toEqual({
      on_road: 'On the road',
      in_yard: 'Standing in the yard',
      standing: 'Standing, no yard established',
    });
  });

  it('writes every service class in title case', () => {
    expect(Object.values(CLASS_WORD)).toEqual(['Ordinary', 'Express', 'AC', 'Premium']);
  });

  it('names the bus class only where it differs from the duty class', () => {
    expect(busClassWord(duty())).toBeNull();
    expect(busClassWord(duty({ busClass: 'express' }))).toBe('Express');
    expect(busClassWord(duty({ registrationNumber: null, busClass: null }))).toBeNull();
  });
});

describe('band captions', () => {
  it('splits the matched duties by where their bus stands now', () => {
    const duties = [
      duty({ busStanding: 'on_road' }),
      duty({ busStanding: 'on_road' }),
      duty({ busStanding: 'in_yard' }),
      duty({ registrationNumber: null, busStanding: null, state: 'no_bus' }),
    ];
    expect(matchedCaption(duties)).toBe('2 on the road, 1 from the yard');
    expect(matchedCaption([duty({ busStanding: 'standing' })])).toBe('1 standing, no yard');
    expect(matchedCaption([])).toBe('no bus matched');
  });

  it('says where the spare buses stand from the response, never all in the yard', () => {
    const split = { inYard: 5, standing: 0, onRoad: 10 };
    expect(spareCaption({ assigned: 3, spare: 15, spareByStanding: split })).toBe(
      '5 in the yard, 10 on the road',
    );
    expect(spareCaption({ assigned: 3, spare: 2 })).toBe('eligible, no duty');
    expect(spareCaption({ assigned: 0, spare: 0 })).toBe('none eligible');
    expect(spareCaption({ assigned: 4, spare: 0 })).toBe('every eligible bus matched');
  });
});

describe('page words', () => {
  it('says nothing is assigned or dispatched in the header sentence', () => {
    expect(DUTIES_DESCRIPTION).toContain('nothing is assigned or dispatched');
    expect(DUTIES_DESCRIPTION.length).toBeLessThanOrEqual(84);
  });

  it('declares the page MIXED: bus states derived, duties and the matching modelled', () => {
    expect(dutyProvenance('Day.')).toEqual({
      default: 'mixed',
      derived: 'Bus states',
      modelled: 'duties and the matching',
      modelledDay: 'Day.',
    });
    expect(dutyProvenance(undefined)).not.toHaveProperty('modelledDay');
  });

  it('says recency could not be judged only when the feed has no clock', () => {
    expect(recencySentence(true)).toBe(
      'The feed has no clock, so no bus could be judged by how recently it was heard.',
    );
    expect(recencySentence(false)).toBeNull();
    expect(recencySentence(undefined)).toBeNull();
  });
});
