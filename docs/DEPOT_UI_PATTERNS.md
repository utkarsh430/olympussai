# Depot UI patterns

The shared pieces every depot page uses. Each is built once in `src/components/depot/shell/`
(the copilot footer in `src/components/depot/copilot/`); a page applies them and never
rebuilds them, so every page reads and measures the same. Page order, top to bottom: `PageHeader`
(with its provenance line), the one hero, supporting sections under `SectionLabel`s, and one
closed disclosure at the end, "How these figures are produced".

## What not to do

- No sentence in the mono face. Every `<p>` carries `depot-prose`, `depot-note`, `depot-caption`,
  `font-sans` or `sr-only` (a source-scan test enforces it; see "Prose and notes").
- No context sentence between the header and the hero: the modelled-day sentence goes in the
  provenance line (`modelledDay`); explanations go in the closing disclosure.
- No boxed explanation paragraph: a `StatePanel` is one sentence, one muted line, one action,
  with a "How … ›" link to the closing disclosure for the rule.
- No "Showing 1-25 of N" sentence: the `Pager` under the table is the only count. No top-right
  "Page 1 of 51" pager, no boxed "SHOW ALL 82", no cyan "Show all" link: use `Pager` and
  `ShowAllButton`.
- One disclosure glyph: the muted chevron (`DisclosureChevron`). No "+", "▶" or cyan link.
- One severity treatment: `SeverityMark`. No boxed badge, no plain coloured word, no
  lowercase "critical or warning" phrase.
- Tags in two places only: a `SectionLabel`'s `tag` or a `DataTable` column's `tag`. Never
  "(MODELLED)" in header text, never a "· modelled" suffix, never a tag in a cell, never a
  tag on a band label, except a generated figure in a band on a MIXED or DERIVED page
  (`Figure`'s `tag`).
- Units and words in the header (`unit`), bare numbers in cells; a repeated column becomes
  group rows (`group`); a constant column is removed.
- Bands of two to four figures never stretch; band figures are 24px (20px under 640px, so a value is never cut).
- Filters: one `FilterRow` (inline labels, 32px controls), never a stacked label.
- No hand-picked margins between sections: put the sections in one `depot-stack`.

## Prose and notes

The shell's inherited face is mono (right for data). Sentences use one of these classes:
`depot-prose` (sans 14/20, body sentences), `depot-note` (sans 13/18, muted: notes, section
notes, state-panel second lines, legends), `depot-caption` (sans 12/16, muted: a band caption).

```tsx
<p className="depot-note">Ranked within peer groups of similar fleet size.</p>
```

`src/tests/unit/depot-prose-face.test.ts` scans every `<p>` under `src/components/depot/**`.
Its `EXEMPT` list is a ratchet: a page agent removes its files as it converts them; the test
fails if a listed file no longer needs to be there. The list must end empty.

## Vertical rhythm and depot-stack

Held by the pieces: header label 11/16, 4px, title 20/28, 8px, prose 14/20, 8px,
provenance 12/20, then 24px to the hero. A section: 40px above its hairline (28px under 640px),
16px to the label, 12px to the content. Band 88px. Table header 32px, rows 36px.

`depot-stack` is the one spacing utility between sections: each direct child is one section
(a `<section>` holding its label and content) and sits 40px (28px on a phone) below the one
before; a child's own bottom margin is dropped, and so is the margin of a `FigureBand` that ends
a wrapped child (`<div><FigureBand/></div>`). The closing disclosure is the stack's last child.

Do not space sections with `flex flex-col gap-N` or `space-y-N`: a band keeps its own 24px
margin outside a stack, so `gap-6` plus the band gives 48px, and a band followed by a section
with no stack gives 24px; pages spaced by hand ended up anywhere from 23 to 62px apart. The
rhythm is one number, the standard on every page: 40px from a band's (or section's) bottom
rule to the next section's rule, 16px from that rule to the label, 12px from the label to the
content. The rule under a figure band followed by the next section's rule is that rhythm, not
a defect.

```tsx
<div className="depot-stack">
  <FigureBand label="Fleet figures">…</FigureBand>
  <section aria-labelledby="exc"><SectionLabel id="exc" label="Exceptions" />…</section>
  <HowProduced id="how-produced" paragraphs={HOW} />
</div>
```

