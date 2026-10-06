# Depot Management P0 — Entry and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The command centre's "Fleet Distribution" button becomes a "Depot Management" link that opens a session-gated, dark, scrolling shell at `/project/depots`, and a deep link to it survives login.

**Architecture:** A new route group folder `src/app/(protected)/project/depots/` with its own layout (session gate + shell), following the Bunching page precedent rather than nesting under the fixed-viewport `upsrtc/layout.tsx`. Post-login redirects move from a single hard-coded prefix to a normalised allowlist. No data is fetched in this phase.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind 3.4, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md` and `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`. Read both before starting.

## Global Constraints

- Reference is `main` only. Never read, copy from, stage or modify `control-service/`, `.preview-simulator/`, `.claude/`.
- Never read any `.env*` file. Local verification uses the wrapper named in the dispatch brief.
- Stage files by explicit path. Never `git add -A`, `git add .` or `git commit -a`. No push.
- One commit per small logical change, conventional prefix (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`), ending with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- The word "simulated" must never appear in rendered UI (e2e test 21). The on-screen provenance word is MODELLED.
- TypeScript strict: no `any`, explicit types on exports, `readonly` inputs, no mutation.
- No `console.log`. Files stay under about 200 lines.
- No new npm dependencies.
- Every depot page ends with `FooterDisclaimer variant="dark"` (README section 25).
- No CSS `zoom`, scanline or noise overlays on depot pages.
- Nothing below 11px type on depot pages.

## Review Focus

1. A crafted `next` value (`/project/depots/../../login`, `/\evil.com`, `//evil.com`, tab or newline smuggling, `https://evil.com`) must fall back to the default and never leave the protected surface. Tests in Task 1.
2. `/project/depotsX` must not pass as `/project/depots` (prefix confusion). Test in Task 1.
3. An unauthenticated request to `/project/depots` must never render shell markup. Test in Task 2 (unit) and Task 7 (e2e).
4. The old demand overlay must still open from the bus drawer after the button stops opening it. Existing e2e test 8 covers it; Task 6 must leave it green.
5. A trailing slash or query string on the path must not break the active nav state. Test in Task 4.

---

### Task 1: Normalised redirect allowlist

**Files:**
- Modify: `src/lib/auth/redirect.ts`
- Test: `src/tests/unit/redirect.test.ts` (new)

**Interfaces:**
- Produces: `PROTECTED_ROOTS: readonly string[]`, `sanitizeNext(next: string | null | undefined): string` (signature unchanged), `DEFAULT_NEXT` (unchanged).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT, PROTECTED_ROOTS, sanitizeNext } from '@/lib/auth/redirect';

