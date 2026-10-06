# Olympuss AI — Deployment

Target: **https://olympuss.us** on Vercel, from this repository's own new GitHub
remote (never the original prototype remote).

## 1. Prerequisites

- A new, empty GitHub repository for Olympuss (do not reuse the original prototype repository).
- A Vercel project linked to that repo.
- Node 18.18+ (Next 15). Package manager: **npm** (commit `package-lock.json`).

## 2. Environment variables

Set these in the Vercel project (Production + Preview). Never commit real values.

| Variable | Notes |
| --- | --- |
| `PROJECT_NAME` | `upsrtc` |
| `PROJECT_PIN_HASH` | Output of `npm run generate-pin-hash -- <pin>`. **Paste unescaped** in Vercel (host UIs store literally). Only local `.env.local` needs `$` escaped as `\$`. |
| `SESSION_SECRET` | Long random string ≥32 chars (`openssl rand -base64 48`). |
| `SITE_URL` | `https://olympuss.us` |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Public browser key (see restrictions below). Not a secret. |
| `UPSRTC_LIVE_URL` / `UPSRTC_SCHEDULE_URL` | Optional — defaults built into the code. |
| `NEXT_PUBLIC_DEMO_MODE` | `0` (set `1` to force offline fixtures). |

## 3. Google Maps key restrictions (production)

Configure a **separate, restricted** key — do not reuse the original prototype key:

- Application restriction: **HTTP referrers** → `https://olympuss.us/*` (and
  `https://www.olympuss.us/*` if used). Use a separate key restricted to
  `http://localhost:*` for development.
- API restriction: **Maps JavaScript API** only.
- Set quotas and billing alerts.

## 4. Build & output

- Build command: `npm run build` (default). Output: Next.js (Vercel auto-detects).
- `next start` / Vercel serverless functions serve the dynamic routes and
  middleware. No custom server needed.

## 5. Security headers

Sent from `next.config.ts` in production: CSP (`frame-ancestors 'none'`),
HSTS, `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Permissions-Policy`, `Cross-Origin-Opener-Policy`. The CSP allowlists the Google
Maps origins for the dashboard and currently permits inline/eval scripts — tighten
to per-request nonces when practical.

## 6. Post-deploy checks

- `/` renders the landing (WebGL on capable devices, static fallback otherwise).
- `/project/upsrtc` redirects to `/login` when logged out; loads after login.
- `/api/upsrtc/live` returns 401 when logged out.
- `/robots.txt` disallows `/login`, `/project/`, `/api/`; `/sitemap.xml` lists `/`.
- OG image resolves at `/brand/olympuss-og-image.jpg`.

## 7. Rate limiting note

The failed-login limiter is in-memory / per-instance — best-effort on serverless.
For a hard control, back it with Redis/Upstash. See [`AUTH.md`](./AUTH.md).

## 8. Depot module state note

Several parts of the app keep state in the memory of the server process. All of it is
per instance and none of it survives a restart: it assumes one long-lived Node process.
On Vercel serverless functions (section 4) every instance has its own copy, a cold start
begins empty, and a request may land on any instance. What each piece holds, and what
differs between instances or after a restart:

- **The live snapshot** (`src/lib/upsrtc/liveSnapshot.ts`): the short-lived snapshot
  cache, the last good copy of the feed, the back-off after a failed refresh, the count of
  short replies, and which of live, last-good or the saved sample is being served (each
  change of it is logged once per instance). Each instance polls the corporation's feed on
  its own, so the upstream load grows with the number of instances. A fresh instance
  during an outage has no last good copy and serves the saved sample (`FIXTURE`) while a
  warm one serves its last good data. The depot pages refresh in the background while
  their data is still young; a serverless platform may freeze an instance before that
  refresh finishes, so the next request on it waits instead.
- **The score window and the yard memory.** The efficiency index, ranks and
  peer-comparison exceptions are summed over a rolling window of feed time, and an
  established yard is held while its buses still stand in it. Each instance has its own,
  so the same feed can give a 1-sample index on one instance and a full-window one on
  another, or a held yard on one and no yard on another. The responses say so
  (`scoreWindow.samples` and `coveredMin`, `yard.heldSince`), but they do not agree across
  instances. The modelled requirement reads the on-road share over that same window, so
  the modelled operating day (duties, crew, fuel, revenue, economics) and the
  fleet-distribution plan built on it can also differ between instances.
- **The view memos.** Response bodies are memoised on the snapshot and, for pages that
  take query parameters, on those parameters, in maps bounded in size (oldest out). They
  change cost, not figures: each cold instance pays again for the analysis, the modelled
  day and the plan on its first request.
- **The route-details cache.** Route profiles fetched with the routes page's Load action,
  and the answers that found nothing, are kept in bounded, time-limited maps, with the
  lookups in progress. A route profiled on one instance reads "not profiled" on another,
  so the loader's promise that the plan will include new profiles shortly holds only when
  the next request reaches the same instance; a user who presses Load again spends more
  lookups. The schedule cache behind those lookups (and behind the command centre's
  schedule route) is per instance too.
- **The route-lookup limiter.** It counts lookups per user, per address and per process.
  Every count is per instance, so the stated ceiling on calls to the corporation's
  schedule server is a ceiling per instance: with several instances the real ceiling is
  that figure times the number of instances, and a restart starts every count again.
- **The allocation plan.** The fleet-distribution plan is held for a span of feed time
  rather than re-planned on every snapshot, and the response gives the feed time it was
  planned at. Each instance holds its own plan, so two instances can show plans made at
  different feed times.
- **The copilot.** Its request limiters (per user, per address, per process), its answer
  cache and its joining of identical requests in progress are per instance: the process
  ceiling is per instance, and an answer cached on one instance is worked out again on
  another.
- **The failed-login limiter** (section 7).

After a restart, all of the above is empty: the score window starts at one sample, no
yard is held, there is no last good copy (an outage at that moment shows the saved
sample), every route reads "not profiled" until it is loaded again, the plan is made
afresh, and every limiter's allowance is full again.

For stable depot figures and for the upstream limits as stated, serve the app from one
long-lived Node process (`next start`) until this state is shared (for example in
Redis/Upstash).

## 9. Future: `project.olympuss.us`

The protected area is already isolated under `/project/upsrtc` with its own
layout, auth guard, and API namespace. Moving it to a `project.` subdomain later
is a routing/deploy change, not a rewrite: the auth utilities, session cookie
(scope the cookie domain to `.olympuss.us` if sharing across subdomains), and API
protection carry over unchanged.
