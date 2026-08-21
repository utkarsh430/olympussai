// @vitest-environment jsdom
//
// The occupancy switch, as an operator meets it.
//
// The control itself is trivial; what this file protects is the three things
// around it that are easy to get wrong and expensive when wrong:
//
//   * turning it ON is the direction with a prerequisite, so the warning must
//     appear on that side and not the other;
//   * an unreadable setting must never render as "off";
//   * a change with no reason must not be sendable, because the reason is the
//     only record of why the engine's priorities changed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OccupancyToggle } from '@/components/ops/control-room/alerts/OccupancyToggle';
import type { ControlSettings } from '@/lib/controlService/settings';

const OFF: ControlSettings = {
  weighOccupancy: false,
  updatedAt: '2026-08-20T09:00:00.000Z',
  updatedBy: null,
  updateReason: null,
};

const ON: ControlSettings = {
  ...OFF,
  weighOccupancy: true,
  updatedBy: 'someone@example.com',
  updateReason: 'boardings loaded',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('OccupancyToggle', () => {
  it('says what the engine is weighing right now, in the operator’s terms', () => {
    render(<OccupancyToggle initialSettings={OFF} />);
    expect(screen.getByText('Even spacing and punctuality only')).toBeTruthy();
    expect(screen.getByText(/timetable delay bunching causes/i)).toBeTruthy();
  });

  it('shows who last changed it and why', () => {
    render(<OccupancyToggle initialSettings={ON} />);
    expect(screen.getByText(/someone@example.com/)).toBeTruthy();
    expect(screen.getByText(/boardings loaded/)).toBeTruthy();
  });

  // Turning it ON reads as the considerate option, which is exactly why the
  // warning belongs on that side: with an uncalibrated arrival rate it does
  // not make the controller gentler, it makes it go quiet.
  it('warns before switching occupancy weighting ON', () => {
    render(<OccupancyToggle initialSettings={OFF} />);
    expect(screen.getByText(/Check this before switching it on/i)).toBeTruthy();
    expect(screen.getByText(/stop proposing holds almost entirely/i)).toBeTruthy();
  });

  // Turning it OFF returns the engine to the two stated priorities, which
  // needs no caveat - and a warning shown on both sides is a warning nobody
  // reads on either.
  it('does not warn when switching it back OFF', () => {
    render(<OccupancyToggle initialSettings={ON} />);
    expect(screen.queryByText(/Check this before switching it on/i)).toBeNull();
  });

  // Unknown is not off. Only one of them is safe to act on.
  it('never renders an unreadable setting as "off"', () => {
    render(
      <OccupancyToggle initialSettings={null} initialError="The control service could not be reached." />,
    );
    expect(screen.getByText(/current setting is unknown/i)).toBeTruthy();
    expect(screen.getByText(/not the same as it being switched off/i)).toBeTruthy();
    expect(screen.queryByText('Even spacing and punctuality only')).toBeNull();
  });

  it('will not send a change without a reason', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<OccupancyToggle initialSettings={OFF} />);

    const button = screen.getByRole('button', { name: /Also weigh how full each bus is/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('A reason is required.')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the change, with its reason, once one is given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(ON), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const user = userEvent.setup();
    render(<OccupancyToggle initialSettings={OFF} />);

    await user.type(screen.getByLabelText(/Why are you changing this/i), 'boardings loaded');
    await user.click(screen.getByRole('button', { name: /Also weigh how full each bus is/i }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      weighOccupancy: true,
      updateReason: 'boardings loaded',
    });

    // The panel reflects the new state rather than waiting for a reload.
    expect(await screen.findByText(/how full each bus is/i)).toBeTruthy();
  });

  it('keeps the operator informed when the change is refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Engine unreachable.' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const user = userEvent.setup();
    render(<OccupancyToggle initialSettings={OFF} />);

    await user.type(screen.getByLabelText(/Why are you changing this/i), 'trying it');
    await user.click(screen.getByRole('button', { name: /Also weigh how full each bus is/i }));

    expect(await screen.findByText('Engine unreachable.')).toBeTruthy();
    // And the displayed state does NOT move, because nothing changed.
    expect(screen.getByText('Even spacing and punctuality only')).toBeTruthy();
  });
});