The shell's `<main>` ends with 40px of padding, so the disclosure sits 40px above the footer,
not 32px (the main padding belongs to the shell, not to the page).

## PageHeader

`title`, `description` (ONE sentence, about 80 characters), `eyebrow?`, `controls?`,
`provenanceLine?: ProvenanceDescription`. Earlier props still work: `provenance?` (tag plus the
old per-tag note) and `children` (placed where `controls` go). On a depot page the depot's name
appears above the title automatically; pass `eyebrow` only to override it. The title is the
page's only `h1`.

```tsx
<PageHeader
  title="Crew"
  description="Availability and rostering only. No individual is assessed."
  provenanceLine={{ default: 'modelled', replacedBy: 'a crew roster and leave feed' }}
  controls={<Select label="Shift" hideLabel value={shift} onChange={onShift}>…</Select>}
/>
```

Rule: nothing sits between the header and the hero.

## Provenance line

`provenanceLine` on `PageHeader` (component `ProvenanceLine`, pure `provenanceLine()` in
`src/lib/depot/provenanceLine.ts`). Sans 12/20; the tag is a pill. Descriptions and what they
render with a fresh feed:

| Description | Renders |
|---|---|
| `{ default: 'modelled', replacedBy: 'a crew roster and leave feed' }` | `MODELLED` Generated from planning assumptions, not measured. Replaced when a crew roster and leave feed is connected. Data sources |
| `{ default: 'modelled', replacedBy: 'fuel issue records', feedId: 'fuel' }` | as above; the Data sources link opens `/project/depots/sources#feed-fuel` |
| `{ default: 'mixed', live: 'Bus states', modelled: 'duties and bays' }` | `MIXED` Bus states are LIVE; duties and bays are MODELLED. |
| `{ default: 'mixed', live: 'Routes and buses', derived: 'stops', modelled: 'trips' }` | `MIXED` Routes and buses are LIVE; stops are DERIVED; trips are MODELLED. (an empty part is left out) |
| `{ default: 'derived', indexWindow: true }` | `DERIVED` Computed from the live feed at 08:51. Efficiency index over the last 20 minutes. |
| `{ default: 'derived', second: 'One short sentence.' }` | `DERIVED` Computed from the live feed at 08:51. One short sentence. |
| `{ default: 'derived' }` | `DERIVED` Computed from the live feed at 08:51. |
| `{ default: 'live' }` | `LIVE` Live from the feed at 08:51. |
| `{ default: 'reference' }` | `REFERENCE` Reference data, curated; not from the feed. |

Modelled day: a page that rests on the modelled operating day passes `modelledDay`, worded by
`modelledDaySentence({ date, duties, routes, scheduled, fleet })`; the line places it after the
formula and before the link. Nothing else sits above the hero.

```tsx
provenanceLine={{ default: 'mixed', live: 'Bus states', modelled: 'duties',
  modelledDay: modelledDaySentence({ date: 'Mon 05 Oct', duties: 163, routes: 4, scheduled: 5, fleet: 200 }) }}
// MIXED Bus states are LIVE; duties are MODELLED. Built on the modelled day for Mon 05 Oct:
// 163 duties on 4 routes; the feed schedules 5 of 200 buses.
```

Stale: the sentence says "… the last good data, feed time 12:36." and "last good data" is drawn
in the stale tone (amber, semibold; the words carry it). Sample-data, unavailable and waiting
variants are worded by the function (a mixed page never calls its live part LIVE when it is
not). After declaring the default, tag only what differs (see "Tags").

The same holds for every other sentence on a page: on the saved sample or on last-good data
a caption, legend, chart label, table caption, trend sentence or footer never calls its
figures live. Where it names the data's source it takes the words the feed chip uses for
that source (`src/lib/depot/feedChip.ts`); otherwise it is worded so that it is true in all
three states.

`feedId` must be a registry id (`src/lib/depot/sources/registry.ts`; a test checks every page).
`indexWindow` puts the index window in the line itself: do not repeat it elsewhere.

## Index window words

