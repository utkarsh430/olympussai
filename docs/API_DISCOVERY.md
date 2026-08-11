# UPSRTC API Discovery

Findings from probing the undocumented UPSRTC endpoints. Sections 1-2 come
from `pnpm run inspect:api` (`scripts/inspect-upsrtc-api.ts`); sections 5-8
were mapped by direct probing on 2026-08-10/11 and are consumed by
`control-service/src/ingestion/upsrtc/`.

Nothing here was assumed. Every field, count and quirk below was observed in
a real response.

**Endpoint map — what each one is actually for:**

```
getStopAreaAndGroup   the index: 15 cities (GROUP) + 1,523 stops (STOP_AREA)
   |-- GROUP id  ------> getBusBetweenStops   statewide OD schedule  -> H*
   '-- STOP_AREA id ---> getStaticData        corridor timetable     -> H*
getScheduledBusInfo   per-vehicle stop list WITH lat/lon -> the ONLY geometry source
getGpsLiveData        vehicle positions + inventory      -> ingestion
getDynamicData        live running/cancelled trips       -> not yet consumed
```

---

## 1. Live GPS endpoint

```
GET https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php
```

| Property | Observed value |
| --- | --- |
| HTTP status | `200` |
| `Content-Type` | `text/html; charset=UTF-8` — **misleading, the body is JSON** |
| Body size | ~11.6 MiB |
| Top-level shape | Bare JSON array |
| Records | 9,588 |
| Fields per record | 51 |
| Unique registrations | 9,588 (no duplicates observed) |
| Valid coordinates | 9,588 / 9,588 |
| Null-island `(0,0)` | 0 |
| Distinct depots | 143 |
| Distinct routes | 1,194 |
| Distinct statuses | `Offline`, `Live`, `Towing`, `Stationary` |

### Field roles

| Canonical field | Upstream field(s) |
| --- | --- |
| Registration number | `regNum`, `registration_no`, `RegNo`, `bus_id` |
| Latitude | `latitude` |
| Longitude | `longitude` |
| Speed | `speed` |
| Heading | `heading` |
| Depot | `depot_name`, `home_depot` |
| Route | `route` (numeric id), `routename` (code), `route_description` (human text) |
| Service / journey | `vehicle_journey_code`, `vehicle_journey_id` |
| Timestamp | `timestamp`, `receivedTime` |
| Vehicle status | `status`, `vehicle_status`, `ignition`, `gpsFix`, `packetStatus` |
| Stops | `next_stop`, `previous_stop`, `destination` (frequently empty) |

### Full observed key list

```
packetType, alertId, packetStatus, systemCodeNumber, regNum, gpsFix, timestamp,
receivedTime, latitude, longitude, speed, heading, numSatellites, altitude,
ignition, mainPowerStatus, mainInputVoltage, internalBatteryVoltage,
emergencyStatus, tamperAlert, distance, frameNumber, vendorId, firmwareVersion,
zone_name, status, registration_no, vehicle_journey_id, route, routename,
scheduled_start_time, actual_start_time, scheduled_end_time, next_stop,
next_stop_eta, delay, destination, destination_eta, previous_stop,
previous_stop_actual_time, destination_schedule_time,
previous_stop_schedule_time, next_stop_schedule_time, platform_name,
route_description, vehicle_journey_code, RegNo, bus_id, home_depot, depot_name,
vehicle_status
```

### Notable quirks

1. **`Content-Type` lies.** The endpoint advertises `text/html` while returning
   JSON. The client parses the text body itself rather than trusting the header,
   and guards against a genuine HTML error page by rejecting bodies that start
   with `<`.
2. **`"None"` as a string.** Several fields (`actual_start_time`, others) carry
   the literal string `"None"` rather than `null`. The normalizer treats
   `"None"`, `"null"`, `""` and `"NULL"` as absent.
3. **Sparse trip fields.** `next_stop`, `destination`, `next_stop_eta` and
   `destination_eta` are empty strings on most records.
4. **`delay` can be negative** (service running ahead of schedule).
5. **Only ~8.5% of vehicles report `status: "Live"`** — 817 of 9,588 at the
   time of inspection. The rest are `Offline`, `Stationary` or `Towing` but
   still carry valid last-known coordinates, so they remain useful on the map.

