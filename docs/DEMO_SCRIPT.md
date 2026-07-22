# Director Presentation Script (8–10 minutes)

Exact click-by-click script. Stage directions in _italics_, spoken lines in
plain text, buttons in **bold**.

**Before you start:** browser at 1920×1080, app running, fleet loaded
(bus count visible in the top bar). Press **⛶** (top right) for full screen.

---

## 1. Opening statement — 45 seconds

_Full-screen command centre, no bus selected._

> "This is TitanX AI.
>
> What you are looking at is not a mock-up. Every marker on this map is a real
> UPSRTC bus, streaming live from our own GPS infrastructure, refreshed every
> fifteen seconds."

_Point at the live bus count in the top bar._

> "Right now there are approximately nine and a half thousand vehicles
> reporting. One hundred and forty-three depots. Nearly twelve hundred routes.
>
> I want to be precise about one thing from the outset, because it matters.
> The vehicle positions and the schedules are live and real. What the copilot
> does with that data — the predictions, the recommendations — is model output.
> Those surfaces are marked PREDICTIVE. They are projections for a dispatcher
> to review, not confirmed events."

_Point at the two badges in the top bar: `LIVE UPSRTC GPS` and
`PREDICTIVE ENGINE ACTIVE`._

_Point at the Alert Centre._

> "And the copilot is already working. Five conditions flagged across the
> network, each attached to a real vehicle, with a new one surfacing roughly
> every half minute."

---

## 2. The current operational challenge — 60 seconds

> "Today, our control rooms can answer one question very well: *where is the
> bus?*
>
> What they cannot answer is: *what is about to go wrong, and what should I do
> about it?*
>
> When two buses bunch together on a corridor, we learn about it from passenger
> complaints. When a bus breaks down, the response is a sequence of phone
> calls. When demand spikes, redistribution depends on the experience of
> whoever happens to be on duty.
>
> None of that is a failure of our staff. It is a limit of the tools. This
> prototype demonstrates what those tools could become."

---

## 3. Live fleet demonstration — 60 seconds

_In the left panel, type a depot name into the filter, or use the **Depot**
dropdown._

> "The operator can filter the entire live fleet by depot, by route, or by GPS
> data quality."

_Click the **GOOD** / **DEGRADED** / **STALE** buttons._

> "This last one matters operationally. We are honest about data quality.
> Green means we have a GPS fix within five minutes. Amber means the fix is
> ageing. Red means we have lost the vehicle. A control room needs to know
> which of its vehicles it can actually see."

---

## 4. Selected bus and live schedule — 75 seconds

_Click any bus in the left panel — ideally one with a route name._

> "When the operator selects a vehicle, the map flies to it and the copilot
> anchors to it."

_Point at the **LIVE UPSRTC DATA** section in the drawer._

> "Everything in this green section is real: the coordinates, the speed, the
> heading, the ignition state, the GPS timestamp, the depot."

_Scroll to **LIVE UPSRTC SCHEDULE**._

> "And this is the real UPSRTC schedule for this vehicle, retrieved on demand
> from our scheduling system — the origin, the destination, the scheduled
> departure and arrival, and the full stop sequence."

_Click **Stop sequence** to expand it._

> "Fifty-two stops, with their scheduled times. Note that we only request this
> for the vehicle the operator has actually selected. We do not pull schedules
> for nine thousand buses — that would put a load on the scheduling system that
> it should not have to carry."

---

## 5. Bunching capability — 90 seconds

_Click the top **Headway** alert in the Alert Centre._

> "The copilot has already flagged this one. Let me open it."

_Point at the three-service diagram._

> "The copilot places the selected service in the middle. Ahead of it, a
> preceding service. Behind it, a following service.
>
> The forward gap has collapsed to three minutes. The rear gap has stretched to
> twenty-four. Target headway is fifteen. That is textbook bunching forming."

_Point at the risk figure._

> "Eighty-seven percent probability, clustering predicted at the next major
> stop, roughly eight minutes out."

_Point at the copilot panel on the right._

> "The copilot states what it observed, what it recommends — hold this bus for
> ninety seconds at the next authorized station — and what it expects to
> happen: the forward gap recovers from three minutes to six."

_Click **Apply 90s hold** in the scenario panel._

> "And critically — look at the controls. Accept. Modify. Reject. Monitor
> only. The copilot does not act. A qualified dispatcher decides. That is a
> deliberate design constraint, not a limitation."

---

## 6. Traffic capability — 75 seconds

_Click a **Corridor** alert in the Alert Centre._

