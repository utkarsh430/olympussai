# Operations console design system

How to build a screen under `/ops/*` so that four dashboards written by four
people read as one product.

Everything here is lifted from `/project/upsrtc`, not invented alongside it.
When this document and the code disagree, the code wins and this document is
the bug.

- Colour tokens: the `ops` block in `tailwind.config.ts` (alongside the
  command centre's own `void` / `holo` / `alert` / `ol` tokens, which remain
  the source they were derived from).
- Component classes: the `.ops-*` block in `src/app/globals.css`.
- React primitives: `src/components/ops/ui` (`./primitives.tsx`).
- Shell: `src/components/ops/OpsShell.tsx`.
- Navigation table: `src/components/ops/navigation.ts`.

To look at any of it without a database or a session:

```
pnpm tsx --tsconfig scripts/tsconfig.preview.json scripts/preview-ops-shell.tsx > body.html
pnpm tsx --tsconfig scripts/tsconfig.preview.json scripts/preview-ops-shell.tsx map > map.html
pnpm tailwindcss -i src/app/globals.css -o preview.css
```

Wrap the body in a page that links `preview.css` and defines `--font-display`
(Orbitron) and `--font-mono` (JetBrains Mono).

## Mounting a dashboard

Every guarded ops page has the same shape. The page resolves its session
through the guard, mounts `OpsShell`, and puts the dashboard inside it.

```tsx
const session = await requireOpsRolePage('depot', '/ops/depot');

return (
  <OpsShell title="Depot" email={session.email} role="depot" variant="wide">
    <DashboardBody userId={session.sub} />
  </OpsShell>
);
```

Rules that are not negotiable, because something else depends on each:

1. **`title` is the page's only `<h1>`.** `tests/e2e/ops-dashboard-pages.spec.ts`
   proves a dashboard rendered — rather than redirecting to sign-in, which is
   also a 200 — by finding that heading. Never add a second `<h1>` in a page
   body; use the shell's `subtitle` slot.
2. **Always pass `role`.** It selects the navigation. It grants nothing: every
   destination is enforced independently by its own `requireOpsRolePage` call.
3. **Register any new page in `OPS_NAV`.** `src/tests/unit/opsShell.test.tsx`
   fails a guarded page that no persona can click to, and fails a nav entry
   pointing at a page that role cannot open.
4. **Keep the data read inside an inner async component**, as the existing
   pages do, so a data-source failure renders an `OpsAlert` and leaves the
   chrome and navigation intact.

### `OpsShell` props

| Prop | Type | What it is for |
| --- | --- | --- |
| `title` | `string` | The page's only `<h1>`. Required. |
| `email` | `string` | Signed-in identity, shown beside sign-out. Required. |
| `role` | `OpsRole` | Selects the navigation. Optional only so the shell degrades rather than blanking; always pass it. |
| `subtitle` | `ReactNode` | Qualifier under the title — an incident id, a depot name, a date. |
| `actions` | `ReactNode` | Page-level controls, top right. Use `OpsButton`. |
| `statusStrip` | `ReactNode` | Pinned band under the chrome that does not scroll. Use `OpsStatStrip`. |
| `variant` | `'document' \| 'wide' \| 'full'` | Layout. See below. |
| `contentClassName` | `string` | Extra classes on `<main>`. Layout only. |
| `children` | `ReactNode` | The dashboard. |

### Variants

- **`document`** (default) — centred, `max-w-5xl`. Forms, admin screens,
  timelines, anything read as prose.
- **`wide`** — `max-w-[1680px]`. Table- and panel-heavy dashboards.
- **`full`** — the page does not scroll; `<main>` is a flex child with
  `min-h-0`. **This is the one a map needs.** Google Maps sizes itself to its
  container, and a container inside an auto-height ancestor resolves to zero,
  which renders the map as a blank strip. Pair it with `OpsMapFrame`.

Nothing in the ops shell applies `transform: scale`, and nothing you add
should. The fleet canvas overlay (`src/components/map/fleetCanvasLayer.ts`)
projects vehicle positions in layout pixels, so a scaled ancestor slides every
bus off the road — the command-centre layout uses CSS `zoom` for exactly that
reason.

