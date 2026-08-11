# Presentation Guide

Operational notes for whoever is driving the demonstration.

---

## Recommended setup

| Setting | Value |
| --- | --- |
| Resolution | **1920 × 1080** (the layout is tuned for this) |
| Browser | Chrome or Edge, current version |
| Zoom | 100% — browser zoom will crowd the panels |
| Mode | Full screen (**⛶** in the top bar, or `F11`) |
| Network | Any connection that can reach `margdarshi.upsrtcvlt.com` |

Laptop screens down to about 1440 × 900 work correctly; panels compress but
nothing is lost. Below that, prefer an external display.

### Full-screen procedure

1. Click **⛶** at the far right of the top command bar (or press `F11`).
2. Confirm the fleet count is populated before you begin speaking.
3. To exit, press `Esc` or click **⛶** again.

Full screen may be blocked by browser policy in some managed environments. The
demo works identically windowed — it just has less room.

---

## Pre-flight checklist

Run through this five minutes before presenting.

- [ ] `pnpm run start` is running (or `pnpm run dev`).
- [ ] Page loads and the top bar shows **CONNECTED** in green.
- [ ] Live bus count is in the thousands, not zero.
- [ ] Click one bus — the detail drawer opens with coordinates.
- [ ] The schedule section fills in (or says "no schedule assigned" — both fine).
- [ ] The Alert Centre shows five alerts; click one — the analysis panel opens.
- [ ] Click **Fleet Distribution** in the command bar — the demand view opens.
- [ ] Open **Audit**, click **Clear** to start with an empty trail.
- [ ] Open **Scenario Lab**, click **Reset Demonstration**.
- [ ] Browser at 100% zoom, full screen ready.

---

## If the live API fails

The app degrades in stages and **never shows a blank screen or an error stack**.

| What happened | What you will see | What to say |
| --- | --- | --- |
| Upstream slow / timed out | Amber banner: "last known good positions" | "We're showing the last confirmed positions — the feed refreshes every fifteen seconds." |
| Upstream unreachable at startup, no opt-in set | Red banner + `UPSTREAM UNAVAILABLE` badge, **no vehicles shown** | "The upstream feed isn't answering, so we're showing nothing rather than something invented. That's deliberate — this console never fills a gap with data it doesn't have." |
| Upstream unreachable at startup, presenting with `NEXT_PUBLIC_DEMO_MODE=1` or `ALLOW_FIXTURE_FALLBACK=1` | Amber banner + `UPSRTC FIXTURE FALLBACK` badge | "We're on a captured snapshot of real UPSRTC data. The positions are genuine, just not this minute's." |
| Google Maps key rejected | Futuristic "Basemap Unavailable" panel | "The basemap isn't loading, but the fleet data and all the intelligence layers are live — let me show you in the panels." |
| No schedule for the vehicle | "No UPSRTC schedule is assigned to this vehicle" | "This vehicle has no assignment today — let me pick one that does." |

**Do not apologise excessively for fallback mode.** The fixture contains real
UPSRTC records. The honest framing is "real data, captured earlier".

**If you want fixture mode available in a room with no connectivity, set it
before the demo** — `NEXT_PUBLIC_DEMO_MODE=1` (or `ALLOW_FIXTURE_FALLBACK=1`).
It is off by default on purpose: a live deployment that quietly swapped in demo
buses during an outage would be showing a dispatcher vehicles that do not
exist.

### Choosing a good bus to demo

