// @vitest-environment jsdom
//
// THE ORDER OF TWO LINES, AND WHY IT GETS ITS OWN TEST FILE.
//
// When a driver taps an answer, CommandConsole writes it to the durable
// IndexedDB outbox and then attempts the network call. Written the other way
// round the console behaves identically in every normal condition: online, the
// fetch succeeds, the entry is queued and immediately removed, every existing
// test passes, and the screen says "Answer sent."
//
// It only diverges in the one case the outbox exists for. With no signal — a
// bus in a dead patch, which on this network is routine rather than
// exceptional — the fetch rejects. Enqueue-first has already put the answer on
// disk, so it flushes when signal returns. Fetch-first never reaches the
// enqueue at all, and the driver's answer is gone: they saw a screen that
// accepted their tap, the control room never hears, and nothing anywhere
// records that an answer was given.
//
// A behavioural test ("the answer is queued when offline") does not pin this
// down, because a fetch-first implementation that catches the rejection and
// enqueues in the catch block also passes it — and that variant still loses
// the answer whenever the tab is killed mid-request, which is what happens
// when a phone locks. The only assertion that holds the guarantee is the
// SEQUENCE, so that is what this file asserts.
//
// The other properties here are the ones a redesign is most likely to
// undo quietly: that all three answers reach the same code path, and that the
// two refusals are not rendered as lesser options than agreeing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Every durable-write and network call, in the order they actually happened. */
const calls: string[] = [];

vi.mock('@/lib/pilotDriver/ackQueue', () => ({
  enqueueAck: vi.fn(async (entry: { commandId: string; outcome: string }) => {
    calls.push(`enqueue:${entry.outcome}`);
  }),
  removeQueuedAck: vi.fn(async () => {
    calls.push('remove');
  }),
  flushQueuedAcks: vi.fn(async () => ({ flushed: [], remaining: [] })),
  listQueuedAcks: vi.fn(async () => []),
}));

const COMMAND = {
  id: 'cmd-durability-1',
  vehicleId: 'UP78FN8125',
  actionType: 'speed_guidance',
  status: 'delivered',
  parameters: { reason: 'Merging traffic ahead near Faridpur - reduce speed.' },
  targetStopId: null,
  // Far enough out that the countdown never lapses mid-test.
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
};

/**
 * `fetch` for the three endpoints the console touches, recording the ack POST
 * into the same sequence the outbox writes into.
 */
