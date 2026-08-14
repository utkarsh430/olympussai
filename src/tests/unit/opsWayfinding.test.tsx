// @vitest-environment jsdom
//
// Wayfinding to the operations console.
//
// The whole /ops/* surface (seven roles, every real dashboard) used to be
// reachable only by typing the URL: the landing page linked to /login alone,
// which is Supabase enterprise auth and answers 503 "Authentication is not
// configured." when Supabase is unset. Operators followed the one visible
// sign-in link, hit that error, and concluded their credentials were wrong.
//
// These tests pin the two exits from that dead end: a link on the landing page,
// and a pointer in the /login error state.
//
// BOTH DESTINATIONS MOVED AT THE LOGIN COLLAPSE, and the reasoning is worth
// keeping because the assertions below now look like they contradict the story
// above.
//
// /login IS the operations console's front door now — it routes each operator
// to their own dashboard by role — so the landing-page link points there. The
// link is still worth having: its value was never the URL, it was the word
// "Operations" being visible in the footer at all. Staff who scanned for it,
// failed to find it, and followed "Project Login" instead are the exact
// failure it was added to prevent, and that has not changed.
//
// The 503 pointer moved somewhere genuinely different. A 503 means Supabase is
// the thing that is unavailable, so pointing at /ops/login would now forward
// the user straight back to the page that just failed them. It points at the
// explicit legacy escape hatch instead — the one door that still works when
// Supabase is down, and the reason /ops/login is redirected rather than
// deleted.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LandingPage from '@/app/(public)/page';
import { LoginForm } from '@/components/auth/LoginForm';
import { OPS_LEGACY_LOGIN_PATH } from '@/lib/auth/landing';

beforeAll(() => {
  // The landing page's Reveal/SiteHeader components consult prefers-reduced-
  // motion on mount; jsdom ships no matchMedia. Report "no preference".
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  // Reveal observes its own section for scroll-in animation; jsdom has no
  // IntersectionObserver. A no-op keeps the markup mounted and inert.
  class NoopIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('landing page sign-in wayfinding', () => {
  it('exposes a link to the operations console', () => {
    render(<LandingPage />);
    // The landing footer's SIGNPOST, which is a different thing from the
    // sign-in form's 503 escape hatch below. Operators scanned the footer for
    // the word "Operations", did not find it, followed "Project Login"
    // instead and concluded their credentials were wrong. That word is the
    // entire value of this link.
    const link = screen.getByRole('link', { name: /operations sign-in/i });
    // The single front door. Kept as a signpost, not a second destination.
    expect(link).toHaveAttribute('href', '/login');
  });

  it('still offers the project login it always had', () => {
    render(<LandingPage />);
    const projectLinks = screen.getAllByRole('link', { name: /project login/i });
    expect(projectLinks.length).toBeGreaterThan(0);
    for (const link of projectLinks) expect(link).toHaveAttribute('href', '/login');
  });
});

describe('/login error copy', () => {
  function mockLoginResponse(status: number, body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  }

  async function submit() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
  }

  it('points at the operations console when auth is not configured', async () => {
    // 503 is the API's misconfiguration answer. Nothing typed here can work,
    // so the form must say so and offer the surface that does.
    mockLoginResponse(503, { error: 'Authentication is not configured.' });
    render(<LoginForm next="/project" />);
    await submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Authentication is not configured.');
    expect(alert).toHaveTextContent(/your email and password are not the problem/i);

    const link = screen.getByRole('link', { name: /backup operations sign-in/i });
    expect(link).toHaveAttribute('href', OPS_LEGACY_LOGIN_PATH);
  });

  it('does not offer the ops console for an ordinary bad-credentials failure', async () => {
    // A wrong password is the user's problem, not a routing problem —
    // redirecting them elsewhere would be noise, and the message stays generic.
    mockLoginResponse(401, { error: 'Invalid email or password.' });
    render(<LoginForm next="/project" />);
    await submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password.');
    expect(screen.queryByRole('link', { name: /ops/i })).toBeNull();
  });

  it('clears the ops pointer once a different failure follows', async () => {
    mockLoginResponse(503, { error: 'Authentication is not configured.' });
    render(<LoginForm next="/project" />);
    await submit();
    expect(
      await screen.findByRole('link', { name: /backup operations sign-in/i }),
    ).toBeInTheDocument();

    mockLoginResponse(401, { error: 'Invalid email or password.' });
    await submit();
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /backup operations sign-in/i })).toBeNull();
    });
  });
});
