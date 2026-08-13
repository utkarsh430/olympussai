# Olympuss Authentication & API Protection

Enterprise authentication (Supabase Auth) gating the UPSRTC dashboard and its
data APIs.

> This document covers the Supabase-backed front door for `/project/upsrtc`
> and `/project/bunching`. It is no longer a separate auth system from the
> operational roles: the two were collapsed onto one door, and **the project
> surface is now gated on the same active `ops_users` profile the ops console
> requires** — see [`RBAC.md`](./RBAC.md) and
> [`AUTH_CUTOVER_RUNBOOK.md`](./AUTH_CUTOVER_RUNBOOK.md).

## Model

- **Credentials:** email + password, verified by Supabase Auth
  (`supabase.auth.signInWithPassword`). There is no shared project PIN and no
  `PROJECT_NAME` concept any more — every account is an individual Supabase
  user.
- **Signing in is not being authorized.** The app exposes no signup route, but
  that is a fact about the app, not about the directory: whether the Supabase
  project itself accepts public self-signup is a dashboard setting, and a
  dashboard setting is not an access-control mechanism. Admission is therefore
  decided against an **active, linked `ops_users` profile**, re-read from the
  database on every guarded request. A valid Supabase session with no such
  profile reaches nothing.

  This is the C1 fix, and it closed a live hole: while the guards asked only
  "is there a session?", any stranger who registered could open the command
  centre and read the entire live fleet feed. Provision project accounts with
  `pnpm run create-project-user` **and** give them an ops row, or they will
  sign in successfully and land on a "no operations access" explanation.
- **Session:** managed entirely by Supabase Auth via `@supabase/ssr`, carried
  in **HttpOnly** cookies that Supabase's SSR helpers read/write. The app never
  hand-rolls a session token — no JWT signing, no `SESSION_SECRET`.
- **The session cookies are never exposed to client JavaScript.**
  `requireUpsrtcAccess()` (`src/lib/auth/authorize.ts`) and `getSupabaseUser()`
  (`src/lib/supabase/server.ts`) call `supabase.auth.getUser()`, which
  re-validates the session against Supabase Auth on every call rather than
  trusting an unverified cookie.

## Defence in depth (three independent checks)

1. **Middleware** (`src/middleware.ts`, Edge) — a **ceiling, not a decision**.
   It turns away requests carrying no credential at all (page → `/login?next=…`,
   API → `401 {"error":"Unauthorized"}`) and accepts either front door, the
   Supabase session or the legacy ops cookie. It cannot do more: the Edge
   runtime cannot reach `pg`, so it cannot read `ops_users`, and a ceiling that
   refused what the authority admits would lock out every operator whose role
   claim has not been pushed yet. See `handleProjectRequest`'s comment.
2. **Page guard** (`requireProjectSurface`, `src/lib/auth/projectPageGuard.ts`),
   called by `(protected)/project/upsrtc/layout.tsx` and
   `(protected)/project/bunching/page.tsx` — resolves the ops profile and
   redirects. A profile-less or disabled account goes to a terminal
   `/login?notice=no-ops-access` explanation, deliberately without a `next`
   that would bounce it straight back.
3. **Every UPSRTC API** calls `requireUpsrtcAccess()`
   (`src/lib/auth/authorize.ts`) itself: `401` for any caller-side refusal
   (identical body for all of them, so `/login` cannot enumerate accounts) and
   `503` when the authority itself is unreachable.

Layers 2 and 3 share one request-scoped resolution, so a dashboard render pays
for one `ops_users` read rather than two.

## Endpoints

| Route                | Method | Purpose                                          |
| --------------------- | ------ | ------------------------------------------------- |
| `/api/auth/login`    | POST   | Validate credentials with Supabase, set session cookies |
| `/api/auth/logout`   | POST   | `supabase.auth.signOut()`, clear session cookies |
| `/api/auth/session`  | GET    | Safe status: `{ authenticated, email? }`          |

`login` enforces: same-origin (Origin/Referer vs host), `application/json`
only, zod-validated body (`email`, `password`), rate limiting, and a **single
generic error** `Invalid email or password.` for every credential failure
(never reveals whether the email exists).

## Rate limiting (best-effort)

`src/lib/auth/rate-limit.ts` — in-memory, per-process, shared with the ops RBAC
login. 5 failed attempts per 15-minute window, keyed on client IP + normalized
email. **On serverless/multi-instance hosting this is best-effort only**
(per-instance counters, reset on cold start). Replace with Redis/Upstash before
treating it as a hard control. It is not presented as more secure than it is.

## Environment variables

Set (uncommitted `.env.local` locally; host env settings in production) — see
`.env.example` for the full list:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon (public) key.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**, bypasses RLS, never sent to
  the browser. Used by `pnpm run create-project-user`, and by the
  admin-authenticated ops routes that provision an invited operator's sign-in
  account and write their role claim (see [`RBAC.md`](./RBAC.md)). Reached
  only through `src/lib/supabase/admin.ts`, which is `server-only`; no
  Edge-runtime module may import it.
- `SITE_URL` — canonical origin.

## Provisioning an account (no self-service sign-up)

```
SUPABASE_URL=https://xyz.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
pnpm run create-project-user -- --email you@example.com
```

Prompts for a password with echo disabled (never as an argv, so it never lands
in shell history or `ps`). Requires the service-role key, so it is meant to be
run out-of-band by whoever administers the Supabase project — not exposed as
an in-app flow.

## Google Maps key (not a secret)

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is visible in browser JS **by design** — it is
not a secret and must not be described as one. Security for it comes from Google
Cloud restrictions, not obscurity:

- Restrict by HTTP referrer: `olympuss.us` (and `www.olympuss.us` if used).
- Restrict to the **Maps JavaScript API** only.
- Use a **separate** development key restricted to `localhost`.
- Set quotas and billing alerts.
- Do **not** reuse the original prototype production key — configure a fresh restricted key.

The Supabase anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) is the same category:
public by design, safe in the browser bundle. Access control comes from
Supabase Auth + Row Level Security, not from keeping the anon key secret.

## API endpoint visibility

The endpoint paths (`/api/upsrtc/*`) remain visible in browser dev tools — that
is expected. Security comes from server-side session verification on every
request, not from hiding endpoint names. The upstream UPSRTC URLs and any
server-only configuration stay server-side and are never sent to the browser.
