// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApprovalQueuePanel } from '@/components/ops/ApprovalQueuePanel';
import { KillSwitchPanel } from '@/components/ops/control-room/KillSwitchPanel';
import { KillSwitchBanner } from '@/components/ops/KillSwitchBanner';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';

afterEach(() => {
  vi.unstubAllGlobals();
});

function queuedAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'da-1',
    dispatcherUserId: 'user-1',
    actionType: 'stop_skip',
    reason: 'Blocking incident ahead',
    routeDirectionId: 'rd-1',
    vehicleId: 'UP25FT4823',
    incidentId: null,
    consumedAt: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    decision: 'pending',
    ...overrides,
  };
}

describe('ApprovalQueuePanel', () => {
  it('loads and renders pending disruptive actions from the queue endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ actions: [queuedAction()] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalQueuePanel canDecide={false} />);

    await waitFor(() => expect(screen.getByText('Blocking incident ahead')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ops/dispatcher/approvals?status=pending&disruptiveOnly=true',
      expect.objectContaining({ cache: 'no-store' }),
    );
    // Read-only mode (dispatcher dashboard): no decision buttons.
    expect(screen.queryByRole('button', { name: /refuse/i })).not.toBeInTheDocument();
  });

  it('shows an empty state when there is nothing pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ actions: [] }) }),
    );
    render(<ApprovalQueuePanel canDecide={false} />);
    await waitFor(() =>
      expect(screen.getByText(/nothing disruptive is waiting for a decision/i)).toBeInTheDocument(),
    );
  });

  it('canDecide=true lets control-room reject an action with a reason, logged via the reject endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/ops/dispatcher/approvals')) {
        return Promise.resolve({ ok: true, json: async () => ({ actions: [queuedAction()] }) });
      }
      if (url === '/api/ops/control-room/approvals/da-1/reject') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, dispatcherActionId: 'da-1' }),
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalQueuePanel canDecide onApprove={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Blocking incident ahead')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^refuse$/i }));
    fireEvent.change(screen.getByLabelText(/why you are refusing this/i), {
      target: { value: 'Not safe to skip this stop' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm refusal/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ops/control-room/approvals/da-1/reject',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'Not safe to skip this stop' }),
        }),
      ),
    );
  });

  it('calls onApprove with the approval reference when "Approve and send" is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ actions: [queuedAction()] }) }),
    );
    const onApprove = vi.fn();
    render(<ApprovalQueuePanel canDecide onApprove={onApprove} />);
    await waitFor(() => expect(screen.getByText('Blocking incident ahead')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /approve and send/i }));
    expect(onApprove).toHaveBeenCalledWith('da-1');
  });
});

function killSwitch(overrides: Partial<KillSwitchRecord> = {}): KillSwitchRecord {
  return {
    id: 'ks-1',
    scope: 'network',
    routeDirectionId: null,
    engagedAt: '2026-08-06T00:00:00.000Z',
    engagedBy: 'user-1',
    reason: 'Signal outage across the network',
    disengagedAt: null,
    disengagedBy: null,
    disengageReason: null,
    ...overrides,
  };
}

describe('KillSwitchPanel', () => {
  it('says plainly that nothing is stopped when no switch is on', () => {
    render(<KillSwitchPanel initialActive={[]} />);
    expect(screen.getByText(/nothing is stopped/i)).toBeInTheDocument();
  });

  it('shows an active stop with where it applies and why', () => {
    render(<KillSwitchPanel initialActive={[killSwitch()]} />);
    // "Whole state" also appears as a <select> option in the form below, so
    // assert at least one match rather than a single unique one.
    expect(screen.getAllByText(/whole state/i).length).toBeGreaterThan(0);
    // And the limit of what it does is on the panel, not only in a comment.
    expect(screen.getByText(/instructions sent before then still stand/i)).toBeInTheDocument();
    expect(screen.getByText(/Signal outage across the network/)).toBeInTheDocument();
  });

  it('stops instructions on one corridor via POST /api/ops/control-room/kill-switches', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/ops/control-room/kill-switches' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, killSwitch: killSwitch() }),
        });
      }
      if (url === '/api/ops/control-room/kill-switches') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active: [killSwitch({ scope: 'route', routeDirectionId: 'rd-9' })],
          }),
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KillSwitchPanel initialActive={[]} />);
    fireEvent.change(screen.getByLabelText(/^where/i), { target: { value: 'route' } });
    fireEvent.change(screen.getByLabelText(/which corridor/i), { target: { value: 'rd-9' } });
    fireEvent.change(screen.getByLabelText(/why you are stopping instructions/i), {
      target: { value: 'Track maintenance in progress' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^stop instructions$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ops/control-room/kill-switches',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            scope: 'route',
            routeDirectionId: 'rd-9',
            reason: 'Track maintenance in progress',
          }),
        }),
      ),
    );
  });
});

describe('KillSwitchBanner', () => {
  it('renders nothing when there are no active kill switches', () => {
    const { container } = render(
      <KillSwitchBanner activeKillSwitches={[]} routeDirectionId="rd-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('always shows a network-wide switch regardless of the viewed route-direction', () => {
    render(<KillSwitchBanner activeKillSwitches={[killSwitch()]} routeDirectionId="rd-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/network-wide/i);
  });

  it('only shows a route-level switch when it matches the currently-viewed route-direction', () => {
    const routeSwitch = killSwitch({
      id: 'ks-2',
      scope: 'route',
      routeDirectionId: 'rd-9',
      reason: 'Track work',
    });
    const { rerender } = render(
      <KillSwitchBanner activeKillSwitches={[routeSwitch]} routeDirectionId="rd-1" />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<KillSwitchBanner activeKillSwitches={[routeSwitch]} routeDirectionId="rd-9" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/rd-9/);
  });
});
