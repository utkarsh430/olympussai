# Olympuss AI — Deployment

Target: **https://olympuss.us** on Vercel, from this repository's own new GitHub
remote (never the original prototype remote).

## 1. Prerequisites

- A new, empty GitHub repository for Olympuss (do not reuse the original prototype repository).
- A Vercel project linked to that repo.
- Node 18.18+ (Next 15). Package manager: **pnpm** (commit `pnpm-lock.yaml`; version pinned via `packageManager` in `package.json`).

## 2. Environment variables

Set these in the Vercel project (Production + Preview). Never commit real values.

| Variable | Notes |
| --- | --- |
| `PROJECT_NAME` | `upsrtc` |
| `PROJECT_PIN_HASH` | Output of `pnpm run generate-pin-hash -- <pin>`. **Paste unescaped** in Vercel (host UIs store literally). Only local `.env.local` needs `$` escaped as `\$`. |
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

- Build command: `pnpm run build` (default). Output: Next.js (Vercel auto-detects).
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

## 8. Future: `project.olympuss.us`

The protected area is already isolated under `/project/upsrtc` with its own
layout, auth guard, and API namespace. Moving it to a `project.` subdomain later
is a routing/deploy change, not a rewrite: the auth utilities, session cookie
(scope the cookie domain to `.olympuss.us` if sharing across subdomains), and API
protection carry over unchanged.