describe('sanitizeNext', () => {
  it('falls back to the default for empty input', () => {
    expect(sanitizeNext(null)).toBe(DEFAULT_NEXT);
    expect(sanitizeNext(undefined)).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('')).toBe(DEFAULT_NEXT);
  });

  it.each(PROTECTED_ROOTS)('allows the protected root %s and paths under it', (root) => {
    expect(sanitizeNext(root)).toBe(root);
    expect(sanitizeNext(`${root}/a/b`)).toBe(`${root}/a/b`);
  });

  it('allows a depot deep link and keeps its query string and hash', () => {
    expect(sanitizeNext('/project/depots/d/42/roster?state=dark#top')).toBe(
      '/project/depots/d/42/roster?state=dark#top',
    );
  });

  it('rejects a lookalike prefix', () => {
    expect(sanitizeNext('/project/depotsX')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/project/upsrtc-admin')).toBe(DEFAULT_NEXT);
  });

  it('rejects internal paths outside the protected roots', () => {
    expect(sanitizeNext('/project/other')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/api/auth/logout')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/login')).toBe(DEFAULT_NEXT);
  });

  it('rejects external and protocol-relative targets', () => {
    expect(sanitizeNext('https://evil.example')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('//evil.example')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/\\evil.example')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('javascript:alert(1)')).toBe(DEFAULT_NEXT);
  });

  it('rejects traversal out of a protected root', () => {
    expect(sanitizeNext('/project/depots/../../login')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/project/depots/%2e%2e/%2e%2e/login')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/project/depots\\..\\..\\login')).toBe(DEFAULT_NEXT);
  });

  it('rejects whitespace smuggling that would resolve off-origin', () => {
    expect(sanitizeNext('/\t/evil.example')).toBe(DEFAULT_NEXT);
    expect(sanitizeNext('/\n/evil.example')).toBe(DEFAULT_NEXT);
  });

  it('normalises traversal that stays inside a protected root', () => {
    expect(sanitizeNext('/project/depots/d/../league')).toBe('/project/depots/league');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/redirect.test.ts`
Expected: FAIL — `PROTECTED_ROOTS` is not exported, and the bunching, depots and traversal cases fail.

- [ ] **Step 3: Commit the failing test**

`git add src/tests/unit/redirect.test.ts` then commit `test: cover post-login redirect allowlist and traversal`.

- [ ] **Step 4: Implement**

Replace the body of `src/lib/auth/redirect.ts` below its header comment (update the comment to describe the allowlist) with:

```ts
export const DEFAULT_NEXT = '/project/upsrtc';

/** Protected project surfaces a post-login redirect may target. */
export const PROTECTED_ROOTS: readonly string[] = [
  '/project/upsrtc',
  '/project/bunching',
  '/project/depots',
];

/** Throwaway origin used only to resolve and normalise a root-relative path. */
const RESOLVE_BASE = 'http://internal.invalid';

function isUnderProtectedRoot(pathname: string): boolean {
  return PROTECTED_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function sanitizeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;
  // Must be a root-relative path, not a protocol-relative or backslash trick.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return DEFAULT_NEXT;
  }
  // Resolve the way a browser would, so dot segments, backslashes and stripped
  // control characters are judged on the path they actually produce.
  let resolved: URL;
  try {
    resolved = new URL(next, RESOLVE_BASE);
  } catch {
    return DEFAULT_NEXT;
  }
  if (resolved.origin !== RESOLVE_BASE) return DEFAULT_NEXT;
  if (!isUnderProtectedRoot(resolved.pathname)) return DEFAULT_NEXT;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
```

- [ ] **Step 5: Run the test and the whole unit suite**

Run: `npx vitest run src/tests/unit/redirect.test.ts && npm run test`
Expected: all pass (224 existing + the new file).

- [ ] **Step 6: Commit**

`git add src/lib/auth/redirect.ts`, commit `feat: allow bunching and depots as post-login redirect targets`.

---

### Task 2: `requireProjectSession` gate helper

**Files:**
- Modify: `src/lib/auth/server.ts`
- Test: `src/tests/unit/requireProjectSession.test.ts` (new)

**Interfaces:**
- Consumes: `getSession()` (same file), `isAuthorizedProject()` from `./config`, `redirect` from `next/navigation`.
- Produces: `requireProjectSession(nextPath: string): Promise<SessionClaims>` — returns the session, or calls `redirect('/login?next=<encoded nextPath>')`.

- [ ] **Step 1: Write the failing test**

Mock `server-only` (`vi.mock('server-only', () => ({}))`), `next/headers` (`cookies` returning a store whose `get` returns a controllable value), `next/navigation` (`redirect` as a `vi.fn` that throws a sentinel error, as the real one never returns), and `@/lib/auth/session` (`verifySessionToken` returning a controllable value). Set `process.env.PROJECT_NAME = 'upsrtc'` in `beforeEach`. Cases:

1. No cookie → `redirect` called once with `/login?next=%2Fproject%2Fdepots`.
2. Valid session for another project (`{ project: 'other', role: 'project-access' }`) → `redirect` called.
3. Valid session for `upsrtc` → resolves to the claims, `redirect` not called.
4. `nextPath` containing a query (`/project/depots/d/7?tab=yard`) is percent-encoded into a single `next` value.

- [ ] **Step 2: Run it and confirm it fails** — `npx vitest run src/tests/unit/requireProjectSession.test.ts`; FAIL because the export does not exist. Commit `test: cover the project session gate helper`.

- [ ] **Step 3: Implement** — append to `src/lib/auth/server.ts`:

```ts
/**
 * Server-component gate: return the session, or redirect to login carrying the
 * path to come back to. Defence in depth behind the edge middleware — every
 * protected layout and page calls it, because layouts do not re-run on client
 * navigation.
 */
export async function requireProjectSession(nextPath: string): Promise<SessionClaims> {
  const session = await getSession();
  if (!session || !isAuthorizedProject(session.project)) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return session;
}
```

with `import { redirect } from 'next/navigation';` and `isAuthorizedProject` added to the existing `./config` import.

- [ ] **Step 4: Run** `npx vitest run src/tests/unit/requireProjectSession.test.ts && npm run typecheck`; expect PASS and no type errors. Commit `feat: add requireProjectSession gate helper`.

---

### Task 3: Depot design tokens and base classes

**Files:**
- Modify: `tailwind.config.ts` (add a `depot` colour namespace after `sim`)
- Modify: `src/app/globals.css` (add a "Depot Management surface" block inside `@layer components`, after the `sim-*` block)

**Interfaces:**
- Produces Tailwind colours `depot-page`, `depot-surface`, `depot-raised`, `depot-line`, `depot-ink`, `depot-muted`, `depot-faint`, and classes `.depot-shell`, `.depot-panel`, `.depot-label`, `.depot-title`, `.depot-prose`, `.depot-nav-link`, `.depot-nav-link-active`.

- [ ] **Step 1: Add the colours** (values from the design brief):

```ts
        // Depot Management surface: the command centre's palette with the
        // lights turned down. Ink tiers all clear 4.5:1 on `page`.
        depot: {
          page: '#02040a',
          surface: '#070f1d',
          raised: '#0a1626',
          line: 'rgba(63, 240, 255, 0.12)',
          ink: '#dbe7f3',
          muted: '#9bb0c7',
          faint: '#6b84a0',
        },
```

Commit `feat: add depot colour tokens`.

- [ ] **Step 2: Add the classes**

```css
  /* ── Depot Management surface ───────────────────────────────────────────
     Shares the command centre's palette and typefaces but is a scrolling
     working ledger: flat panels and hairlines, no glow, no CSS zoom. */
  .depot-shell {
    @apply min-h-dvh bg-depot-page font-mono text-[13px] text-depot-ink antialiased;
    font-feature-settings: 'tnum' 1;
  }

  /* Repaint the body so overscroll and short pages never show the neutral
     base colour (same reason as `body:has(.sim-light)` above). */
  body:has(.depot-shell) {
    background-color: #02040a;
  }

  .depot-panel {
    @apply rounded-md border border-depot-line bg-depot-surface;
  }

  .depot-label {
    @apply font-mono text-[11px] uppercase tracking-[0.16em] text-depot-faint;
  }

  .depot-title {
    @apply font-display text-xl font-semibold uppercase tracking-[0.12em] text-depot-ink;
  }

  .depot-prose {
    @apply font-sans text-sm leading-[1.55] text-depot-muted;
  }

  .depot-nav-link {
    @apply block border-l-2 border-transparent px-4 py-2 font-mono text-xs uppercase tracking-[0.1em]
      text-depot-muted transition-colors hover:bg-depot-raised hover:text-depot-ink;
  }

  .depot-nav-link-active {
    @apply border-holo-glow bg-depot-raised text-holo-glow;
  }
```

- [ ] **Step 3:** `npm run build` compiles (Tailwind resolves every `@apply`). Commit `feat: add depot surface classes`.

---

### Task 4: Navigation model

**Files:**
- Create: `src/lib/depot/nav.ts`
- Test: `src/tests/unit/depot-nav.test.ts`

**Interfaces:**
- Produces: `DEPOTS_ROOT = '/project/depots'`, `interface DepotNavItem { href: string; label: string; exact?: boolean }`, `interface DepotNavGroup { heading: string; items: readonly DepotNavItem[] }`, `NETWORK_NAV: readonly DepotNavGroup[]`, `isNavItemActive(pathname: string, item: DepotNavItem): boolean`.

- [ ] **Step 1: Failing test** — cases for `isNavItemActive`:
  - exact item `/project/depots`: active for `/project/depots` and `/project/depots/`; not active for `/project/depots/league`.
  - non-exact item `/project/depots/league`: active for `/project/depots/league`, `/project/depots/league/`, `/project/depots/league/x`; not active for `/project/depots/leagues`.
  - `NETWORK_NAV` has at least one group and every `href` starts with `DEPOTS_ROOT`.

  Run, confirm FAIL, commit `test: cover depot nav active matching`.

- [ ] **Step 2: Implement**

```ts
/** Navigation model for the Depot Management shell. Later phases add items. */
export const DEPOTS_ROOT = '/project/depots';

export interface DepotNavItem {
  readonly href: string;
  readonly label: string;
  /** Match only the exact path (used for a section's index page). */
  readonly exact?: boolean;
}

export interface DepotNavGroup {
  readonly heading: string;
  readonly items: readonly DepotNavItem[];
}

export const NETWORK_NAV: readonly DepotNavGroup[] = [
  { heading: 'Network', items: [{ href: DEPOTS_ROOT, label: 'Overview', exact: true }] },
];

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function isNavItemActive(pathname: string, item: DepotNavItem): boolean {
  const path = stripTrailingSlash(pathname);
  if (item.exact) return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}
```

- [ ] **Step 3:** run the test, PASS, commit `feat: add depot navigation model`.

---

### Task 5: Shell components and the route

**Files:**
- Create: `src/components/depot/shell/DepotShell.tsx` (server component)
- Create: `src/components/depot/shell/DepotTopBar.tsx` (server component)
- Create: `src/components/depot/shell/DepotNav.tsx` (`'use client'`, uses `usePathname`)
- Create: `src/components/depot/shell/PageHeader.tsx` (server component)
- Create: `src/app/(protected)/project/depots/layout.tsx`
- Create: `src/app/(protected)/project/depots/page.tsx`

**Interfaces:**
- Consumes: `requireProjectSession` (Task 2), `NETWORK_NAV`, `isNavItemActive`, `DEPOTS_ROOT` (Task 4), classes from Task 3, `FooterDisclaimer` (`src/components/shared/FooterDisclaimer.tsx`, a `relative shrink-0` block — place it as the last child of the shell column), `ProjectSignOut` (`src/components/upsrtc/ProjectSignOut.tsx`).
- Produces:
  - `DepotShell({ children }: { children: React.ReactNode })`
  - `DepotNav({ groups }: { groups: readonly DepotNavGroup[] })`
  - `PageHeader({ title, description, children }: { title: string; description: string; children?: React.ReactNode })` — renders an `<h1 className="depot-title">`, a `<p className="depot-prose">`, and `children` right-aligned as controls.

Requirements (design brief is authoritative):

- `DepotShell`: `<div className="depot-shell flex min-h-dvh flex-col">`; first child a skip link to `#depot-main` (same pattern as `upsrtc/layout.tsx`, text "Skip to depot content"); then `DepotTopBar`; then a row (`flex min-w-0 flex-1 flex-col min-[900px]:flex-row`) holding `DepotNav` and `<main id="depot-main" className="min-w-0 flex-1 px-6 py-6">`; then `FooterDisclaimer variant="dark"`.
- `DepotTopBar`: sticky, 56px, `border-b border-depot-line bg-depot-page`, `data-testid="depot-top-bar"`. Left: the product title "Depot Management" (`font-display`, 14px, uppercase, tracking 0.14em) and a scope crumb reading `UPSRTC / Network` (`depot-label`). Right: a link to `/project/upsrtc` labelled "Operations" with `data-testid="depot-back-to-operations"` (`hud-button`, `ArrowLeft` icon), then `ProjectSignOut`.
- `DepotNav`: `<nav aria-label="Depot management" data-testid="depot-nav">`, 232px wide at 1280px and above, 200px from 900px, and below 900px a horizontally scrolling strip under the top bar. Sticky below the top bar on wide screens. Each group: heading in `depot-label`, then links with `depot-nav-link`, adding `depot-nav-link-active` and `aria-current="page"` when `isNavItemActive(pathname, item)`.
- `layout.tsx`: `await requireProjectSession(DEPOTS_ROOT)`, load Manrope with `variable: '--font-sans'` (same options as `src/app/(public)/layout.tsx`), wrap `DepotShell` in a div carrying the font variable. `metadata`: title `Depot Management · UPSRTC`, `robots: { index: false, follow: false }`.
- `page.tsx`: `await requireProjectSession(DEPOTS_ROOT)`; `PageHeader` with title "Network overview" and description "Fleet strength, status and efficiency across every UPSRTC depot."; then one `depot-panel` section with `data-testid="depot-overview-pending"` containing the prose "Depot figures appear here once the live depot feed is connected." (P1 replaces this section.)

- [ ] **Step 1:** create `PageHeader.tsx`; commit `feat: add depot page header`.
- [ ] **Step 2:** create `DepotNav.tsx`; commit `feat: add depot navigation rail`.
- [ ] **Step 3:** create `DepotTopBar.tsx`; commit `feat: add depot top bar`.
- [ ] **Step 4:** create `DepotShell.tsx`; commit `feat: add depot shell`.
- [ ] **Step 5:** create `layout.tsx` and `page.tsx`; run `npm run typecheck && npm run lint && npm run build`; the build route table must list `/project/depots` as dynamic (`ƒ`). Commit `feat: add gated depots route`.

---

### Task 6: Rename the button and retire its hook

**Files:**
- Modify: `src/components/command-center/TopCommandBar.tsx` (the `open-fleet-distribution` button, about lines 107-115; the hook import at line 11 and call at line 26)
- Delete: `src/hooks/useFleetDistribution.ts`
- Modify: any comment that still describes the command-bar button opening the demand view (`src/lib/alerts/alertEngine.ts` near line 23)

- [ ] **Step 1:** replace the button with

```tsx
        {/* Opens the Depot Management module. A route, like Bunching beside it:
            it is a full multi-page surface, not an overlay on the map. */}
        <Link
          href="/project/depots"
          className="hud-button-primary whitespace-nowrap"
          data-testid="open-depot-management"
        >
          <Warehouse className="h-3.5 w-3.5" aria-hidden />
          Depot Management
        </Link>
```

  Import `Warehouse` from `lucide-react`; remove the `Scale` import if nothing else uses it; remove the `useFleetDistribution` import and call.

- [ ] **Step 2:** delete `src/hooks/useFleetDistribution.ts` with `git rm`. Then search for exports that existed only to serve it (for example an alert-candidate kind `'fleet-distribution'`): `grep -rn "fleet-distribution\|fleetDistribution\|FleetDistribution" src tests`. Remove code that is now unreachable; keep anything still used by the bus drawer, Scenario Lab, Pitch Mode or tests. List what you removed and what you kept in your report.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test` all pass. Commit `feat: rename Fleet Distribution to Depot Management and link to the module` (one commit for the button and the deletion, since either alone breaks the build).

---

### Task 7: End-to-end coverage

**Files:**
- Modify: `playwright.config.ts` (port override)
- Modify: `tests/e2e/command-centre.spec.ts` (test 22, and any comment mentioning the old button)
- Create: `tests/e2e/depot-management.spec.ts`

- [ ] **Step 1: Port override.** In `playwright.config.ts` add `const PORT = process.env.E2E_PORT ?? '3000';` and `const BASE_URL = \`http://127.0.0.1:${PORT}\`;`; use `BASE_URL` for `use.baseURL` and `webServer.url`, and `npm run start -- -p ${PORT}` for `webServer.command`. Default behaviour is unchanged. Commit `test: allow the e2e port to be overridden`.

- [ ] **Step 2: Rewrite test 22** as

```ts
  test('22. Depot Management opens the depot module from the command bar', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await expect(page.getByTestId('open-depot-management')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('open-depot-management').click();

    await expect(page).toHaveURL(/\/project\/depots$/);
    await expect(page.getByRole('heading', { level: 1, name: /Network overview/i })).toBeVisible();
    await expect(page.getByTestId('depot-nav')).toBeVisible();
  });
```

  Commit `test: assert the command bar opens Depot Management`.

- [ ] **Step 3: New spec** `tests/e2e/depot-management.spec.ts`, using `test.use({ viewport: { width: 1440, height: 900 } })`, the same `E2E_PROJECT_PIN` skip rule and the same API-login `beforeEach` as the command-centre spec for the authenticated block. Tests:

  1. *Unauthenticated deep link survives login.* In a fresh context with no cookie, `goto('/project/depots')`; expect the URL to be `/login` with a `next` parameter decoding to `/project/depots`; fill the login form (read `src/components/auth/LoginForm.tsx` for the field labels or test ids) with `E2E_PROJECT_NAME` and `E2E_PROJECT_PIN`; submit; expect the URL to end `/project/depots` and the Network overview heading to be visible.
  2. *Shell chrome.* Top bar, nav with the Overview item carrying `aria-current="page"`, `footer-disclaimer` visible.
  3. *Back to Operations.* Clicking `depot-back-to-operations` lands on `/project/upsrtc`.
  4. *No banned wording.* `document.body.innerText` on `/project/depots` does not match `/simulated/i`.
  5. *No horizontal page scroll at 1440, 1024 and 800 wide.* For each width, `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
  6. *Keyboard.* The first Tab press focuses the skip link; activating it moves focus into `#depot-main` (give `<main>` `tabIndex={-1}` if needed).
  7. *No console errors* on load, using the same `collectConsoleErrors` approach (copy the helper; do not import across spec files).

  Commit `test: add depot management e2e spec`.

- [ ] **Step 4: Run** the production build and both specs through the wrapper given in the dispatch brief. Record the exact pass/fail counts. If the upstream feed is unreachable the command-centre spec falls back to the fixture; that is expected.

---

### Task 8: Documentation

**Files:**
- Modify: `README.md` — the route table near the top (add `/project/depots`), the project tree, every mention of the Fleet Distribution button (around lines 197, 568, 766), and the deep-link note (around lines 344-356: the Bunching gap is now closed; describe the allowlist).
- Modify: `docs/PRESENTATION_GUIDE.md` (around line 41) and `docs/DEMO_SCRIPT.md` (around line 191) — the button is now "Depot Management" and opens the module; the demand view is reached from a bus's analysis menu or Scenario Lab.

- [ ] **Step 1:** make the edits, keeping each document's existing voice. Do not describe features that do not exist yet: at this point the module is a gated shell.
- [ ] **Step 2:** commit `docs: describe the Depot Management entry point and redirect allowlist`.

---

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build` all pass.
2. Both e2e specs pass through the local wrapper on port 3210.
3. `/project/depots` walked in a browser at 1440, 1024 and 800 wide.
4. Code review, security review (Tasks 1, 2, 5), design critique of the shell; findings fixed or recorded.
