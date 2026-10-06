# C5b report: Exceptions, Data sources, Ask, Trends (network and depot)

Commits (on top of `depot-int`): 82020d1 exceptions, 9af8743 sources, 220a097 ask, 6c7300a trends.

## Exceptions

| Item | Status |
|---|---|
| 1 Anatomy, derived provenance line | Done: `provenanceLine={{ default: 'derived' }}`, one-sentence header. |
| 1 Kind tiles as ONE band of toggles, URL | Done: eight `aria-pressed` buttons on a hairline grid (no nested boxes), "DEPOTS"/"BUSES" kicker per tile. Pressing writes `?kind=` with `history.pushState` (`kindSearch` in `pageModel.ts`), a second press clears it, `popstate` re-reads it. |
| 2 Two numbers that look contradictory | Done: group headings stay "Critical (4 depots)" / "Warning (58 depots)"; one line above the list says "66 exceptions in 62 depots: a depot is listed once, under its worst level" (`depotScopeLine`; absent when every depot has one). The totals line still names its scope. |
| 2 Window vs as-of | Done: SectionLabel note "Rates are compared with peers over the last 20 minutes; bus counts are as of 14:20." (`depotWindowNote`, from `scoreWindow` and `feedNow`; "since HH:MM, N snapshots" or "in the latest snapshot only" otherwise). |
| 3 Critical list design | Kept (rows, severity word, links, open critical group, 25 + "Show all N"). |
| 3 Bus table | Shared options (`fixedRows`, `freezeFirstColumn`, `overflowCue`), shared `Pager` (server paged, 25), times formatted (`HH:MM`, full date-time in `title`), the Detail sentence column removed (the sentence is the registration cell's `title`); constant Kind column dropped while a kind filter is on; Tamper code column only when a row has a code. Depot filter is the shared `Select`; section is under `SectionLabel` with the true total. |
| Disclosure | Closed "How these figures are produced" added (thresholds, window, paging, no person). |

Tests rewritten: `depot-exception-centre-render.test.tsx` "moves focus ... on the last page": the focus now lands on the shared pager's own status line (the shared pager owns that rescue). New: `depot-exception-page-wording.test.ts`, a URL test in the centre render test.

## Data sources

Done: reference provenance line; coverage under a SectionLabel tagged DERIVED (the one differing section), records sentence kept, the "A bar shows..." paragraph moved to the closed disclosure with the Complete/Partial/Sparse rule; feeds as one `DataTable` (Feed, Status word, Fields, What it provides; first column frozen; truncation carries full text in `title`); each feed's field list in a native `<details>` that also holds the status, summary and "Unlocks" sentence; coverage rows keep the one grid with the word column. Nothing clipped (field tables use `!max-h-none`).

Anchors for other pages' "replaced when <feed> is connected" links: `/project/depots/sources#feed-<id>`, which scrolls to and opens that feed's section (hash read on load and on `hashchange`). Ids: `feed-gps-device`, `feed-route-details`, `feed-depot-master`, `feed-fleet-master`, `feed-network-timetable`, `feed-crew-duties`, `feed-maintenance`, `feed-fuel`, `feed-ticketing-ridership`, `feed-history-store`. Helper: `feedAnchor(id)` in `src/lib/depot/sources/sourcesModel.ts`. The shared `ProvenanceLine` still links to `/sources` without a hash (its component is not mine); the pages could append the anchor if they wish.

`ProducedDisclosure` (new, `src/components/depot/sources/ProducedDisclosure.tsx`) is the closed "How these figures are produced" details, used by my pages; other agents may reuse it.

## Ask

Done: one column at `max-w-[62ch]`; header sentence merged ("Ask about the network or one depot; questions about staff are not answered."), the two intro paragraphs moved to the disclosure; shared `Select` for scope; form, then directly beneath it the answers (or, when none, "Try asking" with the suggestions as a vertical list of text rows); "Understood as:" is a muted mono line directly under the question; the answer ends with the shared `CopilotFooter` (untouched); the evidence table's caption is `sr-only` (the heading is not repeated); an answers section label with a count and the session note shown once after the first answer; suggestions stay available under the answers. A refusal renders as an ordinary calm answer (same card, no alert). Safety: server text still only as text (test added), writer named by the footer, nothing requested on mount, limit always visible ("212 of 300 characters left" / "N over the 300 character limit"), countdown still outside the live region (existing cooldown test green). Answer cards lost their boxed panel: a hairline above each.

Not done (Could): none outstanding from the critique's Ask entry.

## Trends (two pages)

| Item | Status |
|---|---|
| 7 Anatomy, provenance line | Done, with a wording gap: `{ default: 'modelled', replacedBy: 'a database of real history' }` renders "Generated from planning assumptions, not measured. Replaced when a database of real history is connected." (the shared function's fixed formula), not the exact sentence in the brief. The history note moved to the disclosure. |
| 7 No other MODELLED tag | Done: removed from the section label, table headers, table caption, trend sentences and the "No trend" sentences (my page model). Remaining: the chart's own legend/title (shared chart) and the sparkline `aria-label`, which carries the server's sentence with its tag (not visible). |
| 7 Chooser | Real links with `aria-current` kept; the pressed link keeps focus (row stays mounted); a polite `sr-only` status announces "Showing <measure>" after the first change only. |
| 8 Unit table | Shared options (fixed rows, frozen first column, overflow cue), sparkline column, one batch request, sortable by both changes (default worst four-week first), shared `Pager` at 25 (replaced "Show all N"). |
| 8 One-week direction word | Done, no endpoint change needed. `summariseTrend` takes `SeriesPoint[]`; a batch row has `values` and `endDate`, so `weekDirection` (`trendsTableModel.ts`) rebuilds the dated series and reads `summary.week.direction`, the same dead band as the four-week word. The word is printed only if the recomputed week change equals the batch's `trend.week`; otherwise the signed change alone shows (so a word never contradicts the figure). Cells read "up 0.4", "steady, +0.1", "down 1.2". |
| 9 Availability | One three-figure band (Requirement, Forecast range, Days below) and one sentence (`BOTH_MODELLED_NOTE`). The longer comparison sentence is the band's `title` because it carries its own "MODELLED:" tag; the response's `ok` branch does not expose peak and spare, so they are not printed as a caption. If they should be visible, `compareAvailability` needs to return `peakRequirement` and `spareTarget`. |
| 10 States | Through `StatePanel`: too little history or a gap with its date (`noTrendSentence`, kind not-established, under the chart), unit-table no-data, loading (`LoadingBlock`), error (`ErrorPanel`), availability not established. |

Tests rewritten and why (rulings remove the page-level tags): `depot-trends-page-model.test.ts` (trend and "No trend" sentences lose the "MODELLED" prefix; the chart-line dedupe now compares without the tag), `depot-trends-table-model.test.ts` (headers and caption lose the tag), `depot-trends-render.test.tsx` (history sentence once, in the disclosure; no "Every unit, MODELLED"; the pager replaces "Show all N"; the availability heading loses its tag, its sentence is in the band's title). New: `depot-trends-week-direction.test.ts`, `depot-sources-anchors.test.ts`, `depot-ask-view-wording.test.ts`, `depot-ask-answer-layout.test.tsx`.

## First screen at 1440, in order

- Exceptions: header + one sentence; DERIVED line with feed time; one band of eight kind tiles; totals sentence; "DEPOT EXCEPTIONS · 66" with the window note; the scope line; critical group open. Height about 20 to 30% shorter than before (no nested tile boxes, no tag column).
- Data sources: header; REFERENCE line; "FEED COVERAGE" with DERIVED tag, records sentence, coverage grid (about 25 rows, so the feeds table is below the first screen); feeds table; ten closed field-list rows; closed disclosure. Roughly 1,400 to 1,600px against about 2,000.
- Ask: header; DERIVED line; About select; question box and limit line; Submit and status; "TRY ASKING" with four text rows (an answer, once asked, sits in that spot with its footer). Page about 650px empty, shorter than before.
- Trends (network): header; MODELLED line; measure link row; the chart with its own title, legend and sentences; "EVERY UNIT · N" table (25 rows, pager); closed disclosure. Depot: same chart, then the figure band and one sentence.

## Needs a visual check

1440: tile band (eight columns, label truncation, selected-tile top rule), window note wrapping beside the SectionLabel, sources feeds table width, trends table sparkline cell at 36px rows. 1024 and 800: tile band at four columns, feeds table freeze and "more columns" cue, ask column and select width, trends table scroll. 360: tile band at two columns, ask answer wrapping of the mono "Understood as" line, measure links row. Also try `/sources#feed-fuel` (opens and scrolls) and press a kind tile then Back.

## Data the server would need

None required. Optional: the batch trends response could carry `weekDirection` per row (avoids recomputing); `compareAvailability` could return peak and spare.

## Evidence

`npx tsc --noEmit` clean; `npm run lint` clean; `npx tailwindcss` builds. `npm run test`: 3527 tests passed; 32 test files cannot load in this worktree because the `server-only` package does not resolve (all server-side route and gate tests, including `depot-exception-view`, `depot-trends-view`, `depot-copilot-route*`), not affected by this work. My four areas' own test files all pass.