---

## 2. Schedule endpoint

```
GET https://margdarshi.upsrtcvlt.com/php/getScheduledBusInfo.php?date=YYYY-MM-DD&reg_num=REG
```

| Property | Observed value |
| --- | --- |
| HTTP status | `200` (in both success and "no data" cases) |
| `Content-Type` | `text/html; charset=UTF-8` |
| Success shape | Array of stop objects, one per stop in the trip |
| Stops observed | 52 for `UP25FT4823` on 2026-07-20 |

### Field roles

| Canonical field | Upstream field |
| --- | --- |
| Stop id | `atco_code` |
| Stop name | `stop_name`, `platform_name` |
| Sequence | `stop_sequence` |
| Latitude / longitude | `Latitude`, `Longitude` (note the capitalisation) |
| Scheduled time | `scheduled_time` (`HH:MM:SS`, **not** ISO) |
| Route | `RouteName`, `route_description`, `line_id`, `line_name` |
| Trip | `vj_id`, `vehicle_journey_code` |

### Critical quirks

1. **"Bus Not Assigned" is a bare JSON string, not an error.**

   ```
   GET ...?date=2026-07-20&reg_num=UP78KT8662
   → HTTP 200, body: " Bus Not Assigned!!! "
   ```

   This is valid JSON (a string), so a naive `JSON.parse` succeeds and yields a
   string where an array was expected. `extractArray` returns `[]` for this
   shape and the route surfaces it as "no schedule assigned", never a crash.

2. **Stops frequently carry `0.0 / 0.0` coordinates.** 22 of 52 stops for
   `UP25FT4823` had no surveyed position. These are normalized to `null` and
   excluded from the route polyline — drawing through them would put the route
   through the Gulf of Guinea. Stops without geometry still appear in the stop
   list, flagged `no geo`.

3. **Times are wall-clock strings** (`"10:06:00"`), not timestamps, and carry
   no date or timezone. They are rendered as-is in IST context.

4. **Direction is encoded in the route name suffix** — `_IN` / `_OUT`
   (e.g. `RKD_4560_ORD_OUT`). There is no dedicated direction field.

5. **Most registrations have no schedule.** Vehicles with a non-`None`
   `vehicle_journey_id` in the live feed are far more likely to return one, so
   the inspector prefers those when sampling.

---

## 3. Consequences for the implementation

| Observation | Handling |
| --- | --- |
| 11.6 MiB response | Server-side proxy + 15s cache; gzip on the response (3.85 MB → 416 KB) |
| Misleading content type | Parse text body directly; reject bodies starting with `<` |
| `"None"` sentinels | Treated as absent by the alias picker |
| `0,0` stop coordinates | Normalized to `null`, excluded from polylines |
| Bare-string "no data" | Returns `null` schedule with an explanatory message |
| 9.5k records | Marker clustering, incremental marker diffing, capped list rendering |
| No duplicates seen, but possible | Merge-by-registration keeping the newest `timestamp` |

---

## 4. Sanitization

The inspector redacts before printing or writing fixtures:
`systemCodeNumber`, `vendorId`, `firmwareVersion`, and anything matching
phone / mobile / contact / driver / conductor / imei / sim / token / password /
apikey. No personal data, device identifier or credential is written to
`src/fixtures/` or logged.

---

## 5. Stop/city index — `getStopAreaAndGroup`

```
GET https://margdarshi.upsrtcvlt.com/php/getStopAreaAndGroup.php?query=<text>
```

Found in `js/traveller_information_view1.js`, which uses it to populate the
origin/destination autocomplete on the traveller-information page. It is the
index the other two discovery endpoints need, because it is the only thing
that enumerates the two id spaces.

| Property | Observed value |
| --- | --- |
| Method | `GET`, single `query` param, case-insensitive substring |
| `Content-Type` | `text/html; charset=UTF-8` — body is JSON |
| Result cap | **10 rows, server-side.** A prefix returning exactly 10 is truncated |
| No-match body | JSON **`null`**, not `[]` — iterating it directly throws |
| Fields | `id`, `code`, `name`, `classification` |

`classification` is either `GROUP` (a city) or `STOP_AREA` (a single stop).