One module, `src/lib/depot/score/windowWords.ts`: `scoreWindowPhrase`, `scoreWindowSentence`,
`scoreWindowShort` (column headers), `exceptionWindowNote`, `depotWindowNote`. Pass the
response's `scoreWindow`; when it carries `coveredMin`, "over the last N minutes" uses it.
One sample reads "from one snapshot at 14:20". Never word the window anywhere else.

```ts
scoreWindowSentence(data.scoreWindow, data.feedNow); // "Efficiency index over the last 20 minutes."
```

## Closing disclosure (HowProduced)

`paragraphs?`, `children?`, `id?` (an anchor: a link to `#<id>` opens it), `className?` (outer
spacing only), `testId?`. A native `<details>`, closed, summary "How these figures are
produced" with the muted chevron. Never build a page's own copy; `StatePanel`'s `howLink`
targets its `id`.

```tsx
<HowProduced paragraphs={OVERVIEW_HOW_PRODUCED} id="how-produced">
  <p className="depot-prose">One more paragraph, or the page's own block.</p>
</HowProduced>
```

## CollapsedSection and DisclosureChevron

`CollapsedSection { label, variant?: 'section' | 'row', count?, note?, open?, onToggle?,
headingId?, headingRef?, keepMounted?, testId? }`: a real button with `aria-expanded`, closed
by default; closed content is not rendered unless `keepMounted` (then hidden by class only).

```tsx
<CollapsedSection label="What-if sandbox" note="Nothing is sent" headingId="sandbox" keepMounted>
  <ScenarioPanel />
</CollapsedSection>
```

`DisclosureChevron { open?, groupOpen? }` is the one glyph ("›", muted, turned when open) used
by `HowProduced`, `CollapsedSection`, the table row expander and `ShowAllButton`; a page's own
disclosure uses it too (`groupOpen` inside a `<details className="group">`).

## SectionLabel

`label`, `count?`, `note?` (one line, right, `depot-note`), `tag?: Provenance` (a pill after the
label, only when the section differs from the page default), `level?: 2 | 3 | 4`, `id?`,
`controls?` (the section's own controls, such as a view toggle or a filter, held at the right
end of the label row after the note; they wrap under the label on a narrow row. Never lay a
control over the label row with absolute positioning).
16px from the hairline to the label, 12px to the content.

```tsx
<section aria-labelledby="exc">
  <SectionLabel id="exc" label="Night parking order" tag="modelled" note="Nearest the gate first" />
  …
</section>
```

## FigureBand and Figure

`FigureBand { label, children }` holds up to five `Figure { label, value, caption?, tag?,
share?, hero?, title? }`. Figures are a fixed width and left-packed: 232px from 1440px, 200px
from 1280px, 192px from 1024px (five fit one row at each), wrapping when the column is
narrower. Below 1024px the rows are set by `figureBandColumns` and `figureBandLastSpans`
(`src/lib/depot/shell/figureBandLayout.ts`). Under 640px a band has two columns and an odd
last figure spans the row; from 640px three sit 3 across and five 3 + 2; four sit 2 + 2 up to
767px and 4 across from 768px (`BAND_FOUR_ACROSS_FROM_PX`). Every
figure is mono 24px, 20px under 640px (`hero`: display 32px, one per page). Nothing in a
band is cut: a value, a label (with its tag) and a caption wrap, a caption to at most two
lines (`CAPTION_MAX_LINES`), and the cells of a row align to the top. Below 1024px each figure
takes three rows of the band's grid (label, value, caption) through a subgrid
(`FIGURE_ROWS_CLASSES`), so when one label in a row wraps, the values in that row stay level. At least 88px tall. A figure's label row is a fixed 16px line box
(`depot-tag-row`): a tag beside the label is drawn 16px tall and never lowers the figure. `tag` only for a generated figure on a MIXED or DERIVED page.
No `compact` (16px) form: no page needs one; the two hand-rolled 16px bands (exceptions,
economics) become ordinary bands.

`FigureBand { tag }` puts ONE tag on the whole band (the band's name and a pill on a line
above the figures): use it when every figure in the band is generated and the page default is
not, instead of a pill on each figure. `Figure { href }` makes the whole figure a link (a
count that leads to its list); `Figure { onPress, pressed }` makes it a toggle button (a
count that filters the page), with `aria-pressed`. Do not copy the figure's styling onto a
hand-made link or button.

