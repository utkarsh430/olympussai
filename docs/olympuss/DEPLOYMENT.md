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

The depot routes keep two pieces of state between feed snapshots, both
in-memory / per-instance: the rolling score window (the efficiency index, ranks
and peer-comparison exceptions are summed over the last 20 minutes of feed
time) and the yard memory (an established yard is held while its buses still
stand in it). With several instances or cold starts each has its own, so the
same feed can give different figures from one request to the next: a 1-sample
index on one instance and a 20-minute one on another, or a held yard on one and
no yard on another. The responses say so (`scoreWindow.samples` and
`coveredMin`, `yard.heldSince`), but they do not agree across instances.
The modelled requirement reads the on-road share over that same score window,
so the modelled operating day (duties, crew, fuel, revenue, economics) and the
fleet-distribution plan built on it can also differ between instances.
For stable depot figures, serve the depot routes from one long-lived Node
process (`next start`) until this state is shared (e.g. Redis/Upstash).

## 9. Future: `project.olympuss.us`

The protected area is already isolated under `/project/upsrtc` with its own
layout, auth guard, and API namespace. Moving it to a `project.` subdomain later
is a routing/deploy change, not a rewrite: the auth utilities, session cookie
(scope the cookie domain to `.olympuss.us` if sharing across subdomains), and API
protection carry over unchanged.
