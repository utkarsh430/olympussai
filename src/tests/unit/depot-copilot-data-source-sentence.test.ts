// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildCopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { answerCopilot } from '@/lib/depot/copilot/service/generate';
import { prepareCopilotRequest } from '@/lib/depot/copilot/service/prepare';
import { parseCopilotBody } from '@/lib/depot/copilot/service/schema';
import { dataSourceOf, staleSentence } from '@/lib/depot/copilot/service/stale';
import type { CopilotApiRequest, CopilotApiResponse } from '@/lib/depot/copilot/wire';

const rows = normalizeDepotRows(liveFixture).rows;
const view = (over: Partial<FleetSnapshotView>): FleetSnapshotView => ({
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
  ...over,
});

const SAMPLE = view({ source: 'fixture' });
const LAST_GOOD = view({ stale: true });
const T0 = Date.UTC(2026, 9, 6, 9);

const DECLINE: CopilotApiRequest = {
  task: 'ask',
  question: 'What is the weather like?',
  scope: { kind: 'network' },
};
const RANKING: CopilotApiRequest = {
  task: 'ask',
  question: 'Which five depots rank highest?',
  scope: { kind: 'network' },
};
const BRIEFING: CopilotApiRequest = { task: 'briefing', scope: { kind: 'network' } };

/** The route's own path from a body and a snapshot to the response, with the scripted writer. */
async function answer(raw: CopilotApiRequest, v: FleetSnapshotView): Promise<CopilotApiResponse> {
  const body = parseCopilotBody(JSON.stringify(raw));
  if (!body) throw new Error('fixture must parse');
  const prepared = prepareCopilotRequest(body, v);
  if (!prepared.ok) throw new Error('fixture must prepare');
  const runtime = buildCopilotRuntime({ setting: 'scripted', cli: null, now: () => T0 });
  return answerCopilot(runtime, prepared, {
    deadlineAt: T0 + 5_000,
    signal: new AbortController().signal,
    identity: 'test',
    staleSentence: staleSentence(v),
    dataSource: dataSourceOf(v),
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetAnalysisForTests();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe('the data-source sentence the server appends', () => {
  for (const [name, v] of [
    ['sample data', SAMPLE],
    ['last-good data', LAST_GOOD],
  ] as const) {
    const sentence = staleSentence(v) ?? '';

    it(`is not appended to a decline on ${name}, which names its source itself`, async () => {
      const response = await answer(DECLINE, v);
      expect(sentence).toMatch(/^These figures/);
      expect(response.facts).toHaveLength(0);
      expect(response.table).toBeUndefined();
      expect(response.paragraphs).not.toContain(sentence);
      expect(response.paragraphs.join(' ')).not.toMatch(/These figures/);
      expect(response.paragraphs.join(' ')).toMatch(/would be answered from/);
      expect(response.dataSource).toBe(dataSourceOf(v));
    });

    it(`is appended once to an answer with figures on ${name}`, async () => {
      const response = await answer(RANKING, v);
      expect(response.table?.rows.length).toBeGreaterThan(0);
      expect(response.paragraphs.filter((p) => p === sentence)).toHaveLength(1);
      expect(response.paragraphs.at(-1)).toBe(sentence);
    });

    it(`is appended once to a briefing on ${name}`, async () => {
      const response = await answer(BRIEFING, v);
      expect(response.facts.length).toBeGreaterThan(0);
      expect(response.paragraphs.filter((p) => p === sentence)).toHaveLength(1);
      expect(response.paragraphs.at(-1)).toBe(sentence);
    });
  }
});