```tsx
<FigureBand label="Ranking">
  <Figure label="Ranked" value="107" caption="of 119 operating depots" />
  <Figure label="No duty in the modelled day" value="11" />
</FigureBand>
```

## Tables (DataTable options)

Header 32px, rows 36px (every table). Opt-ins: `fixedRows` (no wrapping, truncated with the
full text in `title`), `freezeFirstColumn`, `overflowCue`, `renderExpanded` / `expandLabel` /
`multipleExpanded` (row expander), `initialExpandedKey` (one row open on first render, for a
link that lands on a row's detail), `maxRows`, `onRowSelect`, `rowLabel`.
Column extras: `unit` (shown after the header, "EARNINGS ₹/KM", so cells carry bare numbers);
`tag` (a pill in the header cell, only when the column differs from the page default; it keeps
the header's 16px line box).

**One row treatment.** A row that opens something is the control; no page draws a
boxed per-row button ("SELECT", "WHY?", an index cell button).

- *Opens elsewhere* (`onRowSelect`): the whole row is the click target, Enter and Space on the
  focused row do the same, and ONE muted chevron shows at the row's end on hover and keyboard
  focus (in the last cell's right padding: it adds no column). The row's accessible name is
  "<name>, open" (`rowActionName`); the name is `rowLabel(row)`, else the first column's text,
  else the row key.
- *Opens beneath* (`renderExpanded`): the chevron is the FIRST column, 24px wide, and shows the
  state. With no `onRowSelect` the whole row is the control (click, Enter, Space; one tab stop,
  named "<name>, show details" / "hide details", `aria-expanded` on the row); a click on a link
  inside the row stays the link's. With both, the row selects and the chevron toggles.
- `freezeFirstColumn` with an expander freezes the chevron column and the first data column
  (the second sticks at 24px, `frozenLefts` in `shell/tableLayout.ts`); both keep solid
  backgrounds, and the last frozen cell draws the hairline.

To adopt: delete the per-row button column, pass its handler as `onRowSelect` (or keep
`renderExpanded`), give `rowLabel` when the first column is not plain text, and drop any
"details" column a page drew itself. Pages that pinned header order for an expander table now
read the chevron column first.

**Links in tables** use `depot-table-link`: cyan, no underline at rest, underlined on hover and
keyboard focus. A link inside `depot-prose` or `depot-note` is underlined (a class on the link
still wins). `depot-link` stays for a stand-alone link.

`group: { key: (row) => string, label?: (key, count) => string, aside?: (key, count) => string
| null }` prints a repeated column once as a group row in mono capitals with "·" separators
("SMALL FLEETS · 35"; with `aside`, "STANDING · 52 · 5 LISTED"), counting the whole group even
when capped; drop that column. Groups follow the sort order. Use `aside` rather than a
hand-made label with a sans aside.

```tsx
const COLUMNS: Column<Row>[] = [
  { key: 'depot', header: 'Depot', render: (r) => r.name },
  { key: 'earn', header: 'Earnings', unit: '₹/km', align: 'right', render: (r) => r.earn.toFixed(2) },
  { key: 'trips', header: 'Trips/day', tag: 'modelled', align: 'right', render: (r) => r.trips },
];
<DataTable columns={COLUMNS} rows={rows} rowKey={(r) => r.id} caption="Depots" fixedRows
  group={{ key: (r) => r.peerGroup }} />
```

Rule: no sentence in a cell; an empty cell is a mono dash with the reason
in `title`.

## StatePanel

`kind`, `sentence` (ONE sentence: what is absent and why), `remedy?` (one muted line: what would
change it), `action?`, `title?` (error), `howLink?: { label, targetId }` ("How a yard is found ›",
opens the closing disclosure), `compact?` + `tone?: 'ok' | 'neutral'` (one line with a status
square, no box: a nil state inside a section), `rows?` / `rowHeight?` / `minHeight?`. Without a
footprint the panel is exactly as tall as its text; with one the text is centred in it.

```tsx
<StatePanel kind="not-established" minHeight={460}
  sentence="No yard is established yet: too few parked buses report a position together."
  howLink={{ label: 'How a yard is found', targetId: 'how-produced' }}
  action={<a className="depot-link" href="#by-state">See every bus by state ↓</a>} />
<StatePanel kind="empty" compact tone="ok" sentence="No shifts are uncovered" />
```

## Notice

`status: 'info' | 'warning' | 'critical'`, `word?` (defaults to the status), `children`.
At most one per page; not sticky; only a critical notice is announced as an alert.

```tsx
<Notice status="info" word="Recommendation">
  Nothing is moved automatically; a depot manager decides every transfer.
</Notice>
```

## Pager, ShowAllButton, ShowMore, GroupedList

`Pager { page, total, pageSize? = 25, onPage }`: under the table, mono, Previous / "Rows 1 to 25
of 1,936" / Next. The ONLY place a list's count appears. It replaces the routes page's top-right
"Page 1 of 51". Slice rows with `pageRange(page, total)` from `src/lib/depot/listPaging.ts`.

`ShowAllButton { total, expanded, onToggle, controls? }`: the one "Show all N" (quiet text, the
chevron; "Show fewer" when open). It replaces the yard's boxed "SHOW ALL 82" and the overview's
cyan link. `ShowMore { items, itemKey, renderItem, limit? = 5, label }` and `GroupedList
{ groups, itemKey, renderItem, limit?, headingLevel? }` use it.

```tsx
const range = pageRange(page, rows.length);
<DataTable rows={rows.slice(range.start, range.end)} … />
<Pager page={range.page} total={rows.length} onPage={setPage} />
<ShowAllButton total={rows.length} expanded={all} onToggle={() => setAll(!all)} controls="units" />
```

## BusStateMark and SeverityMark

`BusStateMark { state: BusOpState, short? }` and `SeverityMark { severity: ExceptionSeverity }`:
a 6px square in the status colour plus the word from `labels.ts` ("Critical", "Warning", "Info").
Never the colour alone, never a box. On a list grouped by severity, put the severity on the group
label and drop it from the rows.

```tsx
{ key: 'severity', header: 'Severity', render: (e) => <SeverityMark severity={e.severity} /> }
```

## Controls: FilterRow, SearchField, Select, Checkbox

`FilterRow { label, children }`: one wrapping row of filters. `SearchField { label, hideLabel?,
...input }` and `Select { label, hideLabel?, children, ...select }`: the label inline at the left
(mono 11px), the control 32px high, mono 12px (`depot-control`). `Checkbox { label, ...input }`.
League, routes and exceptions share this row.

```tsx
<FilterRow label="Filter depots">
  <SearchField label="Search depots" value={q} onChange={(e) => setQ(e.target.value)} />
  <Select label="Peer group" value={group} onChange={(e) => setGroup(e.target.value)}>…</Select>
  <Checkbox label="Show unranked" checked={all} onChange={(e) => setAll(e.target.checked)} />
</FilterRow>
```

## Time formatting

In `src/lib/depot/format.ts`, all reading the feed's timestamps as Indian wall-clock digits
(the trailing `Z` upstream is ignored), all giving a dash for input that does not parse:
`formatFeedTime` ("08:51"), `formatFeedDateTime` ("Mon 05 Oct, 08:51"),
`formatRelative(iso, feedNow)` ("12 min ago", "3 h ago", "2 days ago", "in 25 min",
"just now"), `isLaterFeedTime(a, b)`, `formatPlainDate("2026-10-06")` ("6 Oct 2026": the
only way a date is shown; a raw `YYYY-MM-DD` never reaches the screen), and
`formatDurationMinutes(192)` ("3 h 12 min", "13 d 21 h": never raw minutes above an hour).

```tsx
<td title={formatFeedDateTime(bus.lastSeen)}>{formatRelative(bus.lastSeen, feed.feedNow)}</td>
```

Rule: never an ISO string; the full time in `title`. Beside the feed clock, a time is
`formatFeedTimeOn(iso, feedNow)`: "19:45" on the feed's day, "5 Oct, 19:45" on another day,
so a bus last heard yesterday evening never reads as later than now.

## Copilot footer

`CopilotFooter { provider, notice, generatedAt, cached, facts, writtenFromFeedTime?,
currentFeedTime?, onWriteAgain? }`. One mono line under the prose and any evidence table:
`SCRIPTED · written 14:00 · 18 figures` (or `CLAUDE · …`); the figures open from the last part.
With both feed times, when the page's feed is newer it adds "The page has updated since; write
again." and, with `onWriteAgain`, a button. The briefing, rationale and ask answer already use
it; a page that wants the "write again" line must pass the feed times.

```tsx
<CopilotFooter
  {...response}
  writtenFromFeedTime={requestedAt} currentFeedTime={feed.feedNow} onWriteAgain={write}
/>
```


`BriefingCard` takes `currentFeedTime?`: pass the page's `feedNow`. The card keeps the feed
time of its request and passes both to the footer, which then says "The page has updated
since; write again." and offers the one "Write again".

```tsx
<BriefingCard scope={scope} title="Depot briefing" currentFeedTime={data.feedNow} />
```

## Shell, navigation and the footer

Pages do nothing here; for reference.

- **Top bar.** One row at every width: the mark, the scope switcher (it takes the free width
  and truncates), the feed chip, then the actions. Below 1280px Operations and Sign out sit
  behind one Menu button, which in depot scope also lists every network page; from 1280px
  they are in the row as quiet 32px buttons (`depot-bar-button-quiet`: no outline, faint text
  at rest, full ink on hover or keyboard focus, never heavier than the chip). Below 640px the
  mark is a 20px glyph with the name read to screen readers (the 13px wordmark leaves no room
  for the scope at 360px); from 640px it is the "DEPOT MANAGEMENT" wordmark. Never initials.
- **Navigation.** From 1280px (Tailwind `xl`) the 232px rail leads with the depot's name and its pages in depot
  scope, then the network groups. The rail's surface and right hairline run the full height
  of the page (the `<nav>` is stretched by the row); its links sit in a sticky column under
  the bar that scrolls inside itself on a short viewport. Below 1280px one strip shows the
  depot's pages only (the network links in network scope): no fixed item, so its end caps sit
  at its two outer ends, only while it overflows, with a 24px fade just inside a cap; the
  active link is centred on load and on route change. From a depot page the network is the
  scope switcher's first option, or the Menu and one link.
- **Sticky layers.** Read the `--depot-*` properties in `globals.css`, never a literal height
  (`--depot-sticky-top` is where a page's first sticky layer sticks; `--depot-anchor-mt` the
  scroll margin for a heading).

  | Width | `--depot-bar-h` | `--depot-strip-h` | `--depot-sticky-top` |
  | --- | --- | --- | --- |
  | below 640px (bar and strip scroll away) | 0 | 0 | 0 |
  | 640 to 1279px (bar row, then the strip) | 3.25rem | 2.5rem | 5.75rem |
  | from 1280px (bar row, rail beside) | 3.5rem | 0 | 3.5rem |

  `--depot-nav-h` is 2.5rem below 1280px and `auto` from 1280px; `--depot-anchor-mt` is
  `--depot-sticky-top` + 0.5rem (0.5rem, 6.25rem, 4rem); `--depot-panel-top` is
  `--depot-sticky-top` + 1.5rem.

- **Content width.** The main column's gutters are 16px each side below 640px and 24px from
  640px; the rail is 232px from 1280px. Viewport less rail less gutters (a classic scrollbar
  takes about 15px more):

  | Viewport | Rail | Gutters | Content |
  | --- | --- | --- | --- |
  | 1440 | 232 | 48 | 1,160px |
  | 1280 | 232 | 48 | 1,000px |
  | 1024 | none | 48 | 976px |
  | 800 | none | 48 | 752px |
  | 390 | none | 32 | 358px |
  | 360 | none | 32 | 328px |

- **One geometry, one width helper.** The breakpoints, rail width, gutters and table frame
  border are defined once in `src/lib/depot/shell/geometry.ts`; `contentWidthAt(viewport)`
  gives the column above and `tableRoomAt(viewport)` the room a table frame has. A table's
  width is `tableWidth(widths, keys, { expander })` (`src/lib/depot/shell/tableWidth.ts`),
  which throws on a column with no width and counts the shared `EXPANDER_WIDTH_PX` (24);
  every page's frames come from these, so a change to the rail or a gutter fails the
  layout tests of every page it moves.
- **One width-tier hook.** `useWidthTier(tiers)` (`src/components/depot/shell/useWidthTier.ts`)
  reads min-width media queries through `useSyncExternalStore`, and on the server or with no
  `matchMedia` returns the widest tier. `useTableTier` (tiers in
  `src/lib/depot/shell/tableTier.ts`), `useBelowDesktop` and `usePhone`
  (`components/depot/shell/`), the roster's tier, `useUnitsTier`
  (`components/depot/network/useUnitsTier.ts`) and the duty board's table-first switch are
  named uses of it; each page keeps its own tier names.
- **One map start-up.** The overview, transfer and yard maps start through `useBaseMap`
  (`src/components/depot/shell/useBaseMap.ts`): it loads the map library, waits at most
  `BASE_MAP_LOAD_TIMEOUT_MS` (15 s), and cleans up. A refusal from the map service is final,
  even after the map is ready; a timeout is not: a library that loads after it still builds
  the map, and the status becomes ready.

- **Stale feed, said once.** While a response is stale, a page renders
  `<StaleNotice since={data.feedNow} />` as before. For the first `STALE_NOTICE_AFTER_MS`
  (5 minutes) of the data's age, from its fetch time against the browser clock, the chip and
  the provenance line carry it alone and the notice shows nothing; after that, or when the age
  cannot be known, it shows the one shared `Notice` (STALE, "Showing last good data from
  HH:MM"). Its slot holds the notice's height from the moment it mounts, so nothing moves
  when the notice appears. The age defaults to the shell feed's fetch time (every depot
  endpoint reads the same snapshot); a page may pass `fetchedAt` to use its own.
- **A page's own request failing, said at once.** When a page's own data request fails
  after a success, `usePolledJson` keeps the last figures and reports the failure to a small
  store (`lib/depot/pageRefresh.ts`), with the feed time those figures carry. The shell's
  `PageRefreshNotice`, above every page, shows at once a WARNING-tone `Notice` ("Not
  refreshed": "This page's figures could not be refreshed. The figures on screen are the
  last ones received, feed time HH:MM."), in fixed words, never the server's text. While it
  shows, the feed chip reads STALE at that time and the provenance line says "the last good
  data", and a page's `StaleNotice` stands down (one notice per page). It clears when the
  request succeeds again or the page unmounts. Pages do nothing: every `useDepot*` hook
  reports through the shared hook. The shell's own network feed does not report; it keeps
  the chip, the provenance line and the timed stale notice above.
- **Feed quiet.** When the feed's newest report (its clock, Indian time digits) trails the
  fetch time, moved to Indian time, by more than `FEED_QUIET_AFTER_MIN` (10), the chip reads
  FEED QUIET · HH:MM in the stale tone, its title says by how much, and the provenance line
  says the figures come "from a quiet feed". Order: stale or sample, a page request failing,
  quiet, check clock, live.
- **What the shared hook does on its own.** A tick never aborts a request in flight and
  skips while one is running or the tab is hidden; showing the tab refreshes at once. A 404
  drops the figures and stops polling (the page shows its not-found state, never frozen
  figures). A 401 drops them, stops polling and calls `redirectToSignIn`
  (`lib/depot/signInRedirect.ts`): `/login?next=<this page>`, once, never from the sign-in
  page. `keepPreviousOnQueryChange` (route table, unmoved-routes lists) keeps the previous
  answer, with `previous: true` and `loading: true`, while a new query of the same path loads;
  draw it dimmed with `aria-busy` and keep the controls mounted. A new path (another depot,
  another endpoint) never carries data.
- **Sign out.** A failed or refused logout request keeps the user on the page; the button
  reads "Sign-out failed: retry" and says why to screen readers.
- **Skip link and footer.** "Skip to depot content" is the first focusable element on every
  depot page and moves focus to `<main>`. The prototype disclaimer is in the page flow after
  the content, in the footer's `depot` variant: after the PROTOTYPE pill the sentence starts at
  "Vehicle positions…" (the leading "Prototype." is dropped there only, and "are live UPSRTC
  data" reads "are UPSRTC data", since a depot page can be on the sample or last-good data;
  `depotDisclaimerText` in `src/lib/depot/shellModel.ts`; the command centre's sentence is
  unchanged), wraps in sans 11/16 at most 90 characters wide, never cut off.

