-- Schedule adherence: a controller gain that trades headway regularity
-- against punctuality, and a hard bound on the lateness a hold may cause.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY
-- ============================================================================
--
-- The deployed control laws regulate SPACING and nothing else. Every hold they
-- propose makes a bus later, and nothing in the system knows by how much or
-- refuses on that basis. Stated as an operational priority: buses should be as
-- punctual as possible WHILE arriving evenly spaced at the stops where people
-- are waiting. Those two goals only conflict once a pair has already collapsed
-- - up to that point they are the same goal, because an evenly-spaced timetable
-- makes "on schedule" and "evenly spaced" the same condition.
--
-- Two columns are what let the controller say that:
--
--   ks                    the gain on schedule deviation in the two-way and
--                         terminal-dispatch laws. A bus running EARLY gets held
--                         more (free punctuality and free spacing); a bus
--                         running LATE gets held less or not at all, so the gap
--                         is closed from the vehicle behind instead. Xuan,
--                         Argote & Daganzo (2011), "Dynamic bus holding
--                         strategies for schedule reliability".
--
--   max_lateness_seconds  the hard bound. mpc/safety.ts rejects any candidate
--                         whose hold would push the vehicle past it. This is
--                         the guarantee; ks is only the preference.
--
-- ============================================================================
-- WHY BOTH ARE NULLABLE, AND WHY THAT IS THE SAFE DEFAULT
-- ============================================================================
--
-- Both depend on knowing how late a vehicle actually is, which needs a
-- published timetable. MEASURED against this database: `trips` and
-- `trip_stop_times` are both EMPTY (0 rows, 2026-08-14), so schedule deviation
-- is currently null for every vehicle on every corridor.
--
-- NULL therefore means "this corridor has no schedule policy", and every
-- consumer treats a null deviation as unknown rather than as zero:
--
--   * src/mpc/twoWayHold.ts and terminalDispatch.ts omit the ks term entirely,
--     leaving today's pure-headway behaviour byte-for-byte unchanged.
--   * src/mpc/safety.ts applies no lateness rejection - it cannot bound what it
--     cannot measure, and a bound computed from an assumed deviation would be
--     worse than none.
--
-- Writing a default here would be the failure this schema keeps avoiding: a
-- fabricated number that produces plausible-looking control instead of visible
-- absence. See route_policies.calibration_source and the `'none'` sentinel for
-- the same policy applied to target headway.
--
-- Once a timetable is loaded, these become an UPDATE and no deploy.

begin;

alter table route_policies
  add column if not exists ks numeric,
  add column if not exists max_lateness_seconds integer
    check (max_lateness_seconds is null or max_lateness_seconds >= 0);

comment on column route_policies.ks is
  'Gain on schedule deviation in the two-way and terminal-dispatch control laws: hold = Kf(H*-h_fwd) - Kb(H*-h_bwd) - Ks*epsilon, where epsilon is seconds late (negative = early). Raises the hold on an early vehicle and shrinks it on a late one, so spacing is bought from slack that already exists rather than from punctuality. NULL disables the term, which is the deployed state while trips/trip_stop_times are empty. Config, not code.';

comment on column route_policies.max_lateness_seconds is
  'Hard upper bound on the lateness a hold may cause, in seconds, enforced by mpc/safety.ts as the max_lateness_breach rejection. A candidate is rejected when epsilon + hold exceeds it. Distinct from max_hold_seconds, which bounds the ACTION; this bounds its CONSEQUENCE for the timetable. NULL means unbounded, which is the deployed state while no schedule exists to measure lateness against. Config, not code.';

commit;
