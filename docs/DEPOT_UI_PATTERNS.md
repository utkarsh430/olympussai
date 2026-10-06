# Depot UI patterns

The shared pieces every depot page uses. Each is built once in `src/components/depot/shell/`
(the copilot footer in `src/components/depot/copilot/`); a page applies them and never
rebuilds them. The direction they implement is `.superpowers/sdd/_swarm/design-wave-rulings.md`
(cited below as "Rulings §n"). Page order, top to bottom: `PageHeader` (with its provenance
line), the one hero, supporting sections under `SectionLabel`s, and one closed disclosure at the
end, "How these figures are produced".

## PageHeader

`title`, `description` (ONE sentence, about 80 characters), `eyebrow?`, `controls?`,
`provenanceLine?: ProvenanceDescription`. Earlier props still work: `provenance?` (tag plus the
old per-tag note) and `children` (placed where `controls` go). On a depot page the depot's name
appears above the title automatically (the depot layout supplies it); pass `eyebrow` only to
override it. The title is the page's only `h1`.

```tsx
<PageHeader
  title="Crew"
  description="Availability and rostering only. No individual is assessed."
  provenanceLine={{ default: 'modelled', replacedBy: 'a crew roster and leave feed' }}
  controls={<Select label="Shift" hideLabel value={shift} onChange={onShift}>…</Select>}
/>
```

Rule: Rulings §1 (anatomy; nothing between the header and the hero).

## Provenance line

`provenanceLine` on `PageHeader` (component `ProvenanceLine`, pure `provenanceLine()` in
`src/lib/depot/provenanceLine.ts`). Descriptions and what they render with a fresh feed:

| Description | Renders |
|---|---|
| `{ default: 'modelled', replacedBy: 'a crew roster and leave feed' }` | `MODELLED` Generated from planning assumptions, not measured. Replaced when a crew roster and leave feed is connected. Data sources |
| `{ default: 'mixed', live: 'Bus states', modelled: 'duties and bays' }` | `MIXED` Bus states are LIVE; duties and bays are MODELLED. |
| `{ default: 'derived' }` | `DERIVED` Computed from the live feed at 08:51. |
| `{ default: 'live' }` | `LIVE` Live from the feed at 08:51. |
| `{ default: 'reference' }` | `REFERENCE` Reference data, curated; not from the feed. |

Stale, sample-data, unavailable and waiting variants are worded by the function (a mixed page
never calls its live part LIVE when it is not). Rule: Rulings §2. After declaring the default,
tag only what differs: a `SectionLabel`'s `tag`, a column header, a single `Figure`'s `tag`.
Never a tag in a cell, never "Modelled" in a cell or a title.

## SectionLabel

`label`, `count?`, `note?` (one line, right), `tag?: Provenance` (only when it differs from the
page default), `level?: 2 | 3 | 4` (default 2), `id?`.

```tsx
<section aria-labelledby="exc">
  <SectionLabel id="exc" label="Exceptions" count={49} note="Most severe first" />
  <GroupedList groups={groups} itemKey={(e) => e.id} renderItem={(e) => <ExceptionRow e={e} />} />
</section>
```

Rule: Rulings §3 (mono 11px uppercase, hairline above; no paragraph under it).

## FigureBand and Figure

`FigureBand { label, children }` holds up to five `Figure { label, value, caption?, tag?,
share?, hero? }`. `value` is already formatted. `share` (0 to 1) draws a thin fill bar.
`hero` uses the display face at 32px: at most one per page, and only when the figure is the
page's hero. A `Figure` is a list item: always put it inside a `FigureBand`.

```tsx
<FigureBand label="Fleet figures">
  <Figure label="Off the road" value={formatCount(off)} caption="live, now" />
  <Figure label="Overdue" value={formatCount(overdue)} caption="by modelled distance" tag="modelled" />
  <Figure label="Capacity used" value={formatShare(used, bays)} share={used / bays} />
</FigureBand>
```

Rule: Rulings §3. Two columns under 640px with no empty tinted cell.

## Tables (DataTable options)

Opt in per table; the defaults are today's behaviour. `fixedRows` (36px rows, no wrapping,
long text truncated with the full text in `title`: a string `render` result is used, or give
the column `title: (row) => string`), `freezeFirstColumn`, `overflowCue` (a right-edge fade
plus the words "more columns" while columns are hidden to the right). Right-align numbers
with `align: 'right'` (the header follows); put units in the header.

```tsx
<DataTable
  columns={COLUMNS} rows={rows} rowKey={(r) => r.registration} caption="Roster"
  fixedRows freezeFirstColumn overflowCue
  maxRows={25} onRowSelect={select} selectedKey={selected}
/>
```

