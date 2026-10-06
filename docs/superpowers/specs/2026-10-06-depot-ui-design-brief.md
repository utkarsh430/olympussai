# Depot Management — UI design brief

Governs every screen under `/project/depots`. Read with
`2026-10-06-depot-management-design.md`.

## Who it is for

- **HQ planner** scanning 143 depots for the ones that need attention, then deciding
  where buses should move.
- **Depot manager** opening one depot at the start of a shift to see what is on the road,
  what is held, and what is late.

Both read numbers for a living. The screens are instruments, not marketing.

## Direction: the same world as the command centre, with the lights turned down

The command centre is cinematic: glow, scanlines, corner ticks, a fixed viewport. The
depot module shares its palette and typefaces but is a working ledger: flat surfaces,
hairline rules, long scrolling pages, dense tables.

Boldness is spent in **one** place per page: a single hero instrument (the network map,
the efficiency index, the transfer plan). Everything else is quiet.

Not allowed: a card around everything, glow on ordinary panels, scanline or noise
overlays, pill-shaped controls, gradient fills, decorative icons, count-up animation
outside the KPI band, large empty areas.

## Type

| Role | Face | Use |
|---|---|---|
| Display | Orbitron (`font-display`) | Page titles, hero numerals only |
| Data | JetBrains Mono (`font-mono`) | Tables, labels, navigation, every figure |
| Prose | Manrope (`font-sans`) | Descriptions, briefings, empty and error states |

Scale (no CSS `zoom`; the command centre's 1.18 zoom is not used here):

- Page title: display 20px / 600 / tracking 0.12em / uppercase
- Section label: mono 11px / uppercase / tracking 0.16em
- Table and data text: mono 13px, `tabular-nums`
- Prose: sans 14px / line-height 1.55
- Hero numeral: display 32px / 600

Nothing below 11px.

## Colour

New `depot` Tailwind namespace (alongside `sim` and `ol`), all AA on the page background:

| Token | Value | Use |
|---|---|---|
| `depot-page` | `#02040a` | Page background (same as `void`) |
| `depot-surface` | `#070f1d` | Panels, table header |
| `depot-raised` | `#0a1626` | Hovered row, active nav item |
| `depot-line` | `rgba(63,240,255,0.12)` | Hairline rules and borders |
| `depot-ink` | `#dbe7f3` | Primary text and figures |
| `depot-muted` | `#9bb0c7` | Secondary text |
| `depot-faint` | `#6b84a0` | Tertiary labels (5.3:1 on page) |

Existing tokens keep their meaning: `holo-glow` cyan for interactive and active,
`alert-green` / `alert-amber` / `alert-crimson` for good / caution / critical.

Provenance tags (always text, never colour alone):

| Tag | Colour | Meaning |
|---|---|---|
| LIVE | `alert-green` | Straight from the feed |
| DERIVED | `holo-glow` | Computed from live data |
| MODELLED | `alert-amber` | Generated; never the word "simulated" |
| REFERENCE | `depot-muted` | Curated static data |

## Layout

- **Top bar**, 56px, sticky: mark and "Depot Management", scope crumb, feed status,
  "Operations" link back to the command centre, sign out.
- **Left rail**, 232px, sticky: grouped navigation in mono 12px. The active item is
  marked by a 2px cyan bar on its left edge and `depot-raised` background, not a pill.
- **Content**: fills the remaining width with 24px gutters; 12-column grid, 16px gaps.
  Each page starts with a `PageHeader`: title, one sentence of prose, controls on the
  right.
- **Footer**: `FooterDisclaimer variant="dark"` at the end of every page.

Radius 6px on panels, 3px on tags and inputs. No shadows; depth comes from the hairline
and the surface step.

## Responsive

Built for 1280px and wider. At 1024px the rail narrows to 200px. Below 900px the rail
becomes a horizontal scrolling strip under the top bar. Tables scroll inside their own
container; the page never scrolls sideways.

## States (every data surface)

- **Loading**: static placeholder blocks in `depot-surface`, same footprint as the data.
- **Empty**: one sentence saying what is absent and why, in prose.
- **Stale**: an amber hairline strip above the content: "Showing last good data from
  14:02".
- **Fixture**: the feed status reads FIXTURE; figures are still labelled.
- **Error**: a panel with what failed and a Retry button; never a blank page.

## Motion

Sections fade and rise 8px once on mount (existing `rise` keyframe). KPI numerals may
count up. Nothing loops. The global reduced-motion rule already disables all of it.

## Accessibility

Keyboard reachable in visual order, the global cyan focus ring, `aria-current="page"` on
the active nav item, real `<table>` markup with `<th scope>`, status always carried by a
word as well as a colour, a skip link to the main region.