Enumerated with a bounded a-z prefix sweep, drilling to two letters only where
a prefix hit the cap (650 requests, 0 failures):

- **15 cities**: AGRA(1) ALIGARH(2) AYODHYA(3) BAREILLY(4) DELHI(5)
  GORAKHPUR(6) KANPUR(7) LUCKNOW(8) MATHURA(9) MEERUT(10) MORADABAD(11)
  PRAYAGRAJ(12) BARABANKI(11001) BULANDSHAHR(11002) VARANASI(11004)
- **1,523 stop areas**
- A 16th `GROUP` named `UNKNOWN` (id 11000) exists and must be filtered out

City ids are **not contiguous** — they jump from 12 to 11001. Do not assume a
range; enumerate.

### ⚠ Two id spaces that collide numerically

This is the single most dangerous thing in this API family:

| Space | Used by | Example |
| --- | --- | --- |
| `STOP_AREA` id | `getStaticData?stop_code=` | `1` = ALAMBAGH |
| `GROUP` (city) id | `getBusBetweenStops` `origin_id` | `8` = LUCKNOW |

They overlap in the low integers and mean entirely different things —
`stop_code=8` is HARCHANDPUR while city `8` is LUCKNOW. A numeric join between
them silently mis-places data rather than failing. It was checked: joining the
`STOP_AREA` space to the schedule endpoint's `atco_code` space by number agrees
on **1 of 22** stops. Join on `route_name`/`line_id` instead, which both feeds
publish exactly.

---

## 6. Corridor timetable — `getStaticData`

```
GET https://margdarshi.upsrtcvlt.com/libis_upsrtc/php/getStaticData.php
      ?stop_code=<STOP_AREA id>&plate_code=&lang_id=eng&_=<epoch_ms>
```

The published timetable at a stop. This is the authoritative source for
**target headway (H\*)** — the denominator of every threshold in
`control-service/src/headway/`.

| Property | Observed value |
| --- | --- |
| Coverage | **22 stops only.** Probed densely, `stop_code` 1..400, zero errors |
| Valid ids | 1-24 **except 16 and 23** |
| Corpus | 14,935 rows, 1,886 route names, 1,174 line ids |
| Derivable headways | 1,138 routes (median 22 min, p10 5 min, p90 106 min) |
| Availability | **Static — works 24/7**, unlike the live feed |

Fields: `stop_area_code`, `stop_area_name`, `plate_code`, `stop_sequence`,
`service_type`, `service_type_name`, `route_name`, `route_origin`,
`route_destination`, `route_desc`, `line_id`, `line_name`, `line_direction`,
`line_directional_desc`, `vj_id`, `garage_name`, `sta`, `std`, `reg_num`.

`line_direction` is an explicit `"Outbound"` / `"Inbound"` — better than
parsing the `_OUT` / `_IN` suffix off `route_name`.

### ⚠ It covers ONE corridor, not the network

The 22 stops, in id order, are:

```
ALAMBAGH, PRAYAGRAJ CIVIL LINES, TELIBAGH, SGPGI LUCKNOW, MOHANLAL GANJ,
NIGOHA, BACHHRAWAN, HARCHANDPUR, RAEBARELI, JAGATPUR, BABUGANJ, UNCHAHAR,
ALAPUR, MANIKPUR, TIWARIPUR, LALGOPAL GANJ, MANSOORABAD, NAWABGANJ,
KAURIHAR, MALAKA, PHAPHAMAU, CHANDI
```

That is a **stop sequence** — the Lucknow -> Raebareli -> Prayagraj corridor —
not a statewide index. It cannot be widened by querying harder, which is why
this endpoint alone calibrates only ~11% of a statewide network.

### Quirks

1. **`sta`/`std` are `Z`-suffixed but carry IST wall-clock time**, the same
   defect as the live feed's `timestamp`. Read the clock components; do not
   treat them as UTC. `parseUpstreamInstant()` is the WRONG tool here — it
   nulls future-dated values and every scheduled departure is in the future,
   so it discards 100% of them.
2. **Re-publication artefact.** The same working is published twice ~60s apart
   under two `vj_id`s. Across 12,508 within-stop gaps there are **514 of
   exactly 60s** against 24 at 61s — a discrete spike, not a distribution.
   Taken literally it yields H\* = 60s, which makes every route look
   permanently bunched. Collapse near-identical departures before deriving.
