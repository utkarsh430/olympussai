import { describe, it, expect } from 'vitest';
import {
  distanceNotice,
  groupSummary,
  intervalText,
  kmToNextText,
  noAttentionText,
  offRoadEmptyText,
  offRoadHeadline,
  preventiveNote,
  serviceGroupLabel,
  silenceText,
  statusWordLabel,
  workshopSentence,
} from '@/lib/depot/maintenance/text';
import { workshopLoad } from '@/lib/depot/maintenance/workshop';

describe('off-road sentences', () => {
  it('states the live count with the right number', () => {
    expect(offRoadHeadline(1)).toBe('1 bus is off the road now.');
    expect(offRoadHeadline(3)).toBe('3 buses are off the road now.');
  });

  it('says in one sentence why the list is empty', () => {
    expect(offRoadEmptyText()).toBe('The live feed reports no bus under maintenance at this depot.');
  });

  it('uses the feed vocabulary for the status word', () => {
    expect(statusWordLabel('under_maintenance')).toBe('Under maintenance');
    expect(statusWordLabel('no_signal')).toBe('No signal');
    expect(statusWordLabel('unknown')).toBe('Unknown');
  });

  it('describes silence in words, and says so when it is not known', () => {
    expect(silenceText(30)).toBe('30 min ago');
    expect(silenceText(300)).toBe('5 h ago');
    expect(silenceText(null)).toBe('unknown');
  });
});

describe('distance notice', () => {
  it('says the feed distance is unused, why, and how many buses carry it', () => {
    expect(distanceNotice({ n: 31, of: 70 })).toBe(
      "The feed's distance field is not used on this page because its unit is unconfirmed, " +
        'and only 31 of 70 buses at this depot carry it.',
    );
  });

  it('never prints a distance unit for the feed field', () => {
    expect(distanceNotice({ n: 0, of: 0 })).not.toMatch(/\bkm\b|kilomet|metres/i);
  });
});

describe('preventive sentences', () => {
  it('names the groups in words', () => {
    expect(serviceGroupLabel('overdue')).toBe('Overdue');
    expect(serviceGroupLabel('due_soon')).toBe('Due soon');
    expect(serviceGroupLabel('not_due')).toBe('Not due');
  });

  it('words the distance to the next service, overdue or not', () => {
    expect(kmToNextText(-800)).toBe('Overdue by 800 km');
    expect(kmToNextText(0)).toBe('Due now');
    expect(kmToNextText(1200)).toBe('1,200 km to next service');
  });

  it('summarises the groups against the depot fleet', () => {
    expect(groupSummary({ overdue: 6, due_soon: 9, not_due: 55 })).toBe(
      'Of 70 buses: 6 overdue, 9 due soon, 55 not due.',
    );
    expect(groupSummary({ overdue: 0, due_soon: 0, not_due: 0 })).toBe('The depot has no buses.');
  });

  it('says in one sentence when no bus needs a service', () => {
    expect(noAttentionText()).toBe('No bus is overdue or due soon on the modelled service history.');
  });

  it('states what is modelled and what due soon means', () => {
    const note = preventiveNote(1500);
    expect(note).toContain('modelled');
    expect(note).toContain('1,500 km');
    expect(note.toLowerCase()).not.toContain('simulated');
  });

  it('prints a service interval per class', () => {
    expect(intervalText('ordinary', 10000)).toBe('Ordinary: every 10,000 km');
    expect(intervalText('ac', 8000)).toBe('AC: every 8,000 km');
  });
});

describe('workshopSentence', () => {
  it('says all bays are free when nothing is off the road', () => {
    expect(workshopSentence(workshopLoad(0, 4))).toBe(
      'No bus is off the road, so all 4 modelled bays are free.',
    );
  });

  it('says how many bays are free when the buses fit', () => {
    expect(workshopSentence(workshopLoad(3, 4))).toBe(
      '3 buses off the road fit in 4 modelled bays; 1 bay is free.',
    );
  });

  it('states the queue in words when the buses exceed the bays', () => {
    expect(workshopSentence(workshopLoad(7, 4))).toBe(
      '7 buses off the road against 4 modelled bays: 3 would wait for a bay.',
    );
    expect(workshopSentence(workshopLoad(5, 4))).toContain('1 would wait for a bay');
  });

  it('copes with a depot that has no modelled bay', () => {
    expect(workshopSentence(workshopLoad(2, 0))).toBe(
      'The depot has no modelled workshop bay, so 2 buses off the road would wait.',
    );
  });
});