function installFetch({ ackFails = false }: { ackFails?: boolean } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/ops/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: true, vehicleId: 'UP78FN8125' }),
        };
      }
      if (url.includes('/ack')) {
        calls.push(`fetch:${JSON.parse(String(init?.body ?? '{}')).outcome}`);
        if (ackFails) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (url.includes('/api/ops/pilot-driver/commands')) {
        return { ok: true, status: 200, json: async () => ({ command: COMMAND }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

async function renderConsoleWithCommand() {
  const { CommandConsole } = await import('@/components/ops/pilot-driver/CommandConsole');
  render(<CommandConsole />);
  // The instruction has to actually be on screen before a tap means anything.
  await screen.findByText('Adjust your speed', {}, { timeout: 3_000 });
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('indexedDB', {} as unknown as IDBFactory);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the driver answer is durable before it is ever sent', () => {
  it('writes the answer to the outbox BEFORE attempting the network call', async () => {
    installFetch();
    await renderConsoleWithCommand();

    await userEvent.click(screen.getByTestId('driver-answer-accept'));

    await waitFor(() => expect(calls).toContain('fetch:accept'));

    // The whole point. Not "both happened" - the enqueue happened FIRST.
    expect(calls.indexOf('enqueue:accept')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('enqueue:accept')).toBeLessThan(calls.indexOf('fetch:accept'));
  });

  it('keeps the answer queued and says so when the network call fails', async () => {
    installFetch({ ackFails: true });
    await renderConsoleWithCommand();

    await userEvent.click(screen.getByTestId('driver-answer-unsafe'));

    // Enqueued first, the send threw, and nothing removed it from the outbox -
    // so it survives to be flushed on the next `online` event.
    await screen.findByTestId('driver-answer-queued');
    expect(calls).toEqual(['enqueue:unsafe', 'fetch:unsafe']);
    expect(calls).not.toContain('remove');
  });

  it('clears the answer from the outbox only once the send has actually succeeded', async () => {
    installFetch();
    await renderConsoleWithCommand();

    await userEvent.click(screen.getByTestId('driver-answer-unable'));

    await screen.findByTestId('driver-answer-sent');
    expect(calls).toEqual(['enqueue:unable', 'fetch:unable', 'remove']);
  });

  it('does not tell the driver the answer was sent when it was only queued', async () => {
    // "Answer sent." on a phone with no signal is the console claiming the
    // control room knows something it does not.
    installFetch({ ackFails: true });
    await renderConsoleWithCommand();

    await userEvent.click(screen.getByTestId('driver-answer-accept'));

    await screen.findByTestId('driver-answer-queued');
    expect(screen.queryByTestId('driver-answer-sent')).toBeNull();
  });
});

describe('all three answers are first-class', () => {
  it('sends each outcome through the identical path, with no extra field on a refusal', async () => {
    for (const outcome of ['accept', 'unable', 'unsafe'] as const) {
      calls.length = 0;
      installFetch();

      const { CommandConsole } = await import('@/components/ops/pilot-driver/CommandConsole');
      const view = render(<CommandConsole />);
      await screen.findAllByText('Adjust your speed', {}, { timeout: 3_000 });

      await userEvent.click(view.getByTestId(`driver-answer-${outcome}`));
      await waitFor(() => expect(calls).toContain(`fetch:${outcome}`));

      // The request body carries the outcome and a reason, and nothing else.
      // "No penalty is applied either way" is true by construction only while
      // there is no scoring/penalty field for a refusal to acquire.
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const ackCall = fetchMock.mock.calls.find((c: unknown[]) => String(c[0]).includes('/ack'));
      const body = JSON.parse(String((ackCall?.[1] as RequestInit)?.body));
      expect(Object.keys(body).sort()).toEqual(['outcome', 'reason']);
      expect(body.outcome).toBe(outcome);

      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('renders the two refusals at the same size and weight as agreeing', async () => {
    // The previous console gave the three a green/amber/crimson ramp, so "this
    // is not safe" looked like an alarm the driver had caused. Peers means the
    // same box: if a future change makes a refusal smaller, quieter or
    // narrower than the accept button, this fails.
    installFetch();
    await renderConsoleWithCommand();

    const accept = screen.getByTestId('driver-answer-accept');
    for (const outcome of ['unable', 'unsafe'] as const) {
      expect(screen.getByTestId(`driver-answer-${outcome}`).className).toBe(accept.className);
    }
  });

  it('gives every answer a visible label in both languages', async () => {
    installFetch();
    await renderConsoleWithCommand();

    for (const [outcome, en, hi] of [
      ['accept', 'Yes, doing it', 'हाँ, ठीक है'],
      ['unable', 'Cannot do it', 'नहीं कर सकते'],
      ['unsafe', 'Not safe', 'सुरक्षित नहीं है'],
    ] as const) {
      const button = screen.getByTestId(`driver-answer-${outcome}`);
      expect(button.textContent).toContain(en);
      expect(button.textContent).toContain(hi);
      // The Hindi is marked as Hindi, so the font stack and a screen reader
      // both treat it correctly rather than reading Devanagari as English.
      expect(button.querySelector('[lang="hi"]')?.textContent).toBe(hi);
    }
  });
});

describe('the command stops being answerable when it lapses', () => {
  it('removes the answer buttons the moment the countdown reaches zero', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/api/ops/auth/session')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ authenticated: true, vehicleId: 'UP78FN8125' }),
            };
          }
          if (url.includes('/api/ops/pilot-driver/commands')) {
            return {
              ok: true,
              status: 200,
              // Two seconds of life, so the local countdown lapses long before
              // the 4s poll could report it gone. This is the client-side
              // expiry, isolated from the server's.
              json: async () => ({
                command: { ...COMMAND, expiresAt: new Date(Date.now() + 2_000).toISOString() },
              }),
            };
          }
          return { ok: true, status: 200, json: async () => ({}) };
        }),
      );

      const { CommandConsole } = await import('@/components/ops/pilot-driver/CommandConsole');
      render(<CommandConsole />);
      await screen.findByTestId('driver-answer-accept', {}, { timeout: 3_000 });

      // Inside act(): the countdown tick and the poll both set state, and an
      // unwrapped advance drowns the run in act() warnings that would hide a
      // real one.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => expect(screen.queryByTestId('driver-answer-accept')).toBeNull());
      expect(screen.getByTestId('driver-no-instruction')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the answer stays confirmed after the instruction clears', () => {
  it('keeps a receipt of what the driver answered once the command is gone', async () => {
    // Found by driving the real console, not by reading it: the driver taps,
    // looks back at the road, and ~4s later the poll reports the command
    // inactive. Without this the confirmation vanishes with it, and a driver
    // glancing down sees only "No instruction right now" - no evidence their
    // answer was registered.
    let active = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/ops/auth/session')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ authenticated: true, vehicleId: 'UP78FN8125' }),
          };
        }
        if (url.includes('/ack')) {
          active = false; // the command stops being the vehicle's active one
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        if (url.includes('/api/ops/pilot-driver/commands')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ command: active ? COMMAND : null }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );

    const { CommandConsole } = await import('@/components/ops/pilot-driver/CommandConsole');
    render(<CommandConsole />);
    await screen.findByTestId('driver-answer-unsafe', {}, { timeout: 3_000 });

    await userEvent.click(screen.getByTestId('driver-answer-unsafe'));

    // The empty state is TRUE and must still arrive - the console genuinely
    // has no instruction, and the safety suite asserts exactly this.
    await screen.findByTestId('driver-no-instruction', {}, { timeout: 8_000 });

    // ...and beside it, what they answered, still on screen.
    const receipt = await screen.findByTestId('driver-last-answer');
    expect(receipt.textContent).toContain('Not safe');
    expect(receipt.textContent).toContain('सुरक्षित नहीं है');
    expect(receipt.textContent).toContain('Answer sent.');
  });
});
