# C3b: Fuel and cost, Revenue, Economics

Branch `worktree-agent-a38578f7cdee50a74`, final commit `14cb2b9` (two commits: `9eb64de` feat, `14cb2b9` tests and format).

## Evidence
- `npx tsc --noEmit`: 0 errors. `npm run lint`: clean. `npx tailwindcss -i src/app/globals.css -o /dev/null`: compiles.
- `npm run test`: 3,516 tests passed, 0 failed, but 32 suites fail to load ("Cannot find module 'server-only'": this worktree's `node_modules` is a stub and `next/dist/compiled/server-only/empty.js` is missing). None is a file I touched; three of them (`depot-economics-view`, `depot-fuel-view`, `depot-revenue-view`, plus `depot-operating-day-views`) test server views that I did not change. They could not be run here, so they are not verified.
- Not run: build, server, browser.

## Per page: Musts
Fuel (3, 4, 5, 1, 2): done. Band of five on `FigureBand` ("Buses ran 158 of 200 / 42 did not run" first; distance; fuel; cost with cost per km; km per litre with the planning price). "Buses that stand out" is directly under the band: `+18.8%` variance, a "Basis" column (route peers / class in depot), peers' median, the rule once in the section note (short form), the not-compared and peers-differ counts as one line under the table, route column dropped when most rows have none, dash for no route. Class figures are a four-row table with an inline bar from a floor (half the lowest rate; the section note says "Bars start at 1.8 km per litre, not zero"). By-route table keeps the "Other routes (N)" row. Buses that did not run are a count in the band, never rows.
Revenue (6, 1, 2): done. Band of five, then one table by route with an inline revenue bar, paged at 25, rupees right-aligned through `formatRupees`; the chart panel is gone; coverage is one line in the section note ("Lengths: 3 of 14 routes from real route profiles, the rest modelled"). A real-profile length carries a DERIVED badge in its cell; modelled lengths are plain.
Economics (7, 8, 9, 1): done. Ranked table is the hero: fixed 36px rows, overflow cue, Rank, Depot and Economics index frozen together (the shared `DataTable` freezes only the first column, so the page keeps its own sticky grid on the `depot-table-fixed` class). "Fuel cost per km", the not-profit sentence and the index-driven-by-assumptions sentence are visible above the table, as is the separate-from-efficiency sentence. Status line replaced by up to three figure-and-reason rows. A `StatePanel` (not-ranked) states why and what would change it when fewer than half are ranked, and the unranked list shows beneath (default for none ranked); an empty filter result is a `StatePanel`, never an empty table. Breakdown beside the table only at `2xl`, below otherwise, sticky offset `2xl:top-[var(--depot-panel-top)]`; its heading has `scroll-mt-[var(--depot-anchor-mt)]`.
All three: one provenance line (fuel issue records and odometer readings / a ticketing feed and a route master / all four feeds), no other MODELLED tag, no closing statement panel; the closing statements are in a closed `HowProduced` disclosure ("How these figures are produced") with the Data sources link. Fuel and revenue keep the modelled-day sentence as one muted line under the provenance line.

## Should and Could
Done: themed checkbox (economics); class table with bars from a floor; "No route" dash; headers without tags; tiles into the band; the revenue columns are not hidden but earnings per km show a dash with the reason in the cell's title. Not done: search field moved into the section row's right-hand controls; merging the economics intro sentences into one (three sentences are required to stay visible); unit headers on fuel tables (cells still carry units); a link to the Routes page inside the disclosure paragraph (it is plain text now).

## Critique items that no longer apply (F1 changed the pages)
Economics "empty table, 118 have no route with a known length": depots are ranked on every operating depot subject to the peer-group guard, so the empty-table fix remains as a guard for the peer-group case only. Revenue "length not known" in every cell and "earnings per km hidden until a length is known": every route has a modelled typical or a real length, earnings per km are given for every route. Fuel "No route 186 of 200": only buses that ran appear, and the not-run buses are a count.

## Tests rewritten
- `depot-economics-render.test.tsx` rewritten as a whole (same fixtures): the "tags the ranking MODELLED" test now pins the opposite (no `data-provenance`, no MODELLED or "(modelled)" outside the disclosure); "tags every modelled column header" now pins untagged headers with Rank, Depot, Economics index first and fixed rows; the statement test now looks inside the closed disclosure and pins the visible not-profit and index-limits sentences; the sparse-ranking test pins the state panel; "Nothing is ranked yet" is now a state panel with no table body; the revenue tests (summary tiles, hero Show all, route-table Show all, header tags and per-cell lengths) became band, disclosure, pager at 25 with inline bars, and DERIVED-only tests. Reason: the rulings change what the page shows.
- `depot-economics-page-model.test.ts`: three `economicsStatusLine` expectations lose "(MODELLED)", and the separation sentence says "modelled" in lower case (the visible sentence must carry no tag).
- `depot-economics-truthful.test.ts`: the length-coverage line says "modelled typical length" in lower case (same reason).
- New: `depot-fuel-revenue-page-design.test.tsx` (band, variance, basis, rule note, footer line, route dash, floor bars, disclosure keeps the price and the replacing feeds, the forbidden-word check over every new string, fuel and revenue page renders, no stray tags, closed disclosure).
The existing forbidden-word test in `depot-fuel-page-model.test.ts` is unchanged and passes.

## First screen at 1440 (not seen; read from the code)
Fuel: header, provenance line, modelled-day sentence, five-figure band, "Buses that stand out" label with its rule note, the table (up to the server's cap of rows), then class table and routes below. Revenue: header, provenance line, modelled-day sentence, five-figure band, "By route" table with coverage note; a short page, disclosure closed. Economics: header, provenance line, up to three status rows, three muted sentences, then (if thin) the state panel, the section label with search and "Show unranked", then the table.

## Needs a visual check (1440, 1024, 800, 360)
Frozen Rank/Depot/Index offsets under `depot-table-fixed` (the 18rem td cap against the frozen widths); the 36px rows with the inline bars; the band captions truncating at 800 and 360; the muted line's `-mt-3` against the provenance line; the economics status rows; the breakdown dropping below the table under 1536px; the Score button in the Depot cell.

## Data the server would need
None. Note for the controller: `DataTable` freezes only the first column; a `freezeColumns` option would let economics and the league share it.