Rule: Rulings §3 (tables). No sentence in a cell; drop constant columns; an empty cell is a
mono dash with the reason in `title`.

## StatePanel

`kind: 'empty' | 'loading' | 'error' | 'not-ranked' | 'not-established' | 'no-data'`,
`sentence` (what is absent and why), `title?` (error: what failed), `remedy?` (one muted line
of what would change it), `action?`, `rows?` / `rowHeight?` / `minHeight?` (hold the footprint),
`testId?`. `LoadingBlock`, `ErrorPanel` and `EmptyState` keep their props and render through it.

```tsx
<StatePanel
  kind="not-ranked" rows={8}
  sentence="No depot is ranked: none has enough buses reporting."
  remedy="A depot is ranked once 20 of its buses report."
  action={<a className="depot-link" href="#unranked">See the unranked depots</a>}
/>
```

Rule: Rulings §3 (one component for every state; never an empty table or a void).

## Notice

`status: 'info' | 'warning' | 'critical'`, `word?` (defaults to the status), `children`.
At most one per page; not sticky; only a critical notice is announced as an alert.

```tsx
<Notice status="info" word="Recommendation">
  Nothing is moved automatically; a depot manager decides every transfer.
</Notice>
```

Rule: Rulings §3 (one strip, 2px left rule in the status colour).

## ShowMore, GroupedList, Pager

`ShowMore { items, itemKey, renderItem, limit? = 5, label }`;
`GroupedList { groups: { key, heading, items }[], itemKey, renderItem, limit?, headingLevel? }`
(heading with count, five rows, "Show all N" with `aria-expanded`);
`Pager { page, total, pageSize? = 25, onPage }` (Previous / Next and "Rows 26 to 50 of 132";
focus moves to that line when a press disables the button). Slice rows with
`pageRange(page, total)` from `src/lib/depot/listPaging.ts`.

```tsx
const range = pageRange(page, rows.length);
<DataTable rows={rows.slice(range.start, range.end)} … />
<Pager page={range.page} total={rows.length} onPage={setPage} />
```

Rule: Rulings §3 (long lists: group by kind with counts, five per group; page at 25 where the
list is the page's purpose).

## BusStateMark

`state: BusOpState`, `short?` ("On road" with the full label in `title`). A 6px square in the
state's colour plus the word from `labels.ts`: in service green, on road (no schedule) cyan,
standing grey, dark amber, off road crimson (checked with the dataviz validator on the dark
surface; the word is always present).

```tsx
{ key: 'state', header: 'State', render: (bus) => <BusStateMark state={bus.state} short /> }
```

Rule: Rulings §3 (bus state everywhere: square plus word).

## Checkbox and Select

`Checkbox { label, ...native input props }`; `Select { label, hideLabel?, children (options),
...native select props }`. Native elements, themed: dark colour scheme, cyan accent, a muted
chevron.

```tsx
<Checkbox label="Only buses in the yard" checked={inYard} onChange={(e) => setInYard(e.target.checked)} />
<Select label="Peer group" value={group} onChange={(e) => setGroup(e.target.value)}>
  <option value="all">All depots</option>
</Select>
```

Rule: Rulings §3 (no browser-default controls).

## Time formatting

In `src/lib/depot/format.ts`, all reading the feed's timestamps as Indian wall-clock digits
(the trailing `Z` upstream is ignored), all giving a dash for input that does not parse:
`formatFeedTime` ("08:51"), `formatFeedDateTime` ("Mon 05 Oct, 08:51"),
`formatRelative(iso, feedNow)` ("12 min ago", "3 h ago", "2 days ago", "in 25 min",
"just now"), `isLaterFeedTime(a, b)`.

```tsx
<td title={formatFeedDateTime(bus.lastSeen)}>{formatRelative(bus.lastSeen, feed.feedNow)}</td>
```

Rule: Rulings §3 (timestamps; never an ISO string; the full time in `title`).

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

Rule: Rulings §3 (copilot output).

## Shell, navigation and the footer

Pages do nothing here; for reference. From 900px the rail leads with the depot's name and its
pages in depot scope; below 900px one strip shows the depot's pages with a "Network"
disclosure (network links in network scope); under 640px the bar is the mark, the scope
switcher, the feed chip and one Menu. Sticky layers use the `--depot-*` properties in
`globals.css` (`--depot-sticky-top` is where a page's first sticky layer sticks;
`--depot-anchor-mt` the scroll margin for a heading). The prototype disclaimer is in the page
flow after the content. Rule: Rulings §4 and §3 (footer).
