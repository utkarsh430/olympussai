// @vitest-environment jsdom
//
// The one structural safety property this ticket adds to the driver PWA.
//
// The command console is the only place a driver sees an instruction from the
// control room. This ticket puts a map, two polled datasources and the Google
// Maps SDK on the same page, and in React an uncaught render error anywhere in
// a tree unmounts the WHOLE tree. Without a boundary, a malformed arrival
// response would replace a live command with a blank screen and the driver
// would never know an instruction had been sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandConsole } from '@/components/ops/pilot-driver/CommandConsole';

const explode = vi.fn();

vi.mock('@/components/ops/pilot-driver/DriverJourneyPanel', () => ({
  DriverJourneyPanel: () => {
    explode();
    throw new Error('the arrival response was malformed');
  },
}));

// The console polls; it is not what is under test here, so keep it quiet.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, vehicleId: 'UP78FN8125' }),
      }),
  );
  // React logs the caught error; expected, and noise in the run otherwise.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JourneySection - the route view cannot take the command console down with it', () => {
  it('keeps the console mounted when the route view throws during render', async () => {
    const { JourneySection } = await import('@/components/ops/pilot-driver/JourneySection');

    render(
      <div>
        <CommandConsole />
        <JourneySection />
      </div>,
    );

    // The route view really did throw - otherwise this test proves nothing.
    expect(explode).toHaveBeenCalled();

    // ...and the console is still on the page. Addressed by test id rather
    // than by heading text: this test is about the error boundary, and tying
    // it to product copy is what made it fail when the console was reworded
    // rather than when the boundary broke.
    expect(await screen.findByTestId('driver-instruction-region')).toBeInTheDocument();
    expect(screen.getByTestId('driver-no-instruction')).toBeInTheDocument();
  });

  it('says the instructions are still working, so a driver does not assume the console died too', async () => {
    const { JourneySection } = await import('@/components/ops/pilot-driver/JourneySection');
    render(<JourneySection />);

    expect(screen.getByText('The route view could not be shown')).toBeInTheDocument();
    expect(screen.getByText(/instructions above are still working/i)).toBeInTheDocument();
  });
});
