# Olympuss Authentication & API Protection

Single-project PIN authentication gating the UPSRTC dashboard and its data APIs.

## Model

- **Credentials:** a project name (compared case-insensitively, trimmed) and a
  numeric PIN (matched exactly). The raw PIN is never stored in source — only a
  bcrypt hash lives in the environment.
- **Session:** a signed JWT (jose, HS256) carried in an **HttpOnly** cookie
  `olympuss_session` (`SameSite=lax`, `Secure` in production, `Path=/`, 8-hour
  max lifetime). Claims: `project`, `role: project-access`, `iat`, `exp`.
- **The signed token is never exposed to client JavaScript** and localStorage is
  never used for auth.

## Defence in depth (three independent checks)

1. **Middleware** (`src/middleware.ts`, Edge) — first line: unauthenticated
   `/project/*` page requests redirect to `/login?next=…`; unauthenticated
   `/api/upsrtc/*` requests get `401 {"error":"Unauthorized"}`. Imports only
   edge-safe code (jose) — never bcrypt or `next/headers`.
2. **Protected layout** (`(protected)/project/upsrtc/layout.tsx`) — re-verifies
   the session server-side and `redirect()`s if absent. Does not trust
   middleware.
3. **Every UPSRTC API** calls `requireUpsrtcAccess()` itself and returns
   `unauthorizedResponse()` when unauthenticated.

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/login` | POST | Validate + set session cookie |
| `/api/auth/logout` | POST | Clear session cookie |
| `/api/auth/session` | GET | Safe status: `{ authenticated, project?, expiresAt? }` |

`login` enforces: same-origin (Origin/Referer vs host), `application/json` only,
zod-validated body, project-name normalization, rate limiting, and a **single
generic error** `Invalid project name or PIN.` for every credential failure
(never reveals which field was wrong). bcrypt comparison runs even on a wrong
project name so response timing does not distinguish the two.

## Rate limiting (best-effort)

`src/lib/auth/rate-limit.ts` — in-memory, per-process. 5 failed attempts per
15-minute window, keyed on client IP + normalized project name. **On
serverless/multi-instance hosting this is best-effort only** (per-instance
counters, reset on cold start). Replace with Redis/Upstash before treating it as
a hard control. It is not presented as more secure than it is.

## Environment variables

Generate the PIN hash:

```
npm run generate-pin-hash -- 2740
```

Set (uncommitted `.env.local` locally; host env settings in production):

- `PROJECT_NAME` — e.g. `upsrtc`
- `PROJECT_PIN_HASH` — the bcrypt hash from the script
- `SESSION_SECRET` — long random string, ≥32 chars (e.g. `openssl rand -base64 48`)
- `SITE_URL` — canonical origin

### ⚠️ Local `.env.local` and the `$` in bcrypt hashes

bcrypt hashes contain `$` separators. Next's env loader (`@next/env` →
dotenv-expand) treats `$` as **variable expansion** and will silently corrupt
the hash in a local `.env.local`. Escape every `$` as `\$` there:

```
PROJECT_PIN_HASH=\$2b\$12\$abcd...      # local .env.local — escaped
```

Host environment UIs (Vercel, etc.) store the value **literally** — paste the
hash **unescaped** there. The `generate-pin-hash` script prints a reminder to
stderr.

## Google Maps key (not a secret)

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is visible in browser JS **by design** — it is
not a secret and must not be described as one. Security for it comes from Google
Cloud restrictions, not obscurity:

- Restrict by HTTP referrer: `olympuss.us` (and `www.olympuss.us` if used).
- Restrict to the **Maps JavaScript API** only.
- Use a **separate** development key restricted to `localhost`.
- Set quotas and billing alerts.
- Do **not** reuse the TitanX production key — configure a fresh restricted key.

## API endpoint visibility

The endpoint paths (`/api/upsrtc/*`) remain visible in browser dev tools — that
is expected. Security comes from server-side session verification on every
request, not from hiding endpoint names. The upstream UPSRTC URLs and any
server-only configuration stay server-side and are never sent to the browser.
