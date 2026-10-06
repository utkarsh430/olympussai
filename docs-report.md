# Documentation unit report — Depot Management

Branch `worktree-agent-a6f135e53aea9ed04`, fast-forwarded to `depot-int` (ee17f09) before any edit.
Only Markdown was changed, so `tsc` was not run. Every relative link I added was checked to
resolve to an existing file, and every anchor to an existing heading.

## Per document

- **docs/DEPOT_MANAGEMENT.md (new).** The full module reference: purpose and limits; the two
  scopes and all 18 page routes; the provenance model; the live data path and the server
  house rules; a table of all 18 API routes; repositories and the composition root, and
  which models are not yet behind a repository; in-process state; every inference and model
  with its constants and file names; the copilot in summary; a directory map; testing; and
  "What is real, what is modelled, what is needed", taken from the Data sources registry.
- **README.md.** Corrected the `/project/depots` row and added a `/api/upsrtc/depot/*` row
  (section intro table). Section 3: the five depot server variables, plus the e2e variables
  by name. Section 4: the layout tree (depot pages, depot API, `lib/depot`, `liveSnapshot`,
  hooks, scripts, docs). Section 9: the Depot Management button now leads to the network
  overview, and the module's Fleet distribution is distinguished from the demand view.
  Section 19: depot API guards, the copilot, and what is not enforced. Section 20: four depot
  performance decisions. Section 21: test file counts and e2e variables. Section 22:
  per-process depot state. Section 23: `calibrate-odometer`. Section 25: rules 8 and 9 (four
  words; declared once per page, S44). Section 27: three depot documents. No new numbered
  section was needed.
- **docs/LIVE_VS_PREDICTED.md.** Added a depot section: the four words, a table of what is
  LIVE, DERIVED, MODELLED or REFERENCE on each page, model parameters with files, what
  changes when a real feed replaces a model, and what the module never claims.
- **docs/ARCHITECTURE.md.** Added a depot section: the data-flow diagram, layers,
  feed clock, in-process state and its limits, the copilot provider seam, and the
  database phase as a next step that is not built.
- **docs/PRESENTATION_GUIDE.md.** Replaced the "shell" checklist line. Added an ordered
  depot walk-through with what to say about provenance on each page, and two Q&A entries.
- **docs/DEMO_SCRIPT.md.** Replaced the "shell" line in section 8. Added an unnumbered
  "Optional: Depot Management" segment before the Pitch Mode fallback, so the existing
  section numbers are unchanged.
- **docs/PRODUCTION_ROADMAP.md.** Added "Depot Management — road to production": the data
  to supply (including field meanings) and the platform work.
- **Design spec.** Appended "Amendments made during the build": one line per amending
  ruling (P0 1–2, S3, S5–S7, S9–S45 where they amend), grouped by area, plus one
  difference from the spec text that has no ruling.

## Statements I could not verify and left out

- Per-test counts. I state test *file* counts only (230 files under `src/tests`, 216 named
  `depot-*`). Section 21's existing per-file table is kept but marked "not re-counted".
  A static count disagrees with at least one figure there (`scenarios`: 31 matches against
  43 stated, likely because of loops).
- How many depots get a yard on real data (the ledger cites 95 of 119). Not in code.
- Where the what-if sandbox runs (in the browser or on the server).
- The copilot's default model name and its origin-check details. I link to
  `DEPOT_COPILOT_OPERATIONS.md` instead of restating them.
- Whether the e2e "34 results" statement in README section 21 still holds. The text was
  left as it was.

## Code that contradicts the ledger or the spec

1. **S40 loader is not in `depot-int`.** The commits for the user-initiated per-depot
   route-details loader (7c3a817, b807253, 60b4763, 574c251) are only on branch
   `worktree-agent-a8c4398748ff1aa2f`. In this build, `ProfileCoverage.tsx` says there is
   deliberately no control: a profile loads only when its route, a depot roster or a bus is
   opened. The documents say the loader is "not in this build".
2. **S42: no screen states the score window.** The `network`, `exceptions` and `[depotId]`
   responses carry `scoreWindow`, but no component reads it. The League table's description
   still says "One snapshot of the live feed", which is now wrong.
3. **S43: "held since HH:MM" is not rendered.** `Yard.heldSince` exists, but no page model
   uses it. The API's yard note uses different wording.
4. **S44: no page uses `provenanceLine` yet.** Only `PageHeader` accepts it; pages still tag
   sections and figures (28 `modelled`, 21 `derived`, 6 `live`). Two page titles contain
   "modelled": "Revenue and ridership (modelled)" and "Economics (modelled)". S44 forbids
   that on an all-modelled page. The design wave may be fixing this now.
5. **S46 is not in the code.** There is no 300 m merge in `infer/`. The documents describe
   the rule as coded and say nothing about S46. S46 is also left out of the spec
   amendments.
6. **The spec's Depot Efficiency Index components differ from the code**
   (`score/config.ts`), and I found no ruling for the change. This is recorded in the
   amendments.
7. **The spec names files that do not exist**, for example
   `scripts/build-depot-fixture.ts` and `src/hooks/useFleetDistribution.ts`. I left this
   alone because the spec text must not be rewritten.
8. **Stale general gaps.** The roadmap's "Known gaps" table still says "No authentication"
   and "No rate limiting on proxy routes". Both are now wrong for the whole app. They are
   outside the depot scope, so I left them.

## Promises in the documents that a later change could silently break

- Every constant quoted with its file. The ones most likely to be tuned are the yard
  constants, the 20-minute window, the efficiency index weights, the exception thresholds,
  `ROUTE_PROFILE_FETCH_LIMITS`, `REPLAN_MIN_INTERVAL_MS`, the model parameters in `sim/`, and
  the forecast settings. The yard sentence is quoted verbatim from `yardRuleText.ts` and
  changes if S46 lands.
- These counts: 18 page routes, 17 GET routes plus 1 POST, 230 and 216 test files, 60 s
  polling.
- These "not yet" statements, which become false when the design wave or the loader
  merges: pages are still moving onto `provenanceLine`, no page states the score window, no
  page renders `heldSince`, and the S40 loader is not in this build. The presentation guide
  tells the presenter to state the window aloud "because the page does not yet".
- The per-page provenance table in `LIVE_VS_PREDICTED.md` and the walk-throughs. They
  describe what each page rests on, not its layout, but they assume each page keeps its
  current domain.
- The e2e environment variable names (`E2E_PROJECT_PIN`, `E2E_PROJECT_NAME`, `E2E_HOST`,
  `E2E_PORT`, `E2E_ORIGIN`).
- That no depot view calls the upstream, and that only route-profile cache misses do.
