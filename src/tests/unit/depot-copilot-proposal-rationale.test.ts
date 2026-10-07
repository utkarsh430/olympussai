import { describe, expect, it } from 'vitest';
import { buildProposalRationale } from '@/lib/depot/copilot/facts/proposal';
import { renderDraft } from '@/lib/depot/copilot/render';
import { parseCopilotBody } from '@/lib/depot/copilot/service/schema';
import type { Proposal } from '@/lib/depot/service/types';
import { FIXTURE_PROPOSALS, routeHourlyFixture } from './depot-service-fixtures';

const PLACEHOLDER = /\{\{fact:[a-z0-9][a-z0-9_.-]{0,63}\}\}/g;
const body = routeHourlyFixture();
const [ADD, HOLD, RUN] = FIXTURE_PROPOSALS as [Proposal, Proposal, Proposal];

const VARIANTS: readonly [string, Proposal][] = [
  ['add from an observed yard', ADD],
  ['hold, modelled source', HOLD],
  ['measured finding', RUN],
  ['add with no source', { ...ADD, source: null }],
  ['add from the modelled plan', { ...ADD, source: { ...ADD.source!, standingInYard: null, basis: 'modelled', idleInDayPlan: 4 } }],
  ['add, modelled, idle unknown', { ...ADD, source: { ...ADD.source!, standingInYard: null, basis: 'modelled' } }],
  ['add, may be covered', { ...ADD, maybeCoveredByUnrouted: true }],
  ['add, nothing scheduled', { ...ADD, scheduled: null }],
  ['trips not run', { ...RUN, kind: 'trips_not_run' }],
  ['service span gap', { ...RUN, kind: 'service_span_gap' }],
  ['headway gap', { ...RUN, kind: 'headway_gap' }],
  ['add one bus', { ...ADD, change: 1 }],
];

describe('buildProposalRationale', () => {
  it.each(VARIANTS)('%s renders through the draft rules with no figure in the prose', (_l, p) => {
    const request = buildProposalRationale(p, body);
    expect(request.task).toBe('rationale');
    expect(renderDraft(request.scriptedDraft, request.facts)).toMatchObject({ ok: true });
    const prose = [request.scriptedDraft.headline, ...request.scriptedDraft.paragraphs].join(' ');
    expect(prose.replace(PLACEHOLDER, ' ')).not.toMatch(/\d/);
    expect(request.scriptedDraft.paragraphs.length).toBeLessThanOrEqual(5);
    for (const f of request.facts) {
      expect(f.text.length).toBeLessThanOrEqual(120);
      expect(f.label.length).toBeLessThanOrEqual(40);
    }
  });

  it('says why: the band, its figures, the gap, each with its provenance', () => {
    const by = (id: string) => buildProposalRationale(ADD, body).facts.find((f) => f.id === id);
    expect(by('p.band')).toMatchObject({ text: '07:00–11:00', provenance: 'derived' });
    expect(by('p.change')).toMatchObject({ text: 'add 3 buses', provenance: 'modelled' });
    expect(by('p.deployed')).toMatchObject({ text: '9 buses', provenance: 'derived' });
    expect(by('p.scheduled')).toMatchObject({ text: '6 buses', provenance: 'derived' });
    expect(by('p.needed')).toMatchObject({ text: '12 buses', provenance: 'modelled' });
    expect(by('p.gap')).toMatchObject({ text: '3 buses', provenance: 'modelled' });
    expect(by('p.source')).toMatchObject({ text: 'Alambagh', kind: 'name' });
    expect(by('p.standing')).toMatchObject({ text: '6 buses', provenance: 'derived' });
  });

  it('gives the impact as modelled ranges', () => {
    const by = (id: string) => buildProposalRationale(ADD, body).facts.find((f) => f.id === id);
    expect(by('p.passengers')).toMatchObject({ text: '180 to 320 passengers', provenance: 'modelled' });
    expect(by('p.revenue')).toMatchObject({ text: '₹9,400 to ₹16,800', provenance: 'modelled' });
    expect(by('p.cost')).toMatchObject({ text: '₹15,100 to ₹18,300', provenance: 'modelled' });
  });

  it('says what the figures rest on and what would change them', () => {
    const paragraphs = buildProposalRationale(ADD, body).scriptedDraft.paragraphs.join(' ');
    expect(paragraphs).toContain('modelled passenger demand');
    expect(paragraphs).toContain('Measured passenger counts would replace the modelled demand');
    expect(paragraphs).toContain('nothing is dispatched or assigned');
  });

  it('says why no bus moves for a measured finding, and that it has no modelled impact', () => {
    const paragraphs = buildProposalRationale(RUN, body).scriptedDraft.paragraphs.join(' ');
    expect(paragraphs).toContain('No bus moves for this finding.');
    expect(paragraphs).toContain('No modelled impact');
  });
});

describe('the rationale request for a proposal', () => {
  const parse = (value: unknown) => parseCopilotBody(JSON.stringify(value));

  it('accepts a proposal id with its route', () => {
    expect(parse({ task: 'rationale', proposalId: 'p-0a1b2c3d', routeName: 'R_1' })).not.toBeNull();
  });

  it('still accepts a transfer id alone', () => {
    expect(parse({ task: 'rationale', transferId: '101>102' })).not.toBeNull();
  });

  it.each([
    { task: 'rationale', proposalId: 'p-0a1b2c3d' },
    { task: 'rationale', proposalId: 'p-xyz', routeName: 'R_1' },
    { task: 'rationale', proposalId: 'p-0a1b2c3d', routeName: 'R 1' },
    { task: 'rationale', proposalId: 'p-0a1b2c3d', routeName: 'R_1', transferId: '101>102' },
    { task: 'rationale', proposalId: 'p-0a1b2c3d', routeName: 'R_1', extra: 1 },
  ])('refuses %j', (value) => {
    expect(parse(value)).toBeNull();
  });
});
