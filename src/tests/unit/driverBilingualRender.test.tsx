// @vitest-environment jsdom
//
// THE HINDI HAS TO REACH THE SCREEN, NOT JUST THE TABLE.
//
// driverCopy.test.ts walks `allDriverPhrases()` and proves every entry has a
// real Devanagari counterpart. It passed for the whole life of the defect it
// was written to prevent, because it tests the TABLE and the loss happened at
// the RENDER SITE:
//
//     setAckError(CONSOLE_COPY.answerNotSaved.en);
//
// `.en`, and the Hindi — which exists, three lines below it in driverCopy.ts —
// was discarded on the way to the screen. That string fires at exactly one
// moment: when a driver's acknowledgement failed to save on their own phone.
// It is the sentence that tells them the tap did not take and they must press
// again. A Hindi-speaking driver got an English-only alert at the one instant
// they most needed to understand what had happened. Four other phrases were
// being dropped the same way on the same screen.
//
// ─── WHAT THIS FILE ASSERTS, AND WHY IT IS SHAPED THIS WAY ────────────────
//
// Not "answerNotSaved renders in Hindi" — that is a regression test for one
// string, and the next render site to drop a language would not be this one.
// The rule instead is a property of the SCREEN, checked against the whole
// vocabulary:
//
//     for every phrase in the table, if its English is on screen,
//     its Hindi must be on screen too.
//
// So it holds for phrases that do not exist yet, at render sites nobody has
// written yet, in whichever state puts them there. Each state below exists to
// walk the console into another part of its vocabulary; the assertion itself
// is the same one every time and names whatever it caught.
//
// The states are driven through the console's real inputs — the session
// endpoint, the command poll, the durable outbox — rather than by rendering
// sub-components directly, because "which phrase is on screen" is precisely
// what the component decides.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { allDriverPhrases } from '@/lib/pilotDriver/driverCopy';

const enqueueAck = vi.fn(async () => {});

vi.mock('@/lib/pilotDriver/ackQueue', () => ({
  enqueueAck: (...args: unknown[]) => enqueueAck(...(args as [])),
  removeQueuedAck: vi.fn(async () => {}),
  flushQueuedAcks: vi.fn(async () => ({ flushed: [], remaining: [] })),
  listQueuedAcks: vi.fn(async () => []),
}));

const COMMAND = {
  id: 'cmd-bilingual-1',
  vehicleId: 'UP78FN8125',
  actionType: 'speed_guidance',
  status: 'delivered',
  parameters: { reason: 'Merging traffic ahead near Faridpur - reduce speed.' },
  targetStopId: null,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
};

/** Mutable so a test can make the instruction disappear mid-run. */
const live: { command: typeof COMMAND | null } = { command: null };

interface FetchOptions {
  /** null = the driver has no bus; 'reject' = the session read itself fails. */
  vehicleId?: string | null | 'reject';
  command?: typeof COMMAND | null;
  /** The command poll fails, which is what puts `unreachable` on screen. */
  pollFails?: boolean;
}

