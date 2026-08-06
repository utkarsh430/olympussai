# UPSRTC API Discovery

Findings from probing the two undocumented UPSRTC endpoints with
`pnpm run inspect:api` (`scripts/inspect-upsrtc-api.ts`).

Nothing here was assumed. Every field below was observed in a real response.

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
