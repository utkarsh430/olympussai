# C1 report: depot Cockpit and Roster (design wave)

Branch `worktree-agent-a5357d4969840db2c` (worktree `agent-a7129a44080f6d4cd`), fast-forwarded to `depot-int` (`ee17f09`) before any work. Not seen in a browser: I could not run the build, a server or the e2e suite.

## Evidence (final tree)

- `npx tsc --noEmit`: clean. `npm run lint`: no warnings or errors. `npx tailwindcss -i src/app/globals.css -o /dev/null`: compiles.
- `npm run test`: 3,534 passed, 0 failed; 32 test FILES fail to load, all with `Cannot find module 'server-only'`. Cause: `vitest.config` aliases `server-only` to `./node_modules/next/...`, and this worktree's `node_modules` is empty (packages resolve from the parent checkout), so the alias points at nothing. None of those files imports a file I touched (`src/lib/auth/server.ts`, `src/lib/depot/log.ts`, copilot service, routes and operating-day views). Run the suite in a checkout with its own `node_modules` to confirm.

## Cockpit (`/d/[id]`)

| Item | Status |
|---|---|
| 1 Attention strip as hero | Done. `lib/depot/cockpit/attention.ts` (tested), most pressing first, 6 lines at most: emergency flag (→ network exceptions `?kind=emergency`), main power off (→ roster `?flag=power_off`), departures overdue (→ the tracker `#depot-outshed`), dark "no signal for 6 h or more" (→ `?state=dark`), off the road (→ `?state=off_road`), not heard over 30 min (→ `?flag=not_heard`), tamper code (→ `?flag=tamper`). Calm line when none. |
| 2 Availability bar | Done. One stacked bar (colours from `BUS_STATE_SQUARE`, already validated), `role="img"` with the text equivalent, legend with word, count and share (one decimal). Standing split is one mono line; no yard: `StatePanel kind="not-established"` with the yard-rule sentence; held yard: "Yard held since HH:MM: this snapshot alone would not place it." The FEED STATUS line moved into the closing disclosure. On-road week trend (MODELLED) kept beside the on-road legend entry. |
| 3 Exceptions grouped, merged per bus | Done. `exceptionGroups.ts`: each bus once, under its most severe kind, all kinds as words; five per group; "Show all N" routes to the roster filtered (emergency → exceptions page). Depot exceptions windowed: "Rate over the last 20 minutes; N buses affected now." (not for `power_cut_cluster`). |
| 4 Visitors leave | Done. One line "N visiting buses in the yard · Open Yard". |
| 5 Outshedding max 5 rows | Done. Five rows, "Show all N departures" expands in place; the coverage sentences are unchanged. |
| 6 Briefing collapsed | Partly. One row with "Open briefing"; expands in place and keeps the written text when closed. **Not done: passing the feed time.** `BriefingCard` (copilot folder, not mine) takes only `scope` and `title` and renders `CopilotFooter` without `writtenFromFeedTime`/`currentFeedTime`. It needs a `currentFeedTime?: string \| null` prop passed to the footer (and the request's feed time captured as `writtenFromFeedTime`); then `BriefingRow` passes `data.feedNow`. |
| 7 Index line | Done. `indexLine.ts`: "Depot · 200 buses · Efficiency index 31.6 · rank 34 of 38 in Large fleets · over the last 20 minutes" (or "since 14:02, 3 snapshots" / "from the latest snapshot only"); unranked: the league's reason. No tag. |
| 8 Height, no Go-to row | No Go-to row. Height: see the walk-through. |
| 9 Not-operating / no buses | Done. No buses: `StatePanel` "No bus is homed…"; unknown id: `StatePanel` with the way back; loading: `StatePanel` placeholders; not operating: the index line carries "not ranked. Not an operating depot". |

Critique "Should": depot name above the H1 comes from the layout eyebrow (the old second title `DepotHeader` is deleted); index a mono line without tags (done). Capture report: defect 5 (briefing contradicts the page) is not mine to fix in the text; the page now names the index window, which is what the briefing must match. Defect 13 (height): addressed as below. Figures items 1 (yard flaps) and 5 (26 vs 33 power off): the cockpit now counts power off from `buses[].mainPowerOn` in one place for the attention line and the roster filter; the yard hold is shown when held. Defects 12 and 14 and figures item 2: the index window is printed; item 14 (`/d/999999` shell) is in the shell, not mine.

First screen at 1440, in order: depot name (eyebrow), "Depot cockpit", one sentence, `DERIVED Computed from the live feed at HH:MM.`, the attention strip (up to 6 × 40px), the index line, AVAILABILITY label with the bar, legend and standing line, the visitor line, then the OUTSHEDDING label. Estimated height for a 200-bus depot: about 1,800 to 1,900px (was 3,855 to 5,100). Above the 1,400 target because of the exceptions section: up to four groups of five rows (two columns from `xl`) plus depot lines. If 1,400 is firm, the next cut is two rows per group or the exceptions under a disclosure.

Visual checks: 1440 (attention numerals in `font-display` 24px aligned in a 56px column; bar segment gaps; legend wrap), 1024 and 800 (exception groups single column; outshed table inside its frame; index line wrap), 360 (attention text truncates with `title`; legend wraps; no sideways scroll). Check that `hidden` on the briefing body hides it (no display class on that div).

## Roster (`/d/[id]/roster`)

| Item | Status |
|---|---|
| 10 Filters on one row, in the URL | Done. State toggles (`aria-pressed`, square, short word, count), location `Select`, search, "Has a route" `Checkbox`, count on the right. `rosterQuery.ts` (tested) parses and writes `state`, `location`, `route=1`, `q` (64 chars max), `flag` (`power_off`, `not_heard`, `tamper`) and `bus`, dropping unknown values. An active flag shows as a pressed toggle that clears it. Search types into local state and the URL follows. |
| 11 Times, 36px rows | Done. `scheduleText`: "08:51" on the feed date, "Sun 04 Oct, 08:51" otherwise, full time in `title`. `fixedRows`; "On road" short with the full label in `title`; the delay moved to its own "Running" column, so no cell has two lines. |
| 12 State mark, one location wording, not heard | Done. `BusStateMark short`; `busLocationText` in the row and (through `drawerFacts.ts`) the drawer; "not heard 87 min" as a quiet word beside the state. |
| 13 Drawer tags | Done. No fact carries a tag: the page default is DERIVED and every fact is live or derived. Timetable untouched. Times formatted. |
| 14 Paging | Paged at 25 with the shared `Pager`: the list is the page's purpose (Rulings §3), and a pane would hide the shared footer and fight the drawer's scroll lock. First column frozen, overflow cue on. |

Critique "Should"/"Could": themed checkbox (done, shared `Checkbox`), merged location phrase (done), drawer tags (done). Capture report: ISO timestamps (fixed), "In service" bus with yesterday's schedule (the server's new state rule fixes the state; the roster now shows the date when the schedule is not on the feed date), row and drawer location contradiction (one function), the wrapping state label (fixed). Figures item 6 (54/87 vs 55/86, 40 s apart) is feed drift between polls; both pages show the feed time in the provenance line.

