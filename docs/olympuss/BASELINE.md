# Olympuss Migration — Pre-Migration Baseline

Recorded before any Olympuss changes, on branch `feature/olympuss-v1`, from the
clean source snapshot (`dfc5de6`) of the UPSRTC AI Copilot ("TitanX") app.

This file separates **pre-existing** state from anything the migration
introduces, so regressions are unambiguous.

## Stack (unchanged base)

- Next.js 15.5.20 (App Router)
- React 19.2.7 / React DOM 19.2.7
- TypeScript 5.9.3 (strict, `noUncheckedIndexedAccess`)
- Tailwind CSS 3.4.19
- Package manager: **npm** (`package-lock.json`)

## Routes at baseline

| Route | Kind |
| --- | --- |
| `/` | static — renders `<CommandCenter />` (the whole dashboard) |
| `/api/upsrtc/live` | dynamic route handler (server proxy, 15s cache) |
| `/api/upsrtc/schedule` | dynamic route handler (server proxy, 120s cache) |

No middleware. No auth. Single-page dashboard (UI state, not nested URLs).

## Verification results (green baseline)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | PASS (no errors) |
| Lint | `npm run lint` | PASS (0 warnings/errors) |
| Unit tests | `npm run test` | PASS — 124/124 (4 files) |
| Production build | `npm run build` | PASS — 4 routes generated |

## Pre-existing, NOT migration-caused (do not attribute to Olympuss work)

- `npm audit`: 3 advisories — `postcss <8.5.10` (moderate), `sharp <0.35.0`
  (high, libvips CVEs). Both transitive. Not force-fixed at baseline to avoid
  breaking changes; `sharp` will be added explicitly at a current version for
  logo processing.
- `next lint` prints a deprecation notice (removal in Next 16). Not an error.
- `recharts@2.15.0` and `whatwg-encoding@3.1.1` print deprecation warnings on
  install. Not errors.

## Rollback

- Tag/branch in the ORIGINAL TitanX repo is untouched and out of scope here.
- In THIS repo: base commit `dfc5de6`; `git reset --hard dfc5de6` returns to the
  clean snapshot. `main` branch holds the untouched snapshot.
