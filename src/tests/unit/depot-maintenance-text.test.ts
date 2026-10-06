import { describe, it, expect } from 'vitest';
import {
  NEXT_SERVICE_HEADER,
  groupRowLabel,
  preventiveCaption,
  distanceNotice,
  groupSummary,
  intervalText,
  kmToNextCell,
  kmToNextText,
  preventiveGuard,
  noAttentionText,
  offRoadEmptyText,
  offRoadHeadline,
  preventiveNote,
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
    expect(offRoadEmptyText()).toBe(
      'The live feed reports no bus under maintenance at this depot.',
    );
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
  it('words each group row as modelled, with the full count of the group', () => {
    expect(groupRowLabel('overdue', 18)).toBe('Modelled overdue · 18');
    expect(groupRowLabel('due_soon', 28)).toBe('Modelled due soon · 28');
    expect(groupRowLabel('not_due', 1204)).toBe('Modelled not due · 1,204');
  });

  it('words the table caption as modelled and not workshop records', () => {
    expect(preventiveCaption()).toContain('modelled');
    expect(preventiveCaption()).toContain('not workshop records');
  });

  it('puts only the number in the distance cell, with a minus sign past the service', () => {
    expect(kmToNextCell(-3400)).toBe('\u22123,400');
    expect(kmToNextCell(0)).toBe('0');
    expect(kmToNextCell(9000)).toBe('9,000');
  });

  it('says in one sentence that the statuses are generated, not workshop records', () => {
    expect(preventiveGuard()).toContain('generated from a model of service history');
    expect(preventiveGuard()).toContain('not workshop records');
  });

  it('words the distance to the next service for the cell title, overdue or not', () => {
    // Round 3 (M16): every title also says it is not a workshop record.
    expect(kmToNextText(-3400)).toBe('Modelled: overdue by 3,400 km; not a workshop record');
    expect(kmToNextText(0)).toBe('Modelled: due now; not a workshop record');
    expect(kmToNextText(800, 1500)).toBe(
      'Modelled: due soon, 800 km to next service; not a workshop record',
    );
    expect(kmToNextText(9000, 1500)).toBe(
      'Modelled: 9,000 km to next service; not a workshop record',
    );
  });

  it('summarises the groups against the depot fleet', () => {
    expect(groupSummary({ overdue: 6, due_soon: 9, not_due: 55 })).toBe(
      'Modelled, not workshop records: of 70 buses, 6 are modelled as overdue, ' +
        '9 as due soon and 55 as not due.',
    );
    expect(groupSummary({ overdue: 0, due_soon: 0, not_due: 0 })).toBe('The depot has no buses.');
  });

  it('says in one sentence when no bus needs a service', () => {
    expect(noAttentionText()).toBe(
      'No bus is overdue or due soon on the modelled service history.',
    );
  });

  it('states what is modelled and what due soon means', () => {
    const note = preventiveNote(1500);
    expect(note).toContain('modelled');
    expect(note).toContain('1,500 km');
    expect(note).toContain("share of buses modelled as overdue is set by the model's assumptions");
    expect(note).toContain('not derived from any record');
    expect(note).toContain('does not advance with the date');
    expect(note).toContain('follow its current route, so re-routing a bus can change its group');
    expect(note).toContain('not for planning services');
    expect(note.toLowerCase()).not.toContain('simulated');
  });

  it('prints a service interval per class', () => {
    expect(intervalText('ordinary', 10000)).toBe('Ordinary: every 10,000 km');
    expect(intervalText('ac', 8000)).toBe('AC: every 8,000 km');
  });
});

describe('column headers', () => {
  it('carry the unit and no tag (the section label carries the one MODELLED tag, S51)', () => {
    expect(NEXT_SERVICE_HEADER).toBe('To next service, km');
    expect(NEXT_SERVICE_HEADER).not.toMatch(/modelled/i);
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