First screen at 1440: name, "Roster", one sentence, `DERIVED` line, the filter row (about 40px), the table header and about 18 rows. Height about 25 × 36 + 200 ≈ 1,100px (was over 7,000 for 200 rows). Visual checks: the filter row wrapping at 1024 and 800 (toggles, select, search, checkbox, count), the frozen registration column while scrolling sideways, the "more columns" cue, the pager, the drawer at 360.

## Tests rewritten, and why

- `depot-cockpit-render.test.tsx`: the no-bus case renders `AvailabilityBar` (the status board is gone); the tracker no longer takes `coverage` (its badge duplicated the page default). Added a page test with data (attention links, one visitor line, briefing collapsed, disclosure closed, "Show all 6", no-yard panel).
- `depot-trend-mounts.test.tsx`: the on-road week trend is asserted beside the on-road legend entry of `AvailabilityBar` instead of the status-board tile.
- `depot-briefing-mounts.test.tsx`: mocks follow the new components; it still asserts "Depot briefing" once and no request on mount.
- New: `depot-cockpit-wave.test.ts`, `depot-roster-query.test.ts`, two URL tests in `depot-roster-page-focus.test.tsx`. Nothing deleted.

## For the server or other owners

- `BriefingCard` needs a feed-time prop (above).
- The emergency flag is not on `DepotBusView`, so that attention line and its group go to the network exceptions page (`?kind=emergency`), which does not filter to the depot.
- `CockpitModel` still carries the old `exceptions` and `visitors` fields, kept because `depot-cockpit-model.test.ts` asserts them; no component reads them. Remove both with their tests in a follow-up.
- A "Show all N" group link opens the roster filtered by a state or flag, which can list more buses than the group (a dark bus whose most severe kind is emergency is in the roster's dark filter but in the emergency group).
- `AttentionStrip` splits the number from the sentence with a regex for the layout; a `phrase` field from the model would be cleaner.
