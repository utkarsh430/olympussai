import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyBriefCard, BRIEF_QUESTION } from '@/components/depot/service/DailyBriefCard';
import { appendAuditEvent } from '@/lib/audit/auditLog';
import { scriptedRoute } from '@/lib/depot/copilot/router/scriptedRouter';
import { DECISION_STORAGE_KEY, serialiseSlice } from '@/lib/depot/rebalance/decisionStore';
import { proposalDecisionEvent } from '@/lib/depot/rebalance/proposalDecisionEvents';
import type { Proposal } from '@/lib/depot/service/types';
import { bannedOnScreen } from './depot-guard-rendered';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const DATE = '2026-10-06';
const PROPOSALS = ['a', 'b', 'c'].map((id) => ({ id }) as Proposal);
let container: HTMLDivElement;
let root: Root;

const DONE = {
  headline: 'Service brief: 6 Oct 2026',
  paragraphs: ['This server has observed the feed since 05:10.', 'Recommendation only.'],
  provider: 'scripted',
  notice: 'none',
  generatedAt: '2026-10-06T09:30:00.000Z',
  cached: false,
  facts: [],
};

function respond(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ status, ok: status === 200, json: async () => body, headers: new Headers() }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function render(proposals: readonly Proposal[] | null = PROPOSALS): void {
  act(() => root.render(<DailyBriefCard operatingDate={DATE} proposals={proposals} currentFeedTime="x" />));
}

function writeButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    /^Write/.test(b.textContent ?? ''),
  );
}

describe('the daily brief card', () => {
  it('asks the copilot the brief question, which the scripted router reads as the brief', () => {
    expect(scriptedRoute(BRIEF_QUESTION, [])).toEqual({ kind: 'serviceBrief' });
  });

  it('idle: one heading, a write button, and nothing requested on mount', () => {
    const fn = respond(200, DONE);
    render();
    const card = container.querySelector('[data-testid="daily-brief"]');
    expect(card?.querySelectorAll('h2')).toHaveLength(1);
    expect(card?.querySelector('h2')?.textContent).toContain('Daily brief');
    expect(writeButton()).toBeDefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('loading: says it is writing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render();
    await act(async () => writeButton()?.click());
    expect(container.textContent).toContain('Writing…');
  });

  it('done: the brief text, its footer, and the network question sent', async () => {
    const fn = respond(200, DONE);
    render();
    await act(async () => writeButton()?.click());
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      task: 'ask',
      question: BRIEF_QUESTION,
      scope: { kind: 'network' },
    });
    expect(container.textContent).toContain('This server has observed the feed since 05:10.');
    expect(container.textContent).toContain('SCRIPTED');
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('failed: says the copilot is not available and offers a retry', async () => {
    respond(503, { error: 'unavailable' });
    render();
    await act(async () => writeButton()?.click());
    expect(container.textContent).toContain('The copilot is not available right now.');
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Try again')).toBe(true);
  });

  it('says no decision count until a decision on a proposal is kept in this browser', () => {
    respond(200, DONE);
    render();
    expect(container.querySelector('[data-testid="daily-brief-decisions"]')).toBeNull();
  });

  it('counts the decisions kept in this browser on the proposals shown', () => {
    const event = proposalDecisionEvent({
      subject: {
        kind: 'proposal',
        proposalId: 'a',
        routeName: 'KANPUR-LUCKNOW',
        proposalKind: 'add_buses',
        band: { fromHour: 7, toHour: 10 },
        change: 3,
        routes: [],
        depotName: null,
        count: null,
      },
      operatingDate: DATE,
      note: '',
      decision: 'approved',
    });
    const events = appendAuditEvent([], event);
    window.localStorage.setItem(DECISION_STORAGE_KEY, serialiseSlice({ events, dropped: 0 }));
    respond(200, DONE);
    render();
    const line = container.querySelector('[data-testid="daily-brief-decisions"]');
    expect(line?.textContent).toBe(
      'Decisions kept in this browser for 6 Oct 2026: 1 accepted, 0 declined, 2 still open. Recorded only; nothing dispatched.',
    );
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('marks itself to be kept when the page is printed', () => {
    respond(200, DONE);
    render(null);
    expect(container.querySelector('[data-testid="daily-brief"]')?.hasAttribute('data-print-brief')).toBe(true);
  });
});