Prefer a bus that shows a **route name** in the fleet list (not "No route
assigned") and a **green** data-quality dot. Those are most likely to return a
full schedule. Buses with `_ORD_OUT` style route codes are reliable choices.

---

## Forcing fixture mode deliberately

For a venue with no internet, or to guarantee identical output every run:

```bash
# Add to .env.local (do not commit)
NEXT_PUBLIC_DEMO_MODE=1
```

Then rebuild and restart. Every response is served from the sanitized fixture
and clearly labelled `UPSRTC FIXTURE FALLBACK`. Remove the line to return to
live mode.

---

## Resetting between runs

Two levels:

1. **Scenario Lab → RESET DEMONSTRATION** — clears the active scenario, all
   presenter overrides, open modals and pitch state. Use between rehearsals.
2. **Audit → Clear** — empties the event timeline. Use before the real thing so
   the trail tells a clean story.

Reloading the page also resets everything except the audit log, which persists
in browser storage by design.

---

## Using the Scenario Lab live

The **Scenario Lab** (top bar) tunes every simulated value in real time. The
active scenario rebuilds instantly as you drag.

Useful during Q&A:

- _"What if the bunching risk were lower?"_ — drag **Bunching risk** to 55%.
- _"What about a festival day?"_ — toggle **Festival surge** in Demand.
- _"What if help were further away?"_ — raise **Response time** in Breakdown.
- _"Show more rescue options"_ — raise **Rescue candidates** to 5.

Because the simulation is deterministically seeded, resetting always returns to
the same baseline figures.

---

## Speaking points that land well

- **"Every marker is a real bus."** Say this early. It is the single most
  credible fact in the room.
- **"The copilot proposes. The dispatcher decides."** Repeat this at least
  twice. It pre-empts the automation-risk objection.
- **"We are honest about data quality."** The GOOD/DEGRADED/STALE filter shows
  operational maturity, not weakness.
- **"Every alert is attached to a real bus."** Then add: "what we predict about
  it is a projection." Saying both keeps you credible.
- **"We only fetch the schedule for the bus you selected."** Signals respect
  for existing systems.
- **"These are estimates, not results."** Say it before anyone asks. It buys
  credibility for everything else.

---

## Expected Director questions

**"Is this actually connected to our system, or is it a mock-up?"**
> The vehicle positions and schedules are live from the UPSRTC endpoints —
> those are our own systems, and this is this minute's data. Every alert is
> attached to a real vehicle. What the copilot predicts about those vehicles is
> model output, and those surfaces are marked PREDICTIVE.

**"Are those alerts real? Is that bus actually broken down right now?"**
> No. The vehicle, its depot, route and position are real and live. The
> projected condition is model output — that is what the PREDICTIVE marker
> means. Nothing on this screen is a confirmed operational event, and nothing
> has been dispatched.

**"So the AI doesn't actually work yet?"**
> Correct, and that is deliberate. Building a bunching optimizer before we have
> agreed what a good intervention looks like would be the wrong order. This
> prototype demonstrates the interface and the workflow so we can settle that
> question first. The algorithms are well-understood; the operational design is
> what needs your input.

**"Where do the impact numbers come from?"**
> They are modelled estimates for this conversation, drawn from published
> outcomes in comparable transit systems, and labelled as estimates. The only
> way to get real numbers for UPSRTC is a controlled pilot.

**"Can it hold or divert a bus automatically?"**
> No — and it should not. Every recommendation requires explicit dispatcher
> authorization. There is no code path in this prototype that transmits an
> instruction to a vehicle.

**"Are you contacting real drivers?"**
> No. No message, SMS or call leaves the browser. The banner on every
> communication screen says so explicitly.

**"What would a pilot cost and how long?"**
> The proposal is one depot, one corridor, ninety days, advisory mode only.
> That scope is chosen so it can be evaluated on measurable outcomes rather
> than impressions.

**"What about data security and driver privacy?"**
> No personal data is used anywhere in this prototype. The inspection tooling
> actively redacts device identifiers and any personal fields before they can
> be written to disk. Driver identity is a placeholder throughout.

**"How does this handle nine thousand buses without slowing down?"**
> Marker clustering, incremental marker updates rather than full redraws,
> server-side caching, and compression on the feed. Open the Diagnostics drawer
> and you can see the record pipeline live.

**"What happens when the GPS feed goes down?"**
> It degrades in stages — last-known-good, then a real captured snapshot — and
> tells the operator honestly which one they are looking at. It never goes
> blank and never shows an error page.

---

## Keyboard reference

| Key | Action |
| --- | --- |
| `Esc` | Close the top-most drawer, modal or exit Pitch Mode |
| `Space` | Pause / resume Pitch Mode |
| `←` `→` | Previous / next Pitch Mode step |
| `Tab` | Move through controls (focus ring is visible) |
| `F11` | Browser full screen |

---

## Accessibility notes

Reduced-motion preferences are respected — if the presenting machine has
"reduce motion" enabled, animations are suppressed automatically and the demo
remains fully legible. Severity is always communicated in text as well as
colour, so the demo reads correctly on a projector with poor colour fidelity.
