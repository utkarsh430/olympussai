# Economics and revenue pages, fix round 1

Branch `worktree-agent-aa71c5b5af50e1749`, fast-forwarded to `depot-int` first. Evidence: `npx tsc --noEmit` clean, `npm run lint` clean, `npx tailwindcss -i src/app/globals.css -o /dev/null` ok, `npx vitest run` 196 files / 3357 tests green. Not run (not permitted): build, server, browser suite.

## Items

1. Fuel cost per km. `economicsFormat.ts` label "Fuel cost per km" (grid column, breakdown row, explanations). `FUEL_ONLY_NOTE` in `economicsStatement.ts` printed under the grid in `EconomicsPage.tsx`. Test: `depot-economics-truthful.test.ts` ("the fuel-only cost column") and the scan "no wording reads as profit, loss or margin", which walks every string from rows, explanations, breakdowns, status lines, statements, notes, revenue tiles, route rows and hero bars. The required sentence itself contains "not profit", so the scan removes that exact sentence before checking.
2. Almost empty ranking. `rankingShortfallNotice` (built from `ECONOMICS_MIN_ROUTES` and `ECONOMICS_MIN_ROUTE_COVERAGE`, link text "Routes page" to `/project/depots/routes`), `defaultShowUnranked`, `emptyRowText`. Page shows the notice when fewer than half of operating depots are ranked, defaults Show unranked on when nothing is ranked (the checkbox follows the data until the reader chooses). Tests: truthful test file plus render tests.
3. No dash alone. Earnings cell reads "length not known" with "n of m routes" under it; a thin figure keeps the value and adds "too few routes with a known length (n of m routes)". Unranked rows show a short visible reason (`reasonShort`) under "not ranked". Breakdown value cell says the same. Revenue summary tile value is "length not known" with the coverage sentence.
4. Headers tagged: "Earnings per km (MODELLED)", "Fuel cost per km (MODELLED)", "Load factor (MODELLED)", "Economics index (MODELLED)" on the grid; breakdown columns Depot, Peer median, Z, Contribution; revenue table Trips, Boardings, Load factor, Revenue, Earnings per km; route length "Route length (DERIVED)". Tests in `depot-economics-render.test.tsx`.
5. Full MODELLED statement on the economics page: `ModelledStatement` now takes `preface` and `closing`; economics adds a short preface and a closing paragraph naming fuel issue records; the revenue builder supplies definitions (trip, leg, load factor, boarding, fare), planning assumptions, ticketing and route master, and the Data sources link. Render test checks it.
6. `aria-selected` removed from the economics grid rows (test asserts none, and `aria-pressed` on Score remains). Not touched: `LeagueGrid.tsx:156` has the same defect (league components are not mine).
7. Registry: trips note says out and back from the depot, two legs, one-way is half a trip; `seatCapacity` note says seat-kilometres offered per leg and occupied counted the same way. Test in `depot-registry.test.ts`. Nothing else in the registry changed.
8. `INDEX_LIMITS_NOTE` printed below the status line, exact wording from the brief.
9. Minors, all done:
   - No "better than peers" words or median for a small peer group. The index now returns `peerMedian: null` whenever the sample is under `MIN_PEER_GROUP` (this also covers thin or missing-component depots whose sample is small), and the page model hides the words. Tests in index and truthful files.
   - Route length header sorts by `lengthKm` (render test).
   - Show all: fixed label and `aria-expanded` on hero and route table (render tests).
   - Flat-fare bars say "(flat fare, length not known)".
   - "Least held back by" when the strongest contribution is at or below zero.
   - One rupees-per-kilometre formatter: `formatRupeesPerKm` in `revenuePageModel.ts`, used by `economicsFormat.ts`.
   - A filter that hides the selected depot is announced in the status line (render test).
   - Withheld sentence says a route is profiled when opened on the Routes page.
   - Economics view builds bus views with a new `depotBusViews(analysis, depotId)`. This needed a small extraction in `src/lib/depot/live/depotView.ts`, which is not on my list: `buildDepotDetail` now calls the same function, so the result is identical (the existing reconcile test against `buildDepotDetail` buses still passes). Tests added to `depot-economics-view.test.ts`: no rebuild on a second request over the same rows (source call counts unchanged), rebuild on a new operating date, rebuild on a new route-catalogue revision. Revenue view test gained the date case (revision case already existed).
10. Wording: depot-level load factor "occupied seats over seats offered, weighted by trips" in the tile note, the statement and `revenueConfig.ts` comment; the route-level definition is stated separately ("share of seats filled on a leg"). Coverage sentence "routes with kilometres run and a known length". Tests updated.
11. `ECONOMICS_Z_CLAMP = 3` in `revenueConfig.ts`; `economicsComponents.ts` uses it; `BREAKDOWN_NOTE` built from it (test).
12. Tests: pinned 72.5 index (and 27.5 for the worst depot) from the hand calculation; a three-group case where the medium group falls below five complete depots while small and large are ranked; depot load factor test with stated literals 0.8 (and mean-of-ratios 0.7 ruled out) in `depot-ridership.test.ts`.
13. Splits: `economicsPageModel.ts` is now a re-export of `economicsFormat.ts`, `economicsRows.ts`, `economicsExplain.ts`, `economicsStatement.ts`; `economicsIndex.ts` (134 lines) with `economicsComponents.ts`; grid cells in `EconomicsCells.tsx`. All exports still importable from the old paths. Largest file is `economicsRows.ts` at 208 lines.

## Needs a visual check (browser, 1440 / 1024 / 800)
- Economics grid: the "not ranked" cell now wraps a short reason inside the frozen 10rem index column, and earnings cells carry a second line; check row heights and that the sticky columns still align.
- Longer header labels ("Earnings per km (MODELLED)") widen the grid; it must scroll only inside its frame.
- Statement, fuel-only note and shortfall notice placement and readability; dark theme contrast.
- Breakdown header tags inside the 26rem panel at `xl`.

## Concerns
- `depotView.ts` was edited outside the ownership list (extraction only).
- League grid `aria-selected` left as is.
- The economics response still carries no model parameters; the page imports `REVENUE_MODEL_PARAMS` from `revenueConfig.ts` directly for the statement, which matches the server's constants because both read the same module.