> "Second scenario. The copilot projects congestion four kilometres ahead of
> this vehicle on its scheduled corridor."

_Point at the density chart._

> "Predicted speed through the affected stretch drops to about nine kilometres
> an hour. Normal arrival is forty-two minutes; through the congestion it
> becomes sixty."

_Point at the two route cards._

> "The alternative corridor is projected at forty-eight — a saving of twelve
> minutes, while still serving the major passenger stops."

_Point at the safety note._

> "And again: route diversion requires authorized dispatcher approval. The
> system proposes. It does not divert."

---

## 7. Breakdown capability — 75 seconds

_Click a **Vehicle** alert in the Alert Centre._

> "Third scenario, and this is where response time translates directly into
> passenger experience."

_Point at the red alert._

> "Projected engine overheating. Forty-seven passengers onboard. Roadside
> assistance required."

_Point at the three candidates._

> "The copilot has identified three assistance options and ranked them — by
> distance, response time, available capacity and route compatibility.
> RESCUE-02 arrives in about eleven minutes with thirty-one seats."

_Point at the response timeline._

> "And it compresses the whole coordination sequence — detection, alert,
> candidate identification, approval, driver contact — into a single reviewable
> workflow. Today that is a series of phone calls."

---

## 8. Demand capability — 75 seconds

_Click **Fleet Distribution** in the top command bar._

> "Fourth scenario. This one is about the fleet, not one vehicle."

_Click through the time slider: **6 AM**, **8 AM**, **5 PM**._

> "The presenter can move through the day. At the morning peak, Route A needs
> eleven buses and has seven — a deficit of four, running at one hundred and
> sixty-four percent of comfortable capacity. Route B has nine and needs six."

_Point at the redistribution plan._

> "The recommendation is specific: move two buses from B to A, release one
> depot reserve, open one temporary short service, and review in thirty
> minutes."

_Point at the before/after figures._

> "Projected effect: average waiting time roughly halves, and overcrowding
> comes back within acceptable limits."

---

## 9. Driver communication — 60 seconds

_Click **Send to Driver** in the copilot panel (or **Contact Driver** in the
vehicle panel)._

> "None of this is useful unless it reaches the driver."

_Point at the banner._

> "Note the banner: no driver is contacted from this prototype."

_Point at the two message fields._

> "The instruction is prepared in English and in Hindi. The dispatcher can edit
> either before approving."

_Click **Approve & Send**._

> "Encrypted channel, delivery confirmation, driver acknowledgement — and every
> step of that written to an audit trail."

_Optionally click **Start Voice Call**, let it connect, then **End Call**._

> "And where a message is not enough, a voice channel — with the incident
> context and suggested speaking points in front of the dispatcher, and an
> automatic summary written to the log afterwards."

---

## 10. Expected impact — 45 seconds

_Click **Impact** in the bottom strip._

> "If this were deployed, this is the scale of outcome we would be targeting."

_Point across the KPI grid._

> "Roughly a third fewer bunching incidents. A quarter off average passenger
> waiting time. Breakdown response down by nearly forty percent. Fleet
> utilization up seventeen points."

_Point at the footer disclaimer._

> "I want to be careful here. These are modelled estimates,
> not measured results. The only honest way to establish real numbers is a
> controlled pilot."

---

## 11. Suggested pilot — 45 seconds

_Press **Esc** to close the impact view._

> "So my proposal is deliberately small.
>
> One depot. One high-frequency corridor. Ninety days.
>
> We instrument the bunching workflow and the driver communication workflow
> only — the two with the clearest measurable outcome. We run the copilot in
> advisory mode, where dispatchers see recommendations and we record what they
> chose and what happened.
>
> At the end of ninety days we have real numbers instead of estimates, and a
> factual basis for deciding whether this goes further."

---

## 12. Closing statement — 30 seconds

> "The positions on this screen are real today. The intelligence layer on top
> of them is what we are asking to build.
>
> UPSRTC already has the hardest part — the data, at scale, across the whole
> state. What is missing is the layer that turns it from a map into a decision.
>
> Thank you. I am happy to take questions."

---

## Fallback: automated Pitch Mode

If you would rather not drive manually, click **Pitch Mode** in the bottom
intelligence strip (Scenario Timeline panel).
It runs the same sequence automatically in about 105 seconds with on-screen
captions. Controls: **Pause**, **Previous**, **Next**, **Exit**
(or `Space`, `←`, `→`, `Esc`). No audio is played.

Useful when: the room is running short on time, you want a hands-free opener,
or you are presenting remotely and want to avoid mouse-tracking lag.
