// @vitest-environment jsdom
//
// Demoting a corridor below `advisory` is not a dropdown change.
//
// It stops the control service accepting ANY command for that corridor, from
// that moment, with no deploy — and the people who find out are dispatchers
// whose approvals begin failing on a live corridor. The panel this replaced
// rendered promotion and demotion as the same gesture with an optional reason
// box beside it, which is a UI that cannot tell an admin what they are about
// to do.
//
// These tests are about that asymmetry and nothing else: the same select, the
// same button, four different meanings depending on which way it moves.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OpsAdminRolloutStagesPanel } from '@/components/ops/admin/OpsAdminRolloutStagesPanel';
import type { RolloutStage, RolloutStageRow } from '@/models/control';

function row(overrides: Partial<RolloutStageRow> = {}): RolloutStageRow {
  return {
    routeDirectionId: 'rd-1',
    routeId: 'R-100',
    directionCode: 'UP',
    directionName: 'Upward',
    publicName: 'Lucknow — Kanpur',
    stage: 'advisory',
    reason: null,
    updatedBy: null,
    updatedAt: null,
    ...overrides,
  };
}

/** Records every PUT so a test can assert what was, or was not, sent. */
let puts: { url: string; body: unknown }[] = [];

function mountWith(rows: RolloutStageRow[], putResult?: (body: unknown) => unknown) {
  puts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/ops/admin/rollout-stages' && (!init || init.method === undefined)) {
        return {
          ok: true,
          json: async () => ({
            source: 'live',
            stale: false,
            error: null,
            fetchedAt: new Date().toISOString(),
            data: rows,
          }),
        };
      }
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        puts.push({ url, body });
        return {
          ok: true,
          json: async () =>
            putResult
              ? putResult(body)
              : { rolloutStage: { ...rows[0], stage: (body as { stage: RolloutStage }).stage } },
        };
      }
      if (url.includes('/audit')) {
        return { ok: true, json: async () => ({ auditLog: [] }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
  return render(<OpsAdminRolloutStagesPanel />);
}

/** Opens the editor for the single corridor on screen. */
async function openEditor() {
  fireEvent.click(await screen.findByRole('button', { name: /change stage/i }));
  return screen.findByLabelText(/^stage$/i);
}

beforeEach(() => {
  puts = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withdrawing command authority', () => {
  it('warns, in the consequence’s own words, before it can be applied', async () => {
    mountWith([row({ stage: 'advisory' })]);
    const select = await openEditor();

    fireEvent.change(select, { target: { value: 'shadow' } });

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent(/stops commands reaching drivers/i);
    expect(warning).toHaveTextContent(/refuses every command/i);
    expect(warning).toHaveTextContent(/guardrail breach/i);
  });

  it('refuses to submit without a written reason', async () => {
    mountWith([row({ stage: 'advisory' })]);
    const select = await openEditor();
    fireEvent.change(select, { target: { value: 'observation' } });

    const apply = screen.getByRole('button', { name: /withdraw command authority/i });
    expect(apply).toBeDisabled();

    fireEvent.click(apply);
    // Not merely visually disabled — nothing was sent.
    expect(puts).toEqual([]);
  });

  it('accepts it once a reason is given, and sends the reason with it', async () => {
    mountWith([row({ stage: 'expanded' })]);
    const select = await openEditor();
    fireEvent.change(select, { target: { value: 'observation' } });
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: 'repeated guardrail breaches overnight' },
    });

    fireEvent.click(screen.getByRole('button', { name: /withdraw command authority/i }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      url: '/api/ops/admin/rollout-stages/rd-1',
      body: { stage: 'observation', reason: 'repeated guardrail breaches overnight' },
    });
  });

  it('names the button after the act, not after the widget', async () => {
    // "Set stage" is what the old panel called every one of these. The label
    // is the last thing an admin reads before committing.
    mountWith([row({ stage: 'observation' })]);
    // A held corridor is not in the default view, which is itself the point of
    // the default view — reach it the way an admin would.
    fireEvent.click(await screen.findByRole('button', { name: /^every corridor$/i }));
    const select = await openEditor();

    fireEvent.change(select, { target: { value: 'advisory' } });
    expect(screen.getByRole('button', { name: /promote to advisory/i })).toBeEnabled();

    fireEvent.change(select, { target: { value: 'observation' } });
    expect(screen.getByRole('button', { name: /re-stamp this stage/i })).toBeEnabled();
  });
});

describe('a demotion that withdraws nothing', () => {
  it('is not dressed up as one that does, and needs no reason', async () => {
    // expanded -> advisory is narrower, and nothing stops working. Warning an
    // admin about a consequence that will not happen is how warnings stop
    // being read.
    mountWith([row({ stage: 'expanded' })]);
    const select = await openEditor();

    fireEvent.change(select, { target: { value: 'advisory' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const apply = screen.getByRole('button', { name: /narrow to advisory/i });
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.body).toEqual({ stage: 'advisory', reason: null });
  });
});

describe('the list an admin actually works from', () => {
  it('opens on the corridors that accept commands, not on all 759', async () => {
    mountWith([
      row({ routeDirectionId: 'rd-1', publicName: 'Promoted corridor', stage: 'advisory' }),
      row({ routeDirectionId: 'rd-2', publicName: 'Held corridor', stage: 'observation' }),
    ]);

    expect(await screen.findByText('Promoted corridor')).toBeInTheDocument();
    expect(screen.queryByText('Held corridor')).not.toBeInTheDocument();
  });

  it('says plainly when nothing on the network can be commanded', async () => {
    // The dangerous silence: an empty table under a filter reads as "nothing
    // here", when what it means is that the whole network refuses commands.
    mountWith([row({ stage: 'observation' })]);

    expect(await screen.findByText(/no corridor currently accepts commands/i)).toBeInTheDocument();
  });

  it('reaches every corridor through the filters', async () => {
    mountWith([
      row({ routeDirectionId: 'rd-1', publicName: 'Promoted corridor', stage: 'advisory' }),
      row({ routeDirectionId: 'rd-2', publicName: 'Held corridor', stage: 'shadow' }),
    ]);

    fireEvent.click(await screen.findByRole('button', { name: /^every corridor$/i }));

    expect(await screen.findByText('Held corridor')).toBeInTheDocument();
    expect(screen.getByText('Promoted corridor')).toBeInTheDocument();
  });

  it('shows each corridor’s command posture in its row, not only its stage name', async () => {
    mountWith([
      row({ routeDirectionId: 'rd-1', publicName: 'Promoted corridor', stage: 'advisory' }),
      row({ routeDirectionId: 'rd-2', publicName: 'Held corridor', stage: 'shadow' }),
    ]);

    fireEvent.click(await screen.findByRole('button', { name: /^every corridor$/i }));

    const held = (await screen.findByText('Held corridor')).closest('tr')!;
    expect(within(held).getByText('refused')).toBeInTheDocument();
    const promoted = screen.getByText('Promoted corridor').closest('tr')!;
    expect(within(promoted).getByText('permitted')).toBeInTheDocument();
  });
});

describe('when the control service cannot be read', () => {
  it('says the posture is unknown rather than showing an empty, calm network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: {} }) }),
    );

    render(<OpsAdminRolloutStagesPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be read/i);
    expect(alert).toHaveTextContent(/keeps whatever stage it already had/i);
  });
});