3. **Cannot supply `route_direction_stops`.** Median stop areas per
   line-direction is **1**; a stop sequence cannot be built from one stop.
   Ordering and geometry still come from `getScheduledBusInfo`.

---

## 7. Statewide OD schedule — `getBusBetweenStops`

```
POST https://margdarshi.upsrtcvlt.com/php/getBusBetweenStops.php
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest

origin_id=8&origin_classification=GROUP
&destination_id=12&destination_classification=GROUP
&req_date=2026-08-11&service_type=All+Bus+Types
```

Trips between two cities. Covers the statewide network `getStaticData` cannot.
A missing/misnamed param returns `{"error":"Missing required parameters",
"received_data":{...}}` — the echo makes probing easy.

Full sweep of all 210 ordered city pairs: **53,898 rows, 3,768 routes, 2,783
with a derivable headway** (median 30 min), 0 rejected.

Fields: `vj_id`, `trip_id`, `depot_name`, `service_type_name`, `route_origin`,
`route_destination`, `route_name`, `route_id`, `route_desc`, `line_name`,
`line_desc`, `line_directional_desc`, `region_name`, `from_stop_name`,
`to_stop_name`, `from_arrival_time`, `to_arrival_time`, `reg_num`.

### ⚠ The pooling trap

`from_arrival_time` is a bare `HH:MM:SS` departure at the origin stop.
**Group by `from_stop_name`, never per route.** One `vj_id` appears once per
boarding stop it serves within a city: in a single Lucknow->Prayagraj
response, `vj_id` 19237 appears at KAISERBAGH 10:53:44 and ALAMBAGH 11:08:52.
That is one bus crossing one city; pooled it reads as a 15-minute headway.

Measured over the full sweep on the 906 line-directions both estimators
answer for:

| Estimator | Median H\* | Lower than the other on |
| --- | --- | --- |
| Pooled per route | 1,635 s | 399 of 906 |
| Bucketed per stop | 2,582 s | — |

Pooling reports a **37% shorter** headway. An H\* biased low means the
bunching ratio never crosses its threshold, i.e. silent non-detection.

Other quirks: `to_arrival_time` can exceed 24h (`28:37:51` = next day);
`line_name` is frequently a description (`"ALAMBAGH TO MIRZAPUR VIA ZEROROAD
BUS STATION"`) rather than a line id, which is what limits the join to our
seeded network.

---

## 8. Live trip status — `getDynamicData`

```
GET https://margdarshi.upsrtcvlt.com/libis_upsrtc/php/getDynamicData.php
      ?stop_code=<STOP_AREA id>&plate_code=&_=<epoch_ms>
```

Returns `{"running_trip":[], "cancelled_trip":[], "deviation_status":{}}`.
Observed empty overnight IST (nothing is running at 04:00). Populated during
service hours.

**Not yet consumed.** Candidate for surfacing live trip status and
cancellations on the ops dashboards.

---

## 9. Diurnal availability — which feeds work when

Easy to misdiagnose as an outage, because the endpoint stays healthy and
returns megabytes either way.

| Feed | Overnight IST | Service hours |
| --- | --- | --- |
| `getGpsLiveData` positions | ✅ complete | ✅ |
| `getGpsLiveData` **route assignment** | ❌ **0 of 9,157 records** carry `routename` | ✅ |
| `getScheduledBusInfo` | intermittent | ✅ |
| `getStaticData` / `getBusBetweenStops` | ✅ static | ✅ |

Measured 04:17 IST: 9,157 records, every one with valid GPS, **none** with
`routename`, `route`, `route_description` or `vehicle_journey_id`. Buses
receive their duty assignment at start of service.

Consequence: the seeder's network harvest groups by route to plan probes, so
an overnight run harvests nothing. GPS ingestion is unaffected. This is why
`--recalibrate-only` exists — H\* can be refreshed from the static feeds at
any hour without touching geometry.

Also observed (2026-08-09): `getGpsLiveData` answering `HTTP 200` with a
**one-byte body `F`** for hours. That is a success to every layer above the
JSON parse, which is why `--live-feed-file` exists.
