// @vitest-environment node
//
// Covers the pure parts of the Resend integration: the branded template
// renderer and the invite-status derivation. Does NOT import
// src/lib/email/resend.ts itself (its fail-closed "missing API key" branch
// is a couple of lines and is exercised indirectly through the route
// handlers) — that module, like the rest of src/lib/auth/rbac/* and
// src/lib/db/pool.ts, imports the `server-only` package, which is used
// throughout this repo but is not declared as an npm dependency anywhere
// (pre-existing gap, not introduced by this change), so importing it
// directly under Vitest fails with "Cannot find package 'server-only'".
import { describe, it, expect } from 'vitest';
import { renderInviteEmail } from '@/lib/email/inviteEmailTemplate';
import { deriveInviteStatus, type InviteStatusInput } from '@/lib/auth/rbac/inviteStatus';

function makeInvite(overrides: Partial<InviteStatusInput> = {}): InviteStatusInput {
  return {
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('renderInviteEmail', () => {
  it('includes the accept link, role, and a stated expiry in both html and text', () => {
    const rendered = renderInviteEmail({
      role: 'dispatcher',
      acceptUrl: 'https://olympuss.us/ops/accept-invite?token=abc123',
      expiresAt: '2026-08-12T10:00:00.000Z',
    });

    expect(rendered.subject).toContain('Dispatcher');
    expect(rendered.html).toContain('https://olympuss.us/ops/accept-invite?token=abc123');
    expect(rendered.html).toContain('Dispatcher');
    expect(rendered.html).toMatch(/expires on/i);
    expect(rendered.text).toContain('https://olympuss.us/ops/accept-invite?token=abc123');
    expect(rendered.text).toMatch(/expires on/i);
  });

  it('escapes HTML-significant characters from interpolated values', () => {
    const rendered = renderInviteEmail({
      role: 'admin',
      acceptUrl: 'https://olympuss.us/ops/accept-invite?token=a&b<script>',
      expiresAt: '2026-08-12T10:00:00.000Z',
    });

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });
});

describe('deriveInviteStatus', () => {
  it('is pending for an unexpired, unaccepted, unrevoked invite', () => {
    expect(deriveInviteStatus(makeInvite())).toBe('pending');
  });

  it('is expired once expiresAt has passed', () => {
    expect(
      deriveInviteStatus(makeInvite({ expiresAt: new Date(Date.now() - 1000).toISOString() })),
    ).toBe('expired');
  });

  it('is accepted once acceptedAt is set, even if also past expiry', () => {
    expect(
      deriveInviteStatus(
        makeInvite({
          acceptedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      ),
    ).toBe('accepted');
  });

  it('is revoked once revokedAt is set', () => {
    expect(deriveInviteStatus(makeInvite({ revokedAt: new Date().toISOString() }))).toBe('revoked');
  });
});