function installFetch({
  vehicleId = 'UP78FN8125',
  command = null,
  pollFails = false,
}: FetchOptions = {}) {
  live.command = command;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/api/ops/auth/session')) {
        if (vehicleId === 'reject') throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => ({ authenticated: true, vehicleId }) };
      }
      if (url.includes('/api/ops/pilot-driver/commands')) {
        if (pollFails) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => ({ command: live.command }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

async function renderConsole() {
  const { CommandConsole } = await import('@/components/ops/pilot-driver/CommandConsole');
  await act(async () => {
    render(<CommandConsole />);
  });
}

/**
 * The rule, applied to whatever is currently on screen.
 *
 * Reports every phrase it caught rather than the first, so a change that drops
 * several at once is diagnosed in a single run.
 */
function expectNoDiscardedTranslation(): void {
  const text = document.body.textContent ?? '';
  const discarded = allDriverPhrases()
    .filter(({ phrase }) => text.includes(phrase.en) && !text.includes(phrase.hi))
    .map(({ key, phrase }) => `${key} — showed "${phrase.en}" without "${phrase.hi}"`);

  expect(
    discarded,
    'These phrases reached the screen in English with their Hindi discarded. The ' +
      'translation exists in driverCopy.ts; the render site dropped it. Render ' +
      'driver copy through OpsBilingual (or carry the whole DriverPhrase through ' +
      'state) rather than reaching for `.en`.',
  ).toEqual([]);
}

/** Guards the guard: a state that shows no known English at all proves nothing. */
function expectSomeCopyOnScreen(): void {
  const text = document.body.textContent ?? '';
  const shown = allDriverPhrases().filter(({ phrase }) => text.includes(phrase.en));
  expect(shown.length, 'this state rendered no known driver copy at all').toBeGreaterThan(0);
}

beforeEach(() => {
  enqueueAck.mockReset();
  enqueueAck.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('every driver phrase that reaches the screen reaches it in both languages', () => {
  it('while the console is still finding the bus', async () => {
    // The session read never settles, so the console stays in `loading`.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const { CommandConsole } = await import('@/components/ops/pilot-driver/CommandConsole');
    render(<CommandConsole />);

    await screen.findByText(/Finding your bus/);
    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
  });

  it('when no bus is assigned to the account', async () => {
    installFetch({ vehicleId: null });
    await renderConsole();

    await screen.findByTestId('driver-no-bus');
    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
  });

  it('when the bus lookup itself fails', async () => {
    installFetch({ vehicleId: 'reject' });
    await renderConsole();

    await screen.findByTestId('driver-bus-lookup-failed');
    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
  });

  it('when there is no instruction right now', async () => {
    installFetch({ command: null });
    await renderConsole();

    await screen.findByTestId('driver-no-instruction');
    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
  });

  it('when the control room cannot be reached', async () => {
    installFetch({ pollFails: true });
    await renderConsole();

    await screen.findByTestId('driver-poll-error');
    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
  });

  it('when an instruction is on screen awaiting an answer', async () => {
    installFetch({ command: COMMAND });
    await renderConsole();

    await screen.findByTestId('driver-answer-buttons');
    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
  });

  it('when the answer was accepted', async () => {
    installFetch({ command: COMMAND });
    await renderConsole();

    await screen.findByTestId('driver-answer-buttons');
    await userEvent.click(screen.getByRole('button', { name: /Yes, doing it/ }));

    await screen.findByTestId('driver-answer-sent');
    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
  });

  it('when the instruction has gone but the receipt for it is still up', async () => {
    // A DIFFERENT render site from the one above: once the command clears, the
    // console keeps a receipt of what was answered, and that block reported
    // "Answer sent."/"Answer saved on this phone." in English only.
    installFetch({ command: COMMAND });
    await renderConsole();

    await screen.findByTestId('driver-answer-buttons');
    await userEvent.click(screen.getByRole('button', { name: /Yes, doing it/ }));
    await screen.findByTestId('driver-answer-sent');

    // The control room withdraws the instruction; the receipt survives it.
    live.command = null;
    const receipt = await screen.findByTestId('driver-last-answer', {}, { timeout: 12_000 });

    expect(receipt.textContent).toContain('Answer sent.');
    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
    // Waits on a real 4s poll cycle, so it needs more than vitest's 5s
    // default — otherwise the test times out before the state it is testing
    // can possibly arrive, which is a flake rather than a failure.
  }, 20_000);

  // ───────────────────────────────────────────────────────────────────────
  // THE DEFECT'S OWN STATE.
  // ───────────────────────────────────────────────────────────────────────
  it('when the answer could not be saved on the phone — the moment it matters most', async () => {
    // The durable write fails, which is the ONLY thing that renders
    // `answerNotSaved`. Before the fix this alert was English-only.
    enqueueAck.mockRejectedValue(new Error('quota exceeded'));
    installFetch({ command: COMMAND });
    await renderConsole();

    await screen.findByTestId('driver-answer-buttons');
    await userEvent.click(screen.getByRole('button', { name: /Yes, doing it/ }));

    const alert = await screen.findByTestId('driver-ack-error');

    // Named explicitly as well as swept, because this is the string the
    // defect was about and a driver reads it one-handed in a moving cab.
    await waitFor(() => {
      expect(alert.textContent).toContain('Your answer could not be saved on this phone');
      expect(alert.textContent).toContain('जवाब इस फ़ोन में सुरक्षित नहीं हो सका');
    });
    expect(alert.querySelector('[lang="hi"]')).not.toBeNull();

    expectSomeCopyOnScreen();
    expectNoDiscardedTranslation();
  });
});