## The primitives

Import from `@/components/ops/ui`. All are server-component safe (no hooks,
no `'use client'`), so a Server Component dashboard can render them directly.

**Layout** — `OpsStack` (standard vertical rhythm), `OpsGrid` (2/3/4 columns,
collapsing on tablet), `OpsSection` (an `<h2>` block of a page),
`OpsPanel` (a framed surface, `<h3>` by default), `OpsToolbar`.

**Readouts** — `OpsStat` (one glanceable number), `OpsStatStrip` (the pinned
band; pass it to the shell's `statusStrip`, not the page body),
`OpsReadout` (key/value inside a panel).

**Status** — `OpsBadge` (`live` / `sim` / `fixture` / `critical` / `neutral`),
`OpsAlert` (`info` / `success` / `warning` / `error`), `OpsEmptyState`.

**Controls** — `OpsButton` (`default` / `primary` / `danger` / `quiet`),
`opsButtonClass` for a link that should look like one, `OpsField`, `OpsInput`,
`OpsSelect`, `OpsTextarea`.

**Tables** — `OpsTableFrame` plus the class constants `opsTableClass`,
`opsTheadRowClass`, `opsThClass`, `opsTrClass`, `opsTdClass`,
`opsTdMutedClass`, `opsTdNumericClass`. Constants rather than a data-driven
table, because ops cells differ in every way that matters.

**Map** — `OpsMapFrame`, with an `overlay` slot whose children are
pointer-transparent until you mark one `pointer-events-auto`.

## Conventions

- **Compose, do not restyle.** A raw `className` carrying a colour is a
  signal that a primitive is missing. Add it to `ui/primitives.tsx` so the
  next dashboard inherits it, rather than inlining a hex.
- **Heading levels are owned by the components.** Shell `<h1>`, `OpsSection`
  `<h2>`, `OpsPanel` `<h3>`. Do not write your own heading tags.
- **Every number an operator watches is tabular.** `OpsStat`, `OpsReadout`
  and `opsTdNumericClass` already are. A readout whose digits change width
  jitters on every poll, and a jittering number is one an operator stops
  trusting.
- **Provenance labelling is shared and must stay shared.** `OpsBadge`'s
  `live` / `sim` / `fixture` / `critical` variants use the same `.badge-*`
  classes the command centre uses. This product's central honesty claim is
  that an operator can always tell observed data from modelled data, and it
  only holds if one source value looks identical on every surface. Never
  introduce a second green chip.
- **`warning` and `error` announce; `info` and `success` do not.** `OpsAlert`
  picks `role="alert"` vs `role="status"` from the tone. An operator on shift
  must be interrupted by "the feed is down" and must not be interrupted by
  "12 vehicles shown".
- **Say why a list is empty.** `OpsEmptyState` takes a caller-supplied label
  because "no vehicles reporting" is reassuring on a quiet night and
  dangerously wrong during an outage. See `emptyFleetLabel` in
  `src/components/ops/DataSourceNotice.tsx`.
- **Depot scoping is a server-side boundary, never a UI filter.** Components
  receive already-scoped data and label it; they must not narrow it. See
  `DepotDashboard`'s doc comment.
- **The surface is dark, and motion is minimal.** The console keeps the
  command centre's grid and volumetric wash and animates nothing — it is read
  for a whole shift, and it includes forms. `prefers-reduced-motion` is
  honoured globally in `globals.css`; do not add animation that would need it.
- **Contrast.** Every `ops` ink token clears WCAG AA against `ops.bg` and
  `ops.surface`. Use `ops.danger` / `ops.warn` / `ops.good` for alert-coloured
  *text* and `alert.crimson` / `alert.amber` / `alert.green` for borders,
  fills and badges.

## Sign-out

`OpsSignOut` is mounted by the shell and must not be reimplemented. It
navigates only after the server confirms both sessions ended, and reports a
failure rather than showing a login page over a live session. See its doc
comment and `src/tests/unit/opsShellSignOutButton.test.tsx` for why every
branch exists.
