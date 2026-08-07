// @vitest-environment node
//
// This whole suite exercises Node-only ops RBAC modules (jose signing,
// bcryptjs, node:crypto) with no DOM dependency. Running under the default
// jsdom environment (vitest.config.ts) breaks jose: jsdom's TextEncoder
// produces a Uint8Array from a different realm than the one jose's webapi
// build checks `instanceof Uint8Array` against, so `SignJWT.sign()` throws
// "payload must be an instance of Uint8Array" even though the identical
// production code (src/lib/auth/session.ts's own `new TextEncoder().encode`
// pattern) is correct and works under every real runtime (Node, Edge,
// browser). Per-file `node` environment sidesteps the jsdom-only artifact
// without touching that shared, already-shipped pattern.
import { describe, it, expect, beforeAll } from 'vitest';
import { OPS_ROLES, isOpsRole, roleForSegment, OPS_ROLE_SEGMENT } from '@/lib/auth/rbac/roles';
import { sanitizeOpsNext } from '@/lib/auth/rbac/redirect';
import { hashInviteToken, generateInviteToken, hashesEqual } from '@/lib/auth/rbac/tokens';
import { createOpsSessionToken, verifyOpsSessionToken } from '@/lib/auth/rbac/session';
import { hashPassword, verifyPassword } from '@/lib/auth/rbac/passwords';

beforeAll(() => {
  process.env.OPS_SESSION_SECRET = 'a'.repeat(40);
});

describe('ops RBAC roles', () => {
  it('recognizes exactly the six operational roles plus admin', () => {
    expect(OPS_ROLES).toEqual([
      'driver',
      'pilot_driver',
      'dispatcher',
      'depot',
      'control_room',
      'planner',
      'admin',
    ]);
  });

  it('pilot_driver is a distinct role from driver, with its own URL segment', () => {
    expect(isOpsRole('pilot_driver')).toBe(true);
    expect(OPS_ROLE_SEGMENT.pilot_driver).toBe('pilot-driver');
    expect(roleForSegment('pilot-driver')).toBe('pilot_driver');
    expect(roleForSegment('pilot-driver')).not.toBe('driver');
  });

  it('isOpsRole rejects unknown values', () => {
    expect(isOpsRole('driver')).toBe(true);
    expect(isOpsRole('superuser')).toBe(false);
    expect(isOpsRole(42)).toBe(false);
    expect(isOpsRole(undefined)).toBe(false);
  });

  it('maps each role to its own URL segment and back', () => {
    for (const role of OPS_ROLES) {
      const segment = OPS_ROLE_SEGMENT[role];
      expect(roleForSegment(segment)).toBe(role);
    }
  });

  it('control_room role uses a hyphenated URL segment', () => {
    expect(OPS_ROLE_SEGMENT.control_room).toBe('control-room');
  });

  it('roleForSegment returns null for non-role segments (auth surfaces)', () => {
    expect(roleForSegment('login')).toBeNull();
    expect(roleForSegment('forbidden')).toBeNull();
    expect(roleForSegment('auth')).toBeNull();
    expect(roleForSegment('')).toBeNull();
  });
});

describe('sanitizeOpsNext', () => {
  it('accepts a deep link under a role surface', () => {
    expect(sanitizeOpsNext('/ops/dispatcher')).toBe('/ops/dispatcher');
  });

  it('rejects missing, protocol-relative, and off-surface paths', () => {
    expect(sanitizeOpsNext(null)).toBeNull();
    expect(sanitizeOpsNext(undefined)).toBeNull();
    expect(sanitizeOpsNext('//evil.example.com')).toBeNull();
    expect(sanitizeOpsNext('/project/upsrtc')).toBeNull();
    expect(sanitizeOpsNext('https://evil.example.com')).toBeNull();
  });

  it('rejects the login and accept-invite pages themselves (no redirect loop)', () => {
    expect(sanitizeOpsNext('/ops/login')).toBeNull();
    expect(sanitizeOpsNext('/ops/accept-invite?token=x')).toBeNull();
  });
});

describe('invite tokens', () => {
  it('generates high-entropy, URL-safe tokens', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically so a lookup by hash is possible', () => {
    const token = 'fixed-token-value';
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).not.toBe(token);
  });

  it('hashesEqual is true only for identical digests', () => {
    const h1 = hashInviteToken('one');
    const h2 = hashInviteToken('one');
    const h3 = hashInviteToken('two');
    expect(hashesEqual(h1, h2)).toBe(true);
    expect(hashesEqual(h1, h3)).toBe(false);
  });
});

describe('ops session tokens', () => {
  it('round-trips a signed session for a given user/role', async () => {
    const token = await createOpsSessionToken({
      id: 'user-1',
      email: 'dispatcher@example.com',
      role: 'dispatcher',
    });
    const claims = await verifyOpsSessionToken(token);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('user-1');
    expect(claims?.role).toBe('dispatcher');
    expect(claims?.email).toBe('dispatcher@example.com');
  });

  it('rejects a missing, malformed, or tampered token', async () => {
    expect(await verifyOpsSessionToken(undefined)).toBeNull();
    expect(await verifyOpsSessionToken('not-a-jwt')).toBeNull();

    const token = await createOpsSessionToken({
      id: 'user-2',
      email: 'planner@example.com',
      role: 'planner',
    });
    const tampered = `${token.slice(0, -2)}zz`;
    expect(await verifyOpsSessionToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret (cannot cross-authenticate PIN sessions)', async () => {
    const token = await createOpsSessionToken({
      id: 'user-3',
      email: 'admin@example.com',
      role: 'admin',
    });

    const originalSecret = process.env.OPS_SESSION_SECRET;
    process.env.OPS_SESSION_SECRET = 'b'.repeat(40);
    try {
      expect(await verifyOpsSessionToken(token)).toBeNull();
    } finally {
      process.env.OPS_SESSION_SECRET = originalSecret;
    }
  });
});

describe('ops password hashing', () => {
  it('round-trips a password through bcrypt', async () => {
    const hash = await hashPassword('a-very-strong-password-123');
    expect(await verifyPassword('a-very-strong-password-123', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('verifyPassword never throws on a malformed hash', async () => {
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });
});
