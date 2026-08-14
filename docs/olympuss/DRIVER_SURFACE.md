# The driver surfaces

There are two, they are not the same screen, and conflating them is the
mistake this document exists to prevent.

| Route | Role | What it is for |
| --- | --- | --- |
| `/ops/pilot-driver` | `pilot_driver` | The installable PWA carried in the cab: the live instruction console, and the route ahead with arrival times. |
| `/ops/driver` | `driver` | Reporting a breakdown, reading back your own filed reports, and looking up a schedule. |

They are separate roles with separate API surfaces.
`/api/ops/pilot-driver/*` is `pilot_driver` only; `/api/ops/driver/breakdown-reports` is `driver` only.
Neither role can open the other's screen, and widening either one is a security change, not a convenience.

## Who this is designed for

Somebody driving a bus, holding a phone, possibly in direct sunlight, one-handed, at the roadside.

That produces rules the rest of the console does not have:

- Body copy is `text-base`, not the console's `text-sm`.
- The arrival figure is `text-3xl`; the command countdown is `text-4xl`.
- Interactive targets are at least 48px, and the three command-response buttons are 64px and stack full-width on a phone.
- Nothing in the arrival list is tappable. A control that cannot be pressed cannot be mis-pressed while driving.
- No horizontal scrolling anywhere, at any width.

## Order on the pilot-driver page is load-bearing

The command console renders first, above the route, on every screen size.

It is the only place a driver sees an instruction from the control room, and a driver who has scrolled down to read their route must not be able to scroll an arriving command out of sight.

The route section is wrapped in an error boundary (`JourneySection`) and **the console is deliberately outside it**.
An uncaught render error in React unmounts the whole tree, so without that boundary a malformed arrival response or a Google Maps failure would replace a live command with a blank screen.
A boundary containing both would defeat its own purpose.

## The three kinds of claim, and why they look different

The driver's stop list can show three different things, and a driver must be able to tell them apart without reading.

1. **A measured prediction** - large cyan figure with its range underneath (`4 min` / `3-5 min`).
   Cyan is the console's live-instrument accent and is used for nothing else in this list.
   The range is never omitted: the measured median band on this data is 112% of the point estimate, so the figure alone would overstate what is known.

2. **A published timetable time** - small amber clock reading labelled `TIMETABLE` (`TIMETABLE 10:05`).
   Never a countdown, never in the prediction's slot, never in the prediction's colour, and **never used to fill a gap where a prediction is missing**.
   The qualifier ("published schedule, not a measurement of where your bus is") is stated once under the map rather than on every row.

3. **Cannot predict** - a muted grey sentence saying why, and no number at all.
   Not a zero, not a dash, not `--:--`.
   The stop keeps its name, sequence and distance, because it is still a stop on the route.

A whole-bus refusal is different again: the map is replaced by the service's own plain-language reason, and the badge reads `NO TIMES`.

An **outage** is not the same as a refusal.
"We looked and cannot predict this bus" and "nobody looked" are different facts; a 503 renders as an error, never as a calm absence of times.

## Where the honesty rules actually live

They are not in the components.
A component that renders `etaSeconds` in a big font and drops the band would undo every guarantee the arrival subsystem makes, so the decisions live in pure, tested modules and the components only lay out what those return:

- `src/lib/ops/driverJourneyView.ts` - what may be shown as a time.
  `arrivalReadout` returns the point estimate and its band together or returns neither; there is deliberately no exported function that formats a point estimate alone.
- `src/lib/ops/driverJourney.ts` - the prediction/timetable join.
- `src/lib/ops/driverRouteOverlay.ts` - what may be drawn on the map.

## The join key cost a defect. Read this before touching it

Control-service `stops.id` is the bare upstream `atco_code`.
`CanonicalStop.id` is **not**: `src/lib/upsrtc/normalizer.ts` builds it as `${atco_code}-${stop_sequence}`, then appends `#2`, `#3`, ... to break surviving collisions.

The join was first written assuming both sides carried the bare code, and its unit tests were written from the same assumption, so they passed.
The timetable then never rendered for any stop, silently, with a green suite.
It was caught by looking at the rendered page.

A second, independent version of the same mistake followed: `scheduledArrival` is a bare clock string (`"10:05:00"`), not an ISO timestamp, so parsing it as a date returned null for every real value.

Both are now tested against the real producer (`normalizeSchedulePayload`) rather than against hand-written fixtures, which is what keeps this file's idea of the format and the normalizer's from drifting apart again.

## Do not regress the command console

The ack flow is safety-critical and took a defect fix to make commands reach drivers at all.
The re-skin changed presentation only; the polling, the IndexedDB outbox written **before** the network call, the Background Sync flush, the TTL countdown and the append-only audit trail are untouched.

`tests/e2e/pilot-driver-command.spec.ts` is what proves that, and it must actually run - a skipped spec is not a pass.
